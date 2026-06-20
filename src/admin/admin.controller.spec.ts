/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MetricsService } from './services/metrics.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';
import { AUDIT_LOG_KEY } from '../audit/interceptors/audit-log.interceptor';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

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
        { provide: AdminService, useValue: mockAdminService },
        { provide: MetricsService, useValue: mockMetricsService },
        Reflector,
      ],
    })
      // The tighter RBAC stack that replaced the old custom AdminGuard.
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      // Audit-on-every-admin-endpoint wiring.
      .overrideInterceptor(AuditLogInterceptor)
      .useValue({
        intercept: (_: unknown, next: { handle: () => unknown }) =>
          next.handle(),
      })
      .compile();

    controller = module.get<AdminController>(AdminController);
    adminService = module.get<AdminService>(AdminService);
    metricsService = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('RBAC wiring', () => {
    let reflector: Reflector;

    beforeEach(() => {
      reflector = new Reflector();
    });

    it('restricts the controller class to the ADMIN role via @Roles()', () => {
      const roles = reflector.get(ROLES_KEY, AdminController);
      expect(roles).toEqual([Role.ADMIN]);
    });

    it('reads ROLES_KEY on a handler with the same production precedence used by RolesGuard', () => {
      const roles = reflector.getAllAndOverride(ROLES_KEY, [
        AdminController.prototype.getDashboard,
        AdminController,
      ]);
      expect(roles).toEqual([Role.ADMIN]);
    });
  });

  describe('@AuditLog metadata', () => {
    let reflector: Reflector;

    type HandlerName =
      | 'getDashboard'
      | 'getActiveUsers'
      | 'getGamesSummary'
      | 'getSystemHealth'
      | 'exportDataCsv';

    const cases: Array<[HandlerName, string]> = [
      ['getDashboard', 'DASHBOARD_ACCESS'],
      ['getActiveUsers', 'ACTIVE_USERS_VIEW'],
      ['getGamesSummary', 'GAMES_SUMMARY_VIEW'],
      ['getSystemHealth', 'SYSTEM_HEALTH_VIEW'],
      ['exportDataCsv', 'EXPORT_CSV'],
    ];

    beforeEach(() => {
      reflector = new Reflector();
    });

    it.each(cases)(
      '%s carries an %s @AuditLog entry with resource=admin',
      (methodName, actionType) => {
        const meta = reflector.getAllAndOverride(AUDIT_LOG_KEY, [
          AdminController.prototype[methodName],
          AdminController,
        ]);
        expect(meta).toBeDefined();
        expect(meta.actionType).toBe(actionType);
        expect(meta.resource).toBe('admin');
      },
    );
  });

  describe('getDashboard', () => {
    it('should return dashboard data', async () => {
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
    it('should return active users data', async () => {
      const expectedData = { count: 50, hours: 24 };
      mockMetricsService.getActiveUsers.mockResolvedValue(expectedData);

      const result = await controller.getActiveUsers('24');

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getActiveUsers).toHaveBeenCalledWith(24);
    });

    it('should use default hours when not provided', async () => {
      const expectedData = { count: 50, hours: 24 };
      mockMetricsService.getActiveUsers.mockResolvedValue(expectedData);

      const result = await controller.getActiveUsers(undefined);

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getActiveUsers).toHaveBeenCalledWith(24);
    });
  });

  describe('getGamesSummary', () => {
    it('should return games summary', async () => {
      const expectedData = { totalGames: 100, days: 7 };
      mockMetricsService.getGamesSummary.mockResolvedValue(expectedData);

      const result = await controller.getGamesSummary('7');

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getGamesSummary).toHaveBeenCalledWith(7);
    });
  });

  describe('getSystemHealth', () => {
    it('should return system health data', async () => {
      const expectedData = { uptime: 3600, memory: { usage: 50 } };
      mockMetricsService.getSystemHealth.mockResolvedValue(expectedData);

      const result = await controller.getSystemHealth();

      expect(result).toEqual(expectedData);
      expect(mockMetricsService.getSystemHealth).toHaveBeenCalled();
    });
  });

  describe('exportDataCsv', () => {
    it('should export data as CSV', async () => {
      const expectedData = { filename: 'users_export.csv', data: 'csv,data' };
      mockAdminService.exportToCsv.mockResolvedValue(expectedData);

      const result = await controller.exportDataCsv('users', '30');

      expect(result).toEqual(expectedData);
      expect(mockAdminService.exportToCsv).toHaveBeenCalledWith('users', 30);
    });
  });
});
