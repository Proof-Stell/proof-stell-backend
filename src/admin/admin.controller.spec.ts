import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MetricsService } from './services/metrics.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { AuditLogService } from '../audit/services/audit-log.service';

describe('AdminController', () => {
  let controller: AdminController;
  let adminService: AdminService;
  let metricsService: MetricsService;

  const mockAdminService = {
    getDashboardData: jest.fn(),
    exportToCsv: jest.fn(),
  };

  const mockMetricsService = {
    getActiveUsers: jest.fn(),
    getSystemErrors: jest.fn(),
    getGamesSummary: jest.fn(),
    getSystemHealth: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminGuard,
        { provide: AdminService, useValue: mockAdminService },
        { provide: MetricsService, useValue: mockMetricsService },
        {
          provide: AuditLogService,
          useValue: { logAction: jest.fn().mockResolvedValue({} as any) },
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    adminService = module.get<AdminService>(AdminService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDashboard', () => {
    it('returns dashboard data', async () => {
      const expectedData = {
        overview: { activeUsers: 100, gamesPlayed: 500 },
        charts: { userActivity: [], gamesTrend: [] },
      };
      mockAdminService.getDashboardData.mockResolvedValue(expectedData);

      const result = await controller.getDashboard();

      expect(result).toEqual(expectedData);
      expect(mockAdminService.getDashboardData).toHaveBeenCalled();
    });
  });

  describe('getActiveUsers', () => {
    it('forwards the hours query to MetricsService', async () => {
      const expectedData = { count: 50, hours: 24 };
      mockMetricsService.getActiveUsers.mockResolvedValue(expectedData);

      const result = await controller.getActiveUsers('24');

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getActiveUsers).toHaveBeenCalledWith(24);
    });
  });

  describe('getGamesSummary', () => {
    it('forwards the days query to MetricsService', async () => {
      const expectedData = { totalGames: 100, days: 7 };
      mockMetricsService.getGamesSummary.mockResolvedValue(expectedData);

      const result = await controller.getGamesSummary('7');

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getGamesSummary).toHaveBeenCalledWith(7);
    });
  });

  describe('getSystemHealth', () => {
    it('returns system health data', async () => {
      const expectedData = { uptime: 3600, memory: { usage: 50 } };
      mockMetricsService.getSystemHealth.mockResolvedValue(expectedData);

      const result = await controller.getSystemHealth();

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getSystemHealth).toHaveBeenCalled();
    });
  });

  describe('exportDataCsv', () => {
    it('exports data as CSV', async () => {
      const expectedData = { filename: 'users_export.csv', data: 'csv,data' };
      mockAdminService.exportToCsv.mockResolvedValue(expectedData);

      const result = await controller.exportDataCsv('users', '30');

      expect(result).toEqual(expectedData);
      expect(mockAdminService.exportToCsv).toHaveBeenCalledWith('users', 30);
    });
  });
});
