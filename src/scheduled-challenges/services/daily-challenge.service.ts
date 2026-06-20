// src/scheduled-challenges/services/daily-challenge.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DailyChallenge } from '../entities/daily-challenge.entity';
import { ChallengeParticipation } from '../entities/challenge-participation.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DistributedLockService } from '../../cache/distributed-lock.service';
import { TypedConfigService } from '../../common/config/typed-config.service';

const LOCK_KEY_DAILY_RESET = 'lock:scheduler:daily-challenge:reset';

interface ChallengeTemplate {
  objective: string;
  reward: {
    type: 'coins' | 'experience' | 'item';
    amount: number;
    itemId?: string;
  };
  config: {
    targetScore?: number;
    targetTime?: number;
    gameMode?: string;
    difficulty?: string;
  };
}

@Injectable()
export class DailyChallengeService {
  private readonly logger = new Logger(DailyChallengeService.name);

  constructor(
    @InjectRepository(DailyChallenge)
    private readonly dailyChallengeRepository: Repository<DailyChallenge>,
    @InjectRepository(ChallengeParticipation)
    private readonly participationRepository: Repository<ChallengeParticipation>,
    private readonly eventEmitter: EventEmitter2,
    private readonly lockService: DistributedLockService,
    private readonly configService: TypedConfigService,
  ) {}

