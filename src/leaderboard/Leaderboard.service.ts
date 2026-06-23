/* eslint-disable prettier/prettier */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Leaderboard } from './entities/leaderboard.entity';
import { CreateLeaderboardDto } from './dto/create-leaderboard.dto';
import { UpdateLeaderboardDto } from './dto/update-leaderboard.dto';
import { Cron } from '@nestjs/schedule';
import { TypedConfigService } from '../common/config/typed-config.service';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { CacheService } from '../cache/cache.service';
import { CacheKeys } from '../cache/decorators/cache.decorator';

@Injectable()
export class LeaderboardService {
  constructor(
    @InjectRepository(Leaderboard)
    private readonly leaderboardRepository: Repository<Leaderboard>,
    private readonly dataSource: DataSource,
    private readonly configService: TypedConfigService,
    private readonly notificationService: NotificationService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly cacheService: CacheService,
  ) {}

  async submitScore(
    userId: string,
    createLeaderboardDto: CreateLeaderboardDto,
  ): Promise<Leaderboard> {
    const { score } = createLeaderboardDto;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let previousRank: number | undefined;
    let isNewEntry = false;
    let finalEntry: Leaderboard;

    try {
      // Lock the row for this user to prevent concurrent race
      const existing = await queryRunner.manager
        .createQueryBuilder(Leaderboard, 'lb')
        .setLock('pessimistic_write')
        .where('lb.userId = :userId', { userId })
        .getOne();

      if (existing) {
        if (score <= existing.score) {
          throw new BadRequestException(
            'New score must be higher than current score',
          );
        }
        previousRank = existing.rank;
        existing.score = score;
        await queryRunner.manager.save(existing);
      } else {
        isNewEntry = true;
        const newEntry = queryRunner.manager.create(Leaderboard, {
          userId,
          score,
          rank: 0,
        });
        await queryRunner.manager.save(newEntry);
      }

      // Recalculate ranks within the same transaction using SQL window function
      if (this.configService.leaderboardRecalculationStrategy !== 'batch') {
        await this.recalculateRanksWithManager(queryRunner.manager);
      }

      finalEntry = await queryRunner.manager.findOneOrFail(Leaderboard, {
        where: { userId },
        relations: ['user'],
      });

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Invalidate cache after successful persistence
    await this.invalidateLeaderboardCache(userId);

    // Post-commit: emit notifications and realtime events
    if (isNewEntry) {
      await this.notificationService.create({
        userIds: [userId],
        title: 'Leaderboard Entry',
        message: `You have entered the leaderboard at rank ${finalEntry.rank}.`,
        type: 'leaderboard',
        icon: '🏆',
      });
      await this.emitRealtimeLeaderboardUpdate('global', 'new_entry');
    } else if (previousRank !== undefined && finalEntry.rank !== previousRank) {
      await this.notificationService.create({
        userIds: [userId],
        title: 'Leaderboard Update',
        message: `Your new leaderboard rank is ${finalEntry.rank}.`,
        type: 'leaderboard',
        icon: '🏆',
      });
      this.realtimeGateway.emitUserRankChange(
        userId,
        previousRank,
        finalEntry.rank,
        finalEntry.score,
      );
      await this.emitRealtimeLeaderboardUpdate('global', 'rank_change');
    } else {
      await this.emitRealtimeLeaderboardUpdate('global', 'score_change');
    }

    return finalEntry;
  }

  async getGlobalLeaderboard(
    page: number = 1,
    limit: number = 50,
  ): Promise<{
    leaderboard: Leaderboard[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [leaderboard, total] = await this.leaderboardRepository.findAndCount({
      relations: ['user'],
      order: { rank: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { leaderboard, total, page, limit };
  }

  async getUserLeaderboard(userId: string): Promise<Leaderboard> {
    const leaderboardEntry = await this.leaderboardRepository.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!leaderboardEntry) {
      throw new NotFoundException('User not found in leaderboard');
    }

    return leaderboardEntry;
  }

  async updateScore(
    userId: string,
    updateLeaderboardDto: UpdateLeaderboardDto,
  ): Promise<Leaderboard> {
    return this.submitScore(userId, updateLeaderboardDto as CreateLeaderboardDto);
  }

  /**
   * Recalculate ranks using a single SQL UPDATE with RANK() window function.
   * Efficient for large datasets — no in-memory row loading.
   */
  // Batched rank recalculation every 5 minutes
  @Cron('*/5 * * * *')
  public async recalculateRanks(): Promise<void> {
    await this.recalculateRanksWithManager(this.dataSource.manager);
    await this.invalidateGlobalLeaderboardCache();
  }

  private async recalculateRanksWithManager(
    manager: import('typeorm').EntityManager,
  ): Promise<void> {
    await manager.query(`
      UPDATE leaderboard
      SET rank = ranked.new_rank
      FROM (
        SELECT id, RANK() OVER (ORDER BY score DESC, "updatedAt" ASC) AS new_rank
        FROM leaderboard
      ) ranked
      WHERE leaderboard.id = ranked.id
    `);
  }

  async forceRecalculateRanks(): Promise<void> {
    await this.recalculateRanks();
  }

  async resetLeaderboard(): Promise<void> {
    await this.leaderboardRepository.clear();
    await this.invalidateLeaderboardCache();
    await this.emitRealtimeLeaderboardUpdate('global', 'reset');
  }

  private async invalidateLeaderboardCache(userId?: string): Promise<void> {
    await this.invalidateGlobalLeaderboardCache();
    if (userId) {
      const userKey = CacheKeys.build(CacheKeys.USER_LEADERBOARD, { userId });
      await this.cacheService.del(userKey);
    }
  }

  private async invalidateGlobalLeaderboardCache(): Promise<void> {
    // Invalidate common page/limit combinations
    for (const page of [1, 2, 3]) {
      for (const limit of [10, 20, 50, 100]) {
        const key = CacheKeys.build(CacheKeys.GLOBAL_LEADERBOARD, { page, limit });
        await this.cacheService.del(key);
      }
    }
  }

  private async emitRealtimeLeaderboardUpdate(
    leaderboardId: string,
    updateType: 'score_change' | 'rank_change' | 'new_entry' | 'reset',
  ): Promise<void> {
    const top100 = await this.getGlobalLeaderboard(1, 100);
    this.realtimeGateway.emitLeaderboardUpdate(
      leaderboardId,
      top100.leaderboard,
      updateType,
    );

    if (updateType === 'reset') {
      this.realtimeGateway.emitLeaderboardStats(leaderboardId, {
        totalPlayers: 0,
        averageScore: 0,
        topScore: 0,
        lastUpdated: new Date().toISOString(),
      });
    }
  }
}
