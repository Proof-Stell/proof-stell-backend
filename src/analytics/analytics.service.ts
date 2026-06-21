/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CreateAnalyticsDto } from './dto/create-analytics.dto';
import { AnalyticsEvent } from './analytics-event.enum';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsAggregationDto } from './dto/analytics-aggregation.dto';

export interface EventAggregation {
  period: string;
  count: number;
  event?: AnalyticsEvent;
}

export interface TrackEventOptions {
  userId?: string;
  metadata?: Record<string, any>;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(AnalyticsEventEntity)
    private analyticsRepo: Repository<AnalyticsEventEntity>,
  @Inject(CACHE_MANAGER) private cacheManager: Cache,
  private readonly logger = new Logger(AnalyticsService.name), // ← wrong pattern
  ) {}

  async logEvent(dto: CreateAnalyticsDto): Promise<void> {
    const entry = this.analyticsRepo.create(dto);
    await this.analyticsRepo.save(entry);
  }

  async getAllLogs(): Promise<AnalyticsEventEntity[]> {
    // Avoid returning large metadata by selecting only main columns
    return this.analyticsRepo
      .createQueryBuilder('ae')
      .select(['ae.id', 'ae.event', 'ae.timestamp', 'ae.userId'])
  .orderBy('ae.timestamp', 'DESC') //ehnacement needed
  .limit(100)
  .getMany();
  }

  async getUserLogs(userId: string): Promise<AnalyticsEventEntity[]> {
    return this.analyticsRepo
      .createQueryBuilder('ae')
      .select(['ae.id', 'ae.event', 'ae.timestamp', 'ae.userId'])
      .where('ae.userId = :userId', { userId })
  .orderBy('ae.timestamp', 'DESC')
  .limit(100)
  .getMany();
  }

  /** PII fields that must never be stored or forwarded to providers. */
  private static readonly PII_KEYS = new Set([
    'email', 'password', 'ip', 'ipAddress', 'phone', 'address',
    'ssn', 'creditCard', 'token', 'secret', 'apiKey',
  ]);

  /** Returns a copy of `metadata` with PII fields removed. */
  sanitizeMetadata(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!metadata) return {};
    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([k]) => !AnalyticsService.PII_KEYS.has(k),
      ),
    );
  }

  async track(
    event: AnalyticsEvent,
    options: TrackEventOptions = {},
  ): Promise<AnalyticsEventEntity> {
    try {
      const sanitizedOptions: TrackEventOptions = {
        ...options,
        metadata: this.sanitizeMetadata(options.metadata),
      };
      const analyticsEvent = this.analyticsRepo.create({
        event,
        ...sanitizedOptions,
      });

      const savedEvent = await this.analyticsRepo.save(analyticsEvent);

      this.logger.debug(`Tracked event: ${event}`, {
        eventId: savedEvent.id,
        userId: options.userId,
      });

      return savedEvent;
    } catch (error) {
      this.logger.error(`Failed to track event: ${event}`, error.stack);
      throw error;
    }
  }

  async trackBatch(
    events: Array<{ event: AnalyticsEvent; options?: TrackEventOptions }>,
  ): Promise<AnalyticsEventEntity[]> {
    try {
      const analyticsEvents = events.map(({ event, options = {} }) =>
        this.analyticsRepo.create({ event, ...options }),
      );

      const savedEvents = await this.analyticsRepo.save(analyticsEvents);

      this.logger.debug(`Tracked ${savedEvents.length} events in batch`);
      return savedEvents;
    } catch (error) {
      this.logger.error('Failed to track batch events', error.stack);
      throw error;
    }
  }

  async getEvents(query: AnalyticsQueryDto): Promise<{
    events: AnalyticsEventEntity[];
    total: number;
  }> {
    const where: FindOptionsWhere<AnalyticsEventEntity> = {};

    if (query.event) {
      where.event = query.event;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.from || query.to) {
      const fromDate = query.from
        ? new Date(query.from)
        : new Date('1970-01-01');
      const toDate = query.to ? new Date(query.to) : new Date();
      where.timestamp = Between(fromDate, toDate);
    }

    // Use query builder to select only necessary columns and leverage indexed timestamp/userId
    const qb = this.analyticsRepo.createQueryBuilder('ae').where(where);
    const [events, total] = await qb
      .select(['ae.id', 'ae.event', 'ae.timestamp', 'ae.userId'])
      .orderBy('ae.timestamp', 'DESC')
      .limit(query.limit)
      .offset(query.offset)
      .getManyAndCount();

    return { events, total };
  }

  async getEventAggregation(
    query: AnalyticsAggregationDto,
  ): Promise<EventAggregation[]> {
    // Cache aggregation results for a short period to reduce DB load on repeated queries
    const cacheKey = `analytics:agg:${query.groupBy}:${query.event || 'all'}:${query.userId || 'all'}:${query.from || ''}:${query.to || ''}`;
    const cached = await this.cacheManager.get<EventAggregation[]>(cacheKey);
    if (cached) {
      return cached;
    }
    let dateFormat: string;
    let groupByFormat: string;

    switch (query.groupBy) {
      case 'hour':
        dateFormat = 'YYYY-MM-DD HH24:00:00';
        groupByFormat = 'hour';
        break;
      case 'day':
        dateFormat = 'YYYY-MM-DD';
        groupByFormat = 'day';
        break;
      case 'week':
        dateFormat = 'YYYY-"W"WW';
        groupByFormat = 'week';
        break;
      case 'month':
        dateFormat = 'YYYY-MM';
        groupByFormat = 'month';
        break;
      default:
        dateFormat = 'YYYY-MM-DD';
        groupByFormat = 'day';
    }

    let queryBuilder = this.analyticsRepo
      .createQueryBuilder('ae')
      .select(`TO_CHAR(ae.timestamp, '${dateFormat}') as period`)
      .addSelect('COUNT(*) as count');

    if (query.event) {
      queryBuilder = queryBuilder
        .addSelect('ae.event as event')
        .where('ae.event = :event', { event: query.event });
    }

    if (query.userId) {
      queryBuilder = queryBuilder.andWhere('ae.userId = :userId', {
        userId: query.userId,
      });
    }

    if (query.from) {
      queryBuilder = queryBuilder.andWhere('ae.timestamp >= :from', {
        from: new Date(query.from),
      });
    }

    if (query.to) {
      queryBuilder = queryBuilder.andWhere('ae.timestamp <= :to', {
        to: new Date(query.to),
      });
    }

    const groupByFields = ['period'];
    if (query.event) {
      groupByFields.push('ae.event');
    }

    queryBuilder = queryBuilder
      .groupBy(groupByFields.join(', '))
      .orderBy('period', 'ASC');

    const results = await queryBuilder.getRawMany();
    const mapped = results.map((row) => ({
      period: row.period,
      count: parseInt(row.count),
      ...(row.event && { event: row.event }),
    }));

    await this.cacheManager.set(cacheKey, mapped, 60); // cache for 60s
    return mapped;
  }

  //   /**
  //    * Get unique users count for a specific event
  //    */
  async getUniqueUsersCount(
    event?: AnalyticsEvent,
    from?: Date,
    to?: Date,
  ): Promise<number> {
    const cacheKey = `analytics:unique:${event || 'all'}:${from?.toISOString() || ''}:${to?.toISOString() || ''}`;
    const cached = await this.cacheManager.get<number>(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }
    let queryBuilder = this.analyticsRepo
      .createQueryBuilder('ae')
      .select('COUNT(DISTINCT ae.userId)')
      .where('ae.userId IS NOT NULL');

    if (event) {
      queryBuilder = queryBuilder.andWhere('ae.event = :event', { event });
    }

    if (from) {
      queryBuilder = queryBuilder.andWhere('ae.timestamp >= :from', { from });
    }

    if (to) {
      queryBuilder = queryBuilder.andWhere('ae.timestamp <= :to', { to });
    }

  const result = await queryBuilder.getRawOne();
  const val = parseInt(result.count) || 0;
  await this.cacheManager.set(cacheKey, val, 60);
  return val;
  }

  //   /**
  //    * Clean up old events (useful for data retention)
  //    */
  async cleanupOldEvents(olderThanDays: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.analyticsRepo
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoffDate', { cutoffDate })
      .execute();

    this.logger.log(`Cleaned up ${result.affected} old analytics events`);
    return result.affected || 0;
  }

  /**
//    * Get top events by count
//    */
  async getTopEvents(
    limit: number = 10,
    from?: Date,
    to?: Date,
  ): Promise<{ event: AnalyticsEvent; count: number }[]> {
    let queryBuilder = this.analyticsRepo
      .createQueryBuilder('ae')
      .select('ae.event as event')
      .addSelect('COUNT(*) as count');

    if (from) {
      queryBuilder = queryBuilder.where('ae.timestamp >= :from', { from });
    }

    if (to) {
      queryBuilder = queryBuilder.andWhere('ae.timestamp <= :to', { to });
    }

    const results = await queryBuilder
  .groupBy('ae.event')
  .orderBy('count', 'DESC')
  .limit(limit)
  .getRawMany();

    return results.map((row) => ({
      event: row.event,
      count: parseInt(row.count),
    }));
  }
}
