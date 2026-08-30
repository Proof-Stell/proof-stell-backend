// src/admin/services/metrics.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Game } from '../../game/entities/game.entity';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Game)
    private gameRepository: Repository<Game>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async getActiveUsers(hours: number = 24) {
    const cacheKey = `active_users_${hours}h`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const [totalActive, hourlyBreakdown] = await Promise.all([
        this.userRepository
          .createQueryBuilder('user')
          .where('user.lastActiveAt >= :since', { since })
          .getCount(),

        this.getUserActivityByHour(hours),
      ]);

      const result = {
        count: totalActive,
        hours,
        hourlyBreakdown,
        timestamp: new Date().toISOString(),
      };

      await this.cacheManager.set(cacheKey, result, 300); // Cache for 5 minutes
      return result;
    } catch (error) {
      this.logger.error('Failed to get active users', error.stack);
      throw error;
    }
  }

  async getSystemErrors(page: number = 1, limit: number = 50) {
    const cacheKey = `system_errors_${page}_${limit}`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      // Since we don't have ErrorLog entity, we'll create mock error data
      // In a real implementation, you might want to implement a simple logging mechanism
      // or integrate with your existing logging solution

      const mockErrors = [
        {
          id: 1,
          message: 'High memory usage detected',
          level: 'WARNING',
          createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          source: 'system',
        },
        {
          id: 2,
          message: 'Database query timeout',
          level: 'ERROR',
          createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          source: 'database',
        },
        {
          id: 3,
          message: 'Rate limit exceeded',
          level: 'WARNING',
          createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
          source: 'api',
        },
      ];

      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const errors = mockErrors.slice(startIndex, endIndex);

      const result = {
        errors,
        total: mockErrors.length,
        page,
        limit,
        totalPages: Math.ceil(mockErrors.length / limit),
        timestamp: new Date().toISOString(),
      };

      await this.cacheManager.set(cacheKey, result, 60); // Cache for 1 minute
      return result;
    } catch (error) {
      this.logger.error('Failed to get system errors', error.stack);
      throw error;
    }
  }

  async getGamesSummary(days: number = 7) {
    const cacheKey = `games_summary_${days}d`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [totalGames, completedGames, dailyTrend] = await Promise.all([
        this.gameRepository
          .createQueryBuilder('game')
          .where('game.createdAt >= :since', { since })
          .getCount(),

        this.gameRepository
          .createQueryBuilder('game')
          .where('game.createdAt >= :since AND game.status = :status', {
            since,
            status: 'completed',
          })
          .getCount(),

        this.getGamesTrendByDay(days),
      ]);

      const avgGamesPerDay = totalGames / days;
      const completionRate =
        totalGames > 0 ? (completedGames / totalGames) * 100 : 0;

      const result = {
        totalGames,
        completedGames,
        avgGamesPerDay: Math.round(avgGamesPerDay * 100) / 100,
        completionRate: Math.round(completionRate * 100) / 100,
        dailyTrend,
        days,
        timestamp: new Date().toISOString(),
      };

      await this.cacheManager.set(cacheKey, result, 600); // Cache for 10 minutes
      return result;
    } catch (error) {
      this.logger.error('Failed to get games summary', error.stack);
      throw error;
    }
  }

  async getTransactionMetrics(days: number = 30) {
    // Since Transaction entity doesn't exist, we'll provide mock data
    // You can implement this later when you add transactions to your app
    const cacheKey = `transaction_metrics_${days}d`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      // Mock transaction data based on games played (assuming some games involve transactions)
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const gamesInPeriod = await this.gameRepository
        .createQueryBuilder('game')
        .where('game.createdAt >= :since', { since })
        .getCount();

      // Estimate transactions as 60% of games (mock business logic)
      const estimatedTransactions = Math.floor(gamesInPeriod * 0.6);
      const successfulTransactions = Math.floor(estimatedTransactions * 0.95); // 95% success rate
      const totalAmount = estimatedTransactions * 25; // Average $25 per transaction

      const result = {
        totalTransactions: estimatedTransactions,
        successfulTransactions,
        successRate:
          estimatedTransactions > 0
            ? (successfulTransactions / estimatedTransactions) * 100
            : 0,
        totalAmount,
        avgTransactionValue:
          estimatedTransactions > 0 ? totalAmount / estimatedTransactions : 0,
        dailyTrend: await this.getMockTransactionsTrend(days),
        days,
        timestamp: new Date().toISOString(),
        note: 'Estimated data based on game activity - implement when transaction system is available',
      };

      await this.cacheManager.set(cacheKey, result, 900); // Cache for 15 minutes
      return result;
    } catch (error) {
      this.logger.error('Failed to get transaction metrics', error.stack);
      throw error;
    }
  }

  async getSystemHealth() {
    const cacheKey = 'system_health';
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    try {
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();

      // Check database connectivity
      const dbHealthy = await this.checkDatabaseHealth();

      // Mock error rate since we don't have error logs
      const errorCount = Math.floor(Math.random() * 5); // Random errors for demo

      const result = {
        uptime: Math.floor(uptime),
        uptimeFormatted: this.formatUptime(uptime),
        memory: {
          used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          usage: Math.round(
            (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
          ),
        },
        database: {
          healthy: dbHealthy,
          status: dbHealthy ? 'connected' : 'disconnected',
        },
        errors: {
          lastHour: errorCount,
          status:
            errorCount < 10
              ? 'healthy'
              : errorCount < 50
                ? 'warning'
                : 'critical',
        },
        timestamp: new Date().toISOString(),
      };

      await this.cacheManager.set(cacheKey, result, 30); // Cache for 30 seconds
      return result;
    } catch (error) {
      this.logger.error('Failed to get system health', error.stack);
      throw error;
    }
  }

  // Helper methods
  private async getUserActivityByHour(hours: number) {
    const hoursArray = Array.from({ length: hours }, (_, i) => {
      const hour = new Date(Date.now() - (hours - 1 - i) * 60 * 60 * 1000);
      return hour.toISOString().slice(0, 13) + ':00:00.000Z';
    });

    const activity = await Promise.all(
      hoursArray.map(async (hour) => {
        const nextHour = new Date(new Date(hour).getTime() + 60 * 60 * 1000);
        const count = await this.userRepository
          .createQueryBuilder('user')
          .where('user.lastActiveAt >= :start AND user.lastActiveAt < :end', {
            start: hour,
            end: nextHour,
          })
          .getCount();

        return {
          hour: hour.slice(11, 16), // HH:MM format
          count,
        };
      }),
    );

    return activity;
  }

  private async getGamesTrendByDay(days: number) {
    const daysArray = Array.from({ length: days }, (_, i) => {
      const day = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      return day.toISOString().split('T')[0];
    });

    const trend = await Promise.all(
      daysArray.map(async (day) => {
        const nextDay = new Date(new Date(day).getTime() + 24 * 60 * 60 * 1000);
        const count = await this.gameRepository
          .createQueryBuilder('game')
          .where('game.createdAt >= :start AND game.createdAt < :end', {
            start: day,
            end: nextDay,
          })
          .getCount();

        return {
          date: day,
          games: count,
        };
      }),
    );

    return trend;
  }

  private async getTransactionsTrendByDay(days: number) {
    // Mock implementation since Transaction entity doesn't exist
    return this.getMockTransactionsTrend(days);
  }

  private async getMockTransactionsTrend(days: number) {
    const daysArray = Array.from({ length: days }, (_, i) => {
      const day = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      return day.toISOString().split('T')[0];
    });

    const trend = await Promise.all(
      daysArray.map(async (day) => {
        const nextDay = new Date(new Date(day).getTime() + 24 * 60 * 60 * 1000);

        // Get actual games for this day
        const gamesCount = await this.gameRepository
          .createQueryBuilder('game')
          .where('game.createdAt >= :start AND game.createdAt < :end', {
            start: day,
            end: nextDay,
          })
          .getCount();

        // Estimate transactions based on games
        const estimatedTransactions = Math.floor(gamesCount * 0.6);
        const estimatedAmount = estimatedTransactions * 25;

        return {
          date: day,
          transactions: estimatedTransactions,
          amount: estimatedAmount,
        };
      }),
    );

    return trend;
  }

  private async checkDatabaseHealth(): Promise<boolean> {
    try {
      await this.userRepository.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async getRecentErrorCount(): Promise<number> {
    // Mock error count since ErrorLog entity doesn't exist
    return Math.floor(Math.random() * 10);
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  // Export methods
  async getUsersForExport(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.role',
        'user.createdAt',
        'user.lastActiveAt',
      ])
      .where('user.createdAt >= :since', { since })
      .getMany();
  }

  async getGamesForExport(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.gameRepository
      .createQueryBuilder('game')
      .where('game.createdAt >= :since', { since })
      .getMany();
  }
}