  private readonly challengeTemplates: ChallengeTemplate[] = [
    {
      objective: 'Score 1000 points in a single game',
      reward: { type: 'coins', amount: 100 },
      config: { targetScore: 1000, gameMode: 'classic', difficulty: 'normal' },
    },
    {
      objective: 'Complete 3 games in under 5 minutes each',
      reward: { type: 'experience', amount: 50 },
      config: { targetTime: 300, gameMode: 'speed', difficulty: 'normal' },
    },
    {
      objective: 'Achieve a 10x combo multiplier',
      reward: { type: 'coins', amount: 150 },
      config: { gameMode: 'combo', difficulty: 'hard' },
    },
    {
      objective: 'Win 5 consecutive games',
      reward: { type: 'experience', amount: 75 },
      config: { gameMode: 'classic', difficulty: 'normal' },
    },
    {
      objective: 'Complete daily challenge in expert mode',
      reward: { type: 'coins', amount: 200 },
      config: { gameMode: 'expert', difficulty: 'expert' },
    },
  ];

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    timeZone: 'UTC',
  })
  async handleDailyChallengeReset(): Promise<void> {
    // Cluster-safe: only one instance runs the reset per cycle. The lock
    // TTL (default 5 min) is well above the worst-case wall-time of the
    // reset routine (archive + create + emit).
    const ttl = this.configService.cronLockTtlMs;
    const lock = await this.lockService.acquire(LOCK_KEY_DAILY_RESET, ttl);
    if (!lock) {
      this.logger.debug(
        'Skipping daily challenge reset: another instance holds the lock.',
      );
      return;
    }
    this.logger.log(
      `Instance ${this.configService.schedulerInstanceId} starting daily challenge reset...`,
    );

    try {
      // Archive current active challenge
      await this.archiveCurrentChallenge();

      // Create new challenge
      const newChallenge = await this.createNewChallenge();

      this.logger.log(`New daily challenge created: ${newChallenge.id}`);

      // Emit event for other services
      this.eventEmitter.emit('daily-challenge.created', {
        challengeId: newChallenge.id,
        startAt: newChallenge.startAt,
        endAt: newChallenge.endAt,
        objective: newChallenge.objective,
      });
    } catch (error) {
      this.logger.error(
        'Failed to reset daily challenge:',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      await this.lockService.release(lock);
    }
  }

  async getCurrentChallenge(): Promise<DailyChallenge | null> {
    const now = new Date();
    return await this.dailyChallengeRepository.findOne({
      where: {
        isActive: true,
        startAt: LessThan(now),
        endAt: MoreThan(now),
      },
    });
  }

  async getChallengeHistory(
    limit: number = 10,
    offset: number = 0,
  ): Promise<{
    challenges: DailyChallenge[];
    total: number;
  }> {
    const [challenges, total] =
      await this.dailyChallengeRepository.findAndCount({
        where: {
          isActive: false,
        },
        order: {
          startAt: 'DESC',
        },
        take: limit,
        skip: offset,
      });

    return { challenges, total };
  }

  async getChallengeLeaderboard(
    challengeId: string,
    limit: number = 50,
  ): Promise<{
    challenge: DailyChallenge;
    leaderboard: ChallengeParticipation[];
    totalParticipants: number;
  }> {
    const challenge = await this.dailyChallengeRepository.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const [leaderboard, totalParticipants] =
      await this.participationRepository.findAndCount({
        where: { challengeId },
        order: {
          score: 'DESC',
          completionTime: 'ASC',
          createdAt: 'ASC',
        },
        take: limit,
      });

    return {
      challenge,
      leaderboard,
      totalParticipants,
    };
  }

  async participateInChallenge(
    challengeId: string,
    playerId: string,
    score: number,
    metadata?: any,
  ): Promise<ChallengeParticipation> {
    const challenge = await this.dailyChallengeRepository.findOne({
      where: { id: challengeId, isActive: true },
    });

    if (!challenge) {
      throw new NotFoundException('Active challenge not found');
    }

    const now = new Date();
    if (now > challenge.endAt) {
      throw new Error('Challenge has expired');
    }

    // Check if player already participated
    let participation = await this.participationRepository.findOne({
      where: { challengeId, playerId },
    });

    if (participation) {
      // Update existing participation if score is better
      if (score > participation.score) {
        participation.score = score;
        participation.metadata = { ...participation.metadata, ...metadata };
        participation.completed = this.isObjectiveCompleted(
          challenge,
          score,
          metadata,
        );
        await this.participationRepository.save(participation);
      }
    } else {
      // Create new participation
      participation = this.participationRepository.create({
        challengeId,
        playerId,
        score,
        metadata,
        completed: this.isObjectiveCompleted(challenge, score, metadata),
      });
      await this.participationRepository.save(participation);
    }

    // Update leaderboard rankings
    await this.updateLeaderboardRankings(challengeId);

    return participation;
  }

  async manuallyTriggerReset(): Promise<DailyChallenge> {
    // Manual triggers bypass the scheduler lock so operators can recover
    // from a botched cron run without waiting for the TTL to expire.
    this.logger.log('Manually triggering daily challenge reset...');

    await this.archiveCurrentChallenge();
    const newChallenge = await this.createNewChallenge();

    this.eventEmitter.emit('daily-challenge.manual-reset', {
      challengeId: newChallenge.id,
      triggeredAt: new Date(),
    });

    return newChallenge;
  }

  private async archiveCurrentChallenge(): Promise<void> {
    const currentChallenge = await this.getCurrentChallenge();

    if (currentChallenge) {
      // Finalize rankings
      await this.finalizeRankings(currentChallenge.id);

      // Mark as inactive
      currentChallenge.isActive = false;
      await this.dailyChallengeRepository.save(currentChallenge);

      this.logger.log(`Archived challenge: ${currentChallenge.id}`);

      this.eventEmitter.emit('daily-challenge.archived', {
        challengeId: currentChallenge.id,
        archivedAt: new Date(),
      });
    }
  }

  private async createNewChallenge(): Promise<DailyChallenge> {
    const now = new Date();
    const startAt = new Date(now);
    startAt.setUTCHours(0, 0, 0, 0);

    const endAt = new Date(startAt);
    endAt.setUTCDate(endAt.getUTCDate() + 1);

    // Select random challenge template
    const template =
      this.challengeTemplates[
        Math.floor(Math.random() * this.challengeTemplates.length)
      ];

    const challenge = this.dailyChallengeRepository.create({
      startAt,
      endAt,
      objective: template.objective,
      reward: template.reward,
      config: template.config,
      isActive: true,
    });

    return await this.dailyChallengeRepository.save(challenge);
  }

  private async updateLeaderboardRankings(challengeId: string): Promise<void> {
    const participations = await this.participationRepository.find({
      where: { challengeId },
      order: {
        score: 'DESC',
        completionTime: 'ASC',
        createdAt: 'ASC',
      },
    });

    for (let i = 0; i < participations.length; i++) {
      participations[i].rank = i + 1;
    }

    await this.participationRepository.save(participations);
  }

  private async finalizeRankings(challengeId: string): Promise<void> {
    await this.updateLeaderboardRankings(challengeId);

    this.eventEmitter.emit('daily-challenge.rankings-finalized', {
      challengeId,
      finalizedAt: new Date(),
    });
  }

  private isObjectiveCompleted(
    challenge: DailyChallenge,
    score: number,
    metadata?: any,
  ): boolean {
    const { config } = challenge;

    if (config.targetScore && score >= config.targetScore) {
      return true;
    }

    if (
      config.targetTime &&
      metadata?.completionTime &&
      metadata.completionTime <= config.targetTime
    ) {
      return true;
    }

    // Add more completion logic based on your game mechanics
    return false;
  }
}
