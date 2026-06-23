import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Notification } from './notification.entity';
import { CreateNotificationDto } from './notification.dto';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { ConfigService } from '@nestjs/config';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class NotificationService {
  // In-process dedupe cache: key = `${userId}:${eventId}` -> timestamp
  private dedupeCache: Map<string, number> = new Map();
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
  ) {}

  private sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  private cleanupDedupeCache(windowMs: number) {
    const now = Date.now();
    for (const [k, ts] of this.dedupeCache) {
      if (now - ts > windowMs) this.dedupeCache.delete(k);
    }
  }

  private async sendWithRetries(notification: Notification) {
    const maxRetries = this.configService.get<number>(
      'app.notificationMaxRetries',
      5,
    );
    const baseMs = this.configService.get<number>(
      'app.notificationBackoffBaseMs',
      100,
    );

    for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
      try {
        // Provider call - isolate errors per provider
        this.realtimeGateway.emitNotification(
          notification.userId,
          notification.message,
          notification.type,
          notification.icon,
        );
        return;
      } catch (err) {
        const canRetry = attempt < maxRetries;
        this.loggingService.warn(
          `Notification send failed (attempt ${attempt}) for user ${notification.userId}`,
          {
            module: 'notification',
            metadata: { notificationId: notification.id },
          },
        );
        if (!canRetry) {
          this.loggingService.error(
            `Notification delivery permanently failed for ${notification.id}`,
            err instanceof Error ? err : new Error(String(err)),
            {
              module: 'notification',
              metadata: { notificationId: notification.id },
            },
          );
          return;
        }
        const backoff = Math.round(baseMs * Math.pow(2, attempt - 1));
        await this.sleep(backoff + Math.floor(Math.random() * 100));
      }
    }
  }

  async create(createDto: CreateNotificationDto) {
    const dedupeWindow = this.configService.get<number>(
      'app.notificationDedupeWindowMs',
      300000,
    );
    const concurrency = this.configService.get<number>(
      'app.notificationConcurrency',
      10,
    );

    // Cleanup stale dedupe entries
    this.cleanupDedupeCache(dedupeWindow);

    const eventId = createDto.eventId?.toString();
    let targetUserIds = Array.from(new Set(createDto.userIds));

    // Remove users that are present in in-process dedupe cache
    if (eventId) {
      targetUserIds = targetUserIds.filter((userId) => {
        const key = `${userId}:${eventId}`;
        const ts = this.dedupeCache.get(key);
        if (ts && Date.now() - ts <= dedupeWindow) return false;
        return true;
      });
    }

    // If eventId is provided, remove users that already have the same event persisted
    if (eventId && targetUserIds.length > 0) {
      const existing = await this.notificationRepo.find({
        where: { eventId, userId: In(targetUserIds) },
      });
      if (existing && existing.length) {
        const existingUserIds = new Set(existing.map((n) => n.userId));
        targetUserIds = targetUserIds.filter((u) => !existingUserIds.has(u));
      }
    }

    if (targetUserIds.length === 0) return [];

    const notifications = targetUserIds.map((userId) =>
      this.notificationRepo.create({
        userId,
        title: createDto.title,
        message: createDto.message,
        type: createDto.type,
        isRead: false,
        icon: createDto.icon,
        eventId: eventId,
      }),
    );

    let saved: Notification[] = [];
    try {
      saved = await this.notificationRepo.save(notifications);
    } catch (err) {
      // If unique constraint triggered by race, attempt to save individually
      this.loggingService.warn(
        'Batch save failed, falling back to individual saves',
        {
          module: 'notification',
        },
      );
      for (const n of notifications) {
        try {
          const s = await this.notificationRepo.save(n);
          saved.push(s);
        } catch (e) {
          // ignore duplicates or other save errors per-item
          this.loggingService.warn(
            'Individual notification save failed',
            e as any,
            {
              module: 'notification',
              metadata: { userId: n.userId },
            },
          );
        }
      }
    }

    // Mark dedupe cache for saved notifications
    if (eventId) {
      for (const n of saved) {
        this.dedupeCache.set(`${n.userId}:${eventId}`, Date.now());
      }
    }

    // Send notifications in batches to limit concurrency
    const batches: Notification[][] = [];
    for (let i = 0; i < saved.length; i += concurrency) {
      batches.push(saved.slice(i, i + concurrency));
    }
    for (const batch of batches) {
      await Promise.allSettled(batch.map((n) => this.sendWithRetries(n)));
    }

    return saved;
  }

  async listByUser(userId: string, page = 1, limit = 20) {
    return this.notificationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.notificationRepo.findOne({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.userId !== userId)
      throw new ForbiddenException('Access denied');

    notification.isRead = true;
    return this.notificationRepo.save(notification);
  }
}
