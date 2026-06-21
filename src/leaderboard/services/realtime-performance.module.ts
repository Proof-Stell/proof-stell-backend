import { Module } from '@nestjs/common';
import { RealtimePerformanceService } from './realtime-performance.service';
import { RealtimeGateway } from '../../common/gateways/realtime.gateway';

@Module({
  providers: [RealtimePerformanceService, RealtimeGateway],
  exports: [RealtimePerformanceService],
})
export class RealtimePerformanceModule {}
