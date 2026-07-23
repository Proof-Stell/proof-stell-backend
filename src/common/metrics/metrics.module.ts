import { Global, Module } from '@nestjs/common';
import { DatabaseMetricsService } from './database-metrics.service';

@Global()
@Module({ providers: [DatabaseMetricsService], exports: [DatabaseMetricsService] })
export class MetricsModule {}
