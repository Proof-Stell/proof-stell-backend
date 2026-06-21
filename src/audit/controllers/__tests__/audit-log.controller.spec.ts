import { Test, type TestingModule } from '@nestjs/testing';
import { AuditLogController } from '../audit-log.controller';
import { AuditLogService } from '../../services/audit-log.service';
import type { GetAuditLogsDto } from '../../dto/audit-log.dto';
import { jest } from '@jest/globals';

describe('AuditLogController', () => {
  let controller: AuditLogController;
  let service: {
    findLogs: jest.Mock;
    getLogStats: jest.Mock;
    getLogById: jest.Mock;
    getLogsByUser: jest.Mock;
    getLogsByActionType: jest.Mock;
  };

  const mockAuditLog = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user-123',
    actionType: 'USER_LOGIN',
    metadata: { ip: '127.0.0.1' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    resource: 'auth',
    result: 'SUCCESS',
    errorMessage: null,
  };

  beforeEach(async () => {
    const mockService = {
      logAction: jest.fn(),
      findLogs: jest.fn(),
      getLogById: jest.fn(),
      getLogsByUser: jest.fn(),
      getLogsByActionType: jest.fn(),
      getLogStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        {
          provide: AuditLogService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    // Pull the mock straight back through NestJS — it's the same object
    // instance since `useValue` is a singleton-per-test.
    const mockAuditLogService = (module.get(AuditLogService) as any) as typeof service;
    service = mockAuditLogService;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAuditLogs', () => {
    it('returns paginated audit logs', async () => {
      const query: GetAuditLogsDto = {
        page: 1,
        limit: 50,
        userId: 'user-123',
        actionType: 'USER_LOGIN',
      };

      const expectedResponse = {
        logs: [mockAuditLog],
        total: 1,
        page: 1,
        totalPages: 1,
      };

      (service.findLogs as jest.Mock).mockResolvedValue(expectedResponse);

      const result = await controller.getAuditLogs(query);

      expect(service.findLogs).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        userId: 'user-123',
        actionType: 'USER_LOGIN',
        startDate: undefined,
        endDate: undefined,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('handles date filters', async () => {
      const query: GetAuditLogsDto = {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-02T00:00:00Z',
      };

      (service.findLogs as jest.Mock).mockResolvedValue({
        logs: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      await controller.getAuditLogs(query);

      expect(service.findLogs).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-02T00:00:00Z'),
      });
    });
  });

  describe('getAuditLogStats', () => {
    it('returns audit log statistics', async () => {
      const expectedStats = {
        totalLogs: 100,
        logsByAction: {
          USER_LOGIN: 50,
          USER_LOGOUT: 30,
          USER_CREATED: 20,
        },
        recentActivity: 10,
      };

      (service.getLogStats as jest.Mock).mockResolvedValue(expectedStats);

      const result = await controller.getAuditLogStats();

      expect(service.getLogStats).toHaveBeenCalled();
      expect(result).toEqual(expectedStats);
    });
  });

  describe('getAuditLogById', () => {
    it('returns a specific audit log', async () => {
      (service.getLogById as jest.Mock).mockResolvedValue(mockAuditLog);

      const result = await controller.getAuditLogById('123');

      expect(service.getLogById).toHaveBeenCalledWith('123');
      expect(result).toEqual(mockAuditLog);
    });

    it('throws when the log is not found', async () => {
      (service.getLogById as jest.Mock).mockResolvedValue(null);

      await expect(controller.getAuditLogById('nonexistent')).rejects.toThrow(
        'Audit log not found',
      );
    });
  });

  describe('getUserAuditLogs', () => {
    it('returns logs for a specific user', async () => {
      (service.getLogsByUser as jest.Mock).mockResolvedValue([mockAuditLog]);

      const result = await controller.getUserAuditLogs('user-123');

      expect(service.getLogsByUser).toHaveBeenCalledWith('user-123', 100);
      expect(result).toEqual([mockAuditLog]);
    });

    it('respects limit parameter', async () => {
      (service.getLogsByUser as jest.Mock).mockResolvedValue([]);

      await controller.getUserAuditLogs('user-123', 50);

      expect(service.getLogsByUser).toHaveBeenCalledWith('user-123', 50);
    });
  });

  describe('getActionAuditLogs', () => {
    it('returns logs for a specific action type', async () => {
      (service.getLogsByActionType as jest.Mock).mockResolvedValue([mockAuditLog]);

      const result = await controller.getActionAuditLogs('USER_LOGIN');

      expect(service.getLogsByActionType).toHaveBeenCalledWith(
        'USER_LOGIN',
        100,
      );
      expect(result).toEqual([mockAuditLog]);
    });

    it('respects limit parameter', async () => {
      (service.getLogsByActionType as jest.Mock).mockResolvedValue([]);

      await controller.getActionAuditLogs('USER_LOGIN', 50);

      expect(service.getLogsByActionType).toHaveBeenCalledWith(
        'USER_LOGIN',
        50,
      );
    });
  });
});
