import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ScheduledChallenge,
  ScheduleStatus,
} from '../entities/scheduled-challenge.entity';
import { ChallengeGenerationService } from './challenge-generation.service';
import { ChallengeType, DifficultyLevel } from '../entities/challenge.entity';
import { ScheduleChallengeDto } from '../dto/schedule-challenge.dto';
import { DistributedLockService } from '../../cache/distributed-lock.service';
import { TypedConfigService } from '../../common/config/typed-config.service';

/**
 * Single entry points for the cluster-safe scheduled jobs.
 * The full key is prefixed by `CacheModule` with `Proof-Stell:`, but we
 * still scope these with `lock:` so admin tooling can spot them.
 */
const LOCK_KEY_PROCESS = 'lock:scheduler:scheduled-challenge:process';
const LOCK_KEY_DAILY_GENERATE = 'lock:scheduler:scheduled-challenge:daily';
const LOCK_KEY_WEEKLY_GENERATE = 'lock:scheduler:scheduled-challenge:weekly';

@Injectable()
export class ScheduledChallengeService {
  private readonly logger = new Logger(ScheduledChallengeService.name);

  constructor(
    private readonly challengeGenerationService: ChallengeGenerationService,
    @InjectRepository(ScheduledChallenge)
    private readonly scheduledChallengeRepository: Repository<ScheduledChallenge>,
    private readonly lockService: DistributedLockService,
    private readonly configService: TypedConfigService,
  ) {}

