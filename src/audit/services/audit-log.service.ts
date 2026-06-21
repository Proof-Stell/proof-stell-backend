import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Repository, type FindManyOptions, Between } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

export interface LogActionParams {
  actionType: string;
  userId: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'ERROR';
  errorMessage?: string;
}

export interface AuditLogFilters {
  userId?: string;
  actionType?: string;
  startDate?: Date;
  endDate?: Date;
  result?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async logAction(params: LogActionParams): Promise<AuditLog> {
    try {
      const auditLog = this.auditLogRepository.create({
        userId: params.userId,
        actionType: params.actionType,
        metadata: params.metadata || {},
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        resource: params.resource,
        result: params.result || 'SUCCESS',
        errorMessage: params.errorMessage,
      });

      const savedLog = await this.auditLogRepository.save(auditLog);

      this.logger.log(
        `Audit log created: ${params.actionType} by user ${params.userId}`,
      );

      return savedLog;
    } catch (error) {
      this.logger.error(
        `Failed to create audit log: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async findLogs(filters: AuditLogFilters = {}): Promise<{
    logs: AuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const {
      userId,
      actionType,
      startDate,
      endDate,
      result,
      page = 1,
      limit = 50,
    } = filters;

    const whereConditions: Record<string, unknown> = {};

    if (userId) {
      whereConditions.userId = userId;
    }

    if (actionType) {
      whereConditions.actionType = actionType;
    }

    if (result) {
      whereConditions.result = result;
    }

    if (startDate && endDate) {
      whereConditions.createdAt = Between(startDate, endDate);
    } else if (startDate) {
      whereConditions.createdAt = Between(startDate, new Date());
    }

    const findOptions: FindManyOptions<AuditLog> = {
      where: whereConditions,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    };

    const [logs, total] =
      await this.auditLogRepository.findAndCount(findOptions);

    return {
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getLogById(id: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({ where: { id } });
  }

  async getLogsByUser(userId: string, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getLogsByActionType(
    actionType: string,
    limit = 100,
  ): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { actionType },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getLogStats(): Promise<{
    totalLogs: number;
    logsByAction: Record<string, number>;
    recentActivity: number;
  }> {
    const totalLogs = await this.auditLogRepository.count();

    const actionStats = await this.auditLogRepository
      .createQueryBuilder('audit_log')
      .select('audit_log.actionType', 'actionType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit_log.actionType')
      .getRawMany();

    const logsByAction = actionStats.reduce<Record<string, number>>(
      (acc, stat) => {
        acc[stat.actionType] = Number.parseInt(stat.count, 10);
        return acc;
      },
      {},
    );

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentActivity = await this.auditLogRepository.count({
      where: {
        createdAt: Between(oneDayAgo, new Date()),
      },
    });

    return {
      totalLogs,
      logsByAction,
      recentActivity,
    };
  }
}
