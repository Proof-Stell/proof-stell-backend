import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { type Repository, Between } from 'typeorm';
import { AuditLogService, type LogActionParams } from '../audit-log.service';
import { AuditLog } from '../../entities/audit-log.entity';
import { jest } from '@jest/globals'; // Import jest to declare it

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: jest.Mocked<Repository<AuditLog>>;

  const mockAuditLog: AuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user-123',
    actionType: 'USER_LOGIN',
    metadata: { ip: '127.0.0.1' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    resource: 'auth',
    result: 'SUCCESS',
    errorMessage: undefined as unknown as string,
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    repository = module.get(getRepositoryToken(AuditLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logAction', () => {
    it('should create and save an audit log', async () => {
      const params: LogActionParams = {
        actionType: 'USER_LOGIN',
        userId: 'user-123',
        metadata: { ip: '127.0.0.1' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        resource: 'auth',
        result: 'SUCCESS',
      };

      repository.create.mockReturnValue(mockAuditLog);
      repository.save.mockResolvedValue(mockAuditLog);

      const result = await service.logAction(params);

      expect(repository.create).toHaveBeenCalledWith({
        userId: params.userId,
        actionType: params.actionType,
        metadata: params.metadata,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        resource: params.resource,
        result: params.result,
      });
      expect(repository.save).toHaveBeenCalledWith(mockAuditLog);
      expect(result).toEqual(mockAuditLog);
    });

    it('should use default values when optional params are not provided', async () => {
      const params: LogActionParams = {
        actionType: 'USER_LOGIN',
        userId: 'user-123',
      };

      repository.create.mockReturnValue(mockAuditLog);
      repository.save.mockResolvedValue(mockAuditLog);

      await service.logAction(params);

      expect(repository.create).toHaveBeenCalledWith({
        userId: params.userId,
        actionType: params.actionType,
        metadata: {},
        ipAddress: undefined,
        userAgent: undefined,
        resource: undefined,
        result: 'SUCCESS',
      });
    });

    it('should throw error when save fails', async () => {
      const params: LogActionParams = {
        actionType: 'USER_LOGIN',
        userId: 'user-123',
      };

      const error = new Error('Database error');
      repository.create.mockReturnValue(mockAuditLog);
      repository.save.mockRejectedValue(error);

      await expect(service.logAction(params)).rejects.toThrow('Database error');
    });
  });

  describe('findLogs', () => {
    it('should return paginated logs with default filters', async () => {
      const logs = [mockAuditLog];
      const total = 1;

      repository.findAndCount.mockResolvedValue([logs, total]);

      const result = await service.findLogs();

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 50,
      });
      expect(result).toEqual({
        logs,
        total,
        page: 1,
        totalPages: 1,
      });
    });

    it('should apply filters correctly', async () => {
      const filters = {
        userId: 'user-123',
        actionType: 'USER_LOGIN',
        result: 'SUCCESS',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02'),
        page: 2,
        limit: 25,
      };

      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findLogs(filters);

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          actionType: 'USER_LOGIN',
          result: 'SUCCESS',
          createdAt: Between(filters.startDate, filters.endDate),
        },
        order: { createdAt: 'DESC' },
        skip: 25,
        take: 25,
      });
    });

    it('should handle date range with only start date', async () => {
      const filters = {
        startDate: new Date('2024-01-01'),
      };

      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findLogs(filters);

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('getLogById', () => {
    it('should return log by id', async () => {
      repository.findOne.mockResolvedValue(mockAuditLog);

      const result = await service.getLogById('123');

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: '123' } });
      expect(result).toEqual(mockAuditLog);
    });

    it('should return null when log not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.getLogById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getLogsByUser', () => {
    it('should return logs for specific user', async () => {
      const logs = [mockAuditLog];
      repository.find.mockResolvedValue(logs);

      const result = await service.getLogsByUser('user-123');

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      expect(result).toEqual(logs);
    });

    it('should respect limit parameter', async () => {
      repository.find.mockResolvedValue([]);

      await service.getLogsByUser('user-123', 50);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    });
  });

  describe('getLogsByActionType', () => {
    it('should return logs for specific action type', async () => {
      const logs = [mockAuditLog];
      repository.find.mockResolvedValue(logs);

      const result = await service.getLogsByActionType('USER_LOGIN');

      expect(repository.find).toHaveBeenCalledWith({
        where: { actionType: 'USER_LOGIN' },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      expect(result).toEqual(logs);
    });
  });

  describe('getLogStats', () => {
    it('should return log statistics', async () => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { actionType: 'USER_LOGIN', count: '5' },
          { actionType: 'USER_LOGOUT', count: '3' },
        ]),
      };

      repository.count
        .mockResolvedValueOnce(100) // total logs
        .mockResolvedValueOnce(10); // recent activity

      repository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getLogStats();

      expect(result).toEqual({
        totalLogs: 100,
        logsByAction: {
          USER_LOGIN: 5,
          USER_LOGOUT: 3,
        },
        recentActivity: 10,
      });
    });
  });
});