  /**
   * Run every hour to:
   *   1. Promote any PENDING scheduled challenges whose `scheduledFor` has
   *      elapsed to ACTIVE.
   *   2. Mark any ACTIVE scheduled challenges whose `expiresAt` has elapsed
   *      as EXPIRED.
   *
   * Cluster-safe: only one instance runs this body at any given time via a
   * Redis distributed lock with TTL. State transitions are atomic SQL
   * updates keyed by the existing status so duplicate activations cannot
   * occur even if the lock TTL somehow expires mid-run.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processScheduledChallenges(): Promise<void> {
    const ttl = this.configService.cronLockTtlMs;
    const lock = await this.lockService.acquire(LOCK_KEY_PROCESS, ttl);
    if (!lock) {
      return;
    }
    this.logger.log(
      `Instance ${this.configService.schedulerInstanceId} processing scheduled challenges.`,
    );

    try {
      const now = new Date();

      // Atomic activation: only rows still in PENDING can be transitioned
      // in this query, which prevents double-activation if the lock TTL
      // unexpectedly expired and another instance picked the same batch.
      const activation = await this.scheduledChallengeRepository
        .createQueryBuilder()
        .update(ScheduledChallenge)
        .set({ status: ScheduleStatus.ACTIVE })
        .where('status = :status AND "scheduledFor" <= :now', {
          status: ScheduleStatus.PENDING,
          now,
        })
        .returning(['id'])
        .execute();

      const activatedCount = activation.affected ?? 0;
      if (activatedCount > 0) {
        this.logger.log(`Activated ${activatedCount} scheduled challenge(s).`);
      }

      // Atomic expiration of any challenges past their expiry while still ACTIVE.
      const expiration = await this.scheduledChallengeRepository
        .createQueryBuilder()
        .update(ScheduledChallenge)
        .set({ status: ScheduleStatus.EXPIRED })
        .where(
          'status = :status AND "expiresAt" IS NOT NULL AND "expiresAt" <= :now',
          {
            status: ScheduleStatus.ACTIVE,
            now,
          },
        )
        .returning(['id'])
        .execute();

      const expiredCount = expiration.affected ?? 0;
      if (expiredCount > 0) {
        this.logger.log(`Expired ${expiredCount} scheduled challenge(s).`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to process scheduled challenges:',
        error instanceof Error ? error.stack : String(error),
      );
      // Re-throw so NestJS surfaces the error in its scheduler logs, but
      // always release the lock in the finally block.
      throw error;
    } finally {
      await this.lockService.release(lock);
    }
  }

  /**
   * Generate next-day global challenges once per day. Locked end-to-end so
   * multiple instances do not create duplicate challenges against the
   * same date.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateDailyChallenges(): Promise<void> {
    const ttl = this.configService.cronLockTtlMs;
    const lock = await this.lockService.acquire(LOCK_KEY_DAILY_GENERATE, ttl);
    if (!lock) {
      return;
    }

    try {
      this.logger.log('Generating daily challenges...');

      const challengeTypes = Object.values(ChallengeType);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0); // Schedule for 9 AM tomorrow

      const expiresAt = new Date(tomorrow);
      expiresAt.setHours(23, 59, 59, 999); // Expires at end of day

      for (const type of challengeTypes) {
        try {
          // Generate a medium difficulty global challenge for each type
          const challenge =
            await this.challengeGenerationService.generateGlobalChallenge(
              type,
              DifficultyLevel.MEDIUM,
            );

          const scheduledChallenge = this.scheduledChallengeRepository.create({
            challengeId: challenge.id,
            userId: null, // Global challenge
            status: ScheduleStatus.PENDING,
            scheduledFor: tomorrow,
            expiresAt,
            isGlobal: true,
            metadata: {
              type: 'daily_challenge',
              generatedAt: new Date(),
              generatedBy: this.configService.schedulerInstanceId,
            },
          });

          await this.scheduledChallengeRepository.save(scheduledChallenge);
          this.logger.log(`Scheduled daily ${type} challenge for tomorrow`);
        } catch (error) {
          this.logger.error(
            `Failed to generate daily ${type} challenge:`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      await this.lockService.release(lock);
    }
  }

  /**
   * Generate weekly challenges once per day at midnight for the upcoming
   * Sunday. Uses its own lock key so it can run concurrently with the
   * daily routine without contention.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async generateWeeklyChallenges(): Promise<void> {
    const ttl = this.configService.cronLockTtlMs;
    const lock = await this.lockService.acquire(LOCK_KEY_WEEKLY_GENERATE, ttl);
    if (!lock) {
      return;
    }

    try {
      this.logger.log('Generating weekly challenges...');

      const nextSunday = new Date();
      nextSunday.setDate(nextSunday.getDate() + 7);
      nextSunday.setHours(10, 0, 0, 0);

      const expiresAt = new Date(nextSunday);
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires next Sunday

      const challengeTypes = [ChallengeType.CODING, ChallengeType.ALGORITHM];

      for (const type of challengeTypes) {
        try {
          const challenge =
            await this.challengeGenerationService.generateGlobalChallenge(
              type,
              DifficultyLevel.HARD,
            );

          const scheduledChallenge = this.scheduledChallengeRepository.create({
            challengeId: challenge.id,
            userId: null,
            status: ScheduleStatus.PENDING,
            scheduledFor: nextSunday,
            expiresAt,
            isGlobal: true,
            metadata: {
              type: 'weekly_challenge',
              generatedAt: new Date(),
              generatedBy: this.configService.schedulerInstanceId,
            },
          });

          await this.scheduledChallengeRepository.save(scheduledChallenge);
          this.logger.log(`Scheduled weekly ${type} challenge`);
        } catch (error) {
          this.logger.error(
            `Failed to generate weekly ${type} challenge:`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      await this.lockService.release(lock);
    }
  }

  async scheduleChallenge(
    scheduleChallengeDto: ScheduleChallengeDto,
  ): Promise<ScheduledChallenge> {
    const scheduledChallenge = this.scheduledChallengeRepository.create({
      ...scheduleChallengeDto,
      scheduledFor: new Date(scheduleChallengeDto.scheduledFor),
      expiresAt: scheduleChallengeDto.expiresAt
        ? new Date(scheduleChallengeDto.expiresAt)
        : null,
    });

    return this.scheduledChallengeRepository.save(scheduledChallenge);
  }

  async getActiveScheduledChallenges(
    userId?: string,
  ): Promise<ScheduledChallenge[]> {
    const where: any = { status: ScheduleStatus.ACTIVE };

    if (userId) {
      where.userId = userId;
    } else {
      where.isGlobal = true;
    }

    return this.scheduledChallengeRepository.find({
      where,
      relations: ['challenge'],
      order: { scheduledFor: 'DESC' },
    });
  }

  async getUserScheduledChallenges(
    userId: string,
  ): Promise<ScheduledChallenge[]> {
    return this.scheduledChallengeRepository.find({
      where: [
        { userId, status: ScheduleStatus.ACTIVE },
        { isGlobal: true, status: ScheduleStatus.ACTIVE },
      ],
      relations: ['challenge'],
      order: { scheduledFor: 'DESC' },
    });
  }
}
