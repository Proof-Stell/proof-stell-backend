import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './Leaderboard.service';
import { Leaderboard } from './entities/leaderboard.entity';
import { NotificationService } from '../notification/notification.service';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Leaderboard])],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, NotificationService, RealtimeGateway],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
