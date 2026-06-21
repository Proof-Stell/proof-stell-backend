// src/admin/controllers/challenge-participation.controller.ts
import { Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DailyChallengeService } from '../../scheduled-challenges/services/daily-challenge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AuditLog } from '../../audit/decorators/audit-log.decorator';
import { AuditLogInterceptor } from '../../audit/interceptors/audit-log.interceptor';
import { AUDIT_ACTIONS } from '../../audit/constants/audit-actions';

@ApiTags('Admin - Daily Challenges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin/challenges/daily')
export class AdminChallengeController {
  constructor(private readonly dailyChallengeService: DailyChallengeService) {}

  @Post('reset')
  @ApiOperation({ summary: 'Manually trigger daily challenge reset' })
  @ApiResponse({ status: 200, description: 'Challenge reset successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @AuditLog({
    actionType: AUDIT_ACTIONS.ADMIN_DAILY_CHALLENGE_RESET,
    resource: 'admin:challenges:daily',
  })
  async manualReset() {
    const newChallenge =
      await this.dailyChallengeService.manuallyTriggerReset();
    return {
      success: true,
      message: 'Daily challenge reset successfully',
      data: newChallenge,
    };
  }
}
