import { Test, TestingModule } from '@nestjs/testing';
import { BadgeController } from './badge.controller';
import { BadgeService } from './services/badge.service';
import { AchievementService } from './services/achievement.service';
import { NotificationService } from '../notification/notification.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { AuditLogService } from '../audit/services/audit-log.service';

describe('BadgeController', () => {
  let controller: BadgeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BadgeController],
      providers: [
        AdminGuard,
        {
          provide: AuditLogService,
          useValue: { logAction: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: BadgeService, useValue: {} },
        { provide: AchievementService, useValue: {} },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();

    controller = module.get<BadgeController>(BadgeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
