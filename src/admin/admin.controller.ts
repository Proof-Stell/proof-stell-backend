import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { MetricsService } from './services/metrics.service';
import { AdminService } from './admin.service';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';
import { AuditLog } from '../audit/decorators/audit-log.decorator';

const ADMIN_RESOURCE = 'admin';

/**
 * Admin endpoints now share the same AuthGuard → RolesGuard → Admin role →
 * AuditLog stack so that:
 *  - access requires a valid JWT (AuthGuard),
 *  - the JWT subject must carry the ADMIN role (RolesGuard + @Roles(ADMIN)),
 *  - and every successful/failed call writes an audit_log row carrying the
 *    action type, method/URL, response size, and duration.
 *
 * The existing /admin/challenges/daily/reset endpoint in
 * src/admin/controllers/challenge-participation.controller.ts already owns the
 * daily-reset path under the AUDITed stack; this controller intentionally
 * does NOT add a duplicate handler.
 */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@UseInterceptors(AuditLogInterceptor)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly adminService: AdminService,
  ) {}

  @Get('dashboard')
  @AuditLog({
    actionType: 'DASHBOARD_ACCESS',
    resource: ADMIN_RESOURCE,
    includeParams: true,
  })
  async getDashboard() {
    return this.adminService.getDashboardData();
  }

  @Get('metrics/users/active')
  @AuditLog({
    actionType: 'ACTIVE_USERS_VIEW',
    resource: ADMIN_RESOURCE,
    includeParams: true,
  })
  async getActiveUsers(@Query('hours') hours: string = '24') {
    return this.metricsService.getActiveUsers(parseInt(hours));
  }

  @Get('metrics/games/summary')
  @AuditLog({
    actionType: 'GAMES_SUMMARY_VIEW',
    resource: ADMIN_RESOURCE,
    includeParams: true,
  })
  async getGamesSummary(@Query('days') days: string = '7') {
    return this.metricsService.getGamesSummary(parseInt(days));
  }

  @Get('metrics/system/health')
  @AuditLog({
    actionType: 'SYSTEM_HEALTH_VIEW',
    resource: ADMIN_RESOURCE,
  })
  async getSystemHealth() {
    return this.metricsService.getSystemHealth();
  }

  @Get('export/csv')
  @AuditLog({
    actionType: 'EXPORT_CSV',
    resource: ADMIN_RESOURCE,
    includeParams: true,
  })
  async exportDataCsv(
    @Query('type') type: string,
    @Query('days') days: string = '30',
  ) {
    return this.adminService.exportToCsv(type, parseInt(days));
  }
}
