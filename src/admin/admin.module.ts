// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MetricsService } from './services/metrics.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Game } from '../game/entities/game.entity';
import { ChallengesModule } from '../scheduled-challenges/challenges.module';
import { AdminChallengeController } from './controllers/challenge-participation.controller';

// Note: AdminGuard is provided globally by @Global() AuditLogModule.
// No need to re-provide it here — that just adds a redundant DI path.

@Module({
  imports: [ChallengesModule, TypeOrmModule.forFeature([User, Game])],
  controllers: [AdminController, AdminChallengeController],
  providers: [AdminService, MetricsService],
  exports: [AdminService, MetricsService],
})
export class AdminModule {}
