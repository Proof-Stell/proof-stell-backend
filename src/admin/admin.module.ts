// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MetricsService } from './services/metrics.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Game } from 'src/game/entities/game.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Game])],
  controllers: [AdminController],
  providers: [AdminService, MetricsService],
  exports: [AdminService, MetricsService],
})
export class AdminModule {}
