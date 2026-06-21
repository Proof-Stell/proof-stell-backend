import { Module } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';
import { LoggingService } from './logging.service';

@Module({
  providers: [LoggingInterceptor, LoggingService],
  exports: [LoggingInterceptor, LoggingService],
})
export class LoggingModule {}
