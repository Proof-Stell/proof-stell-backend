import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BlockchainService } from './blockchain.service';
import { TransactionReconciliationService } from './services/transaction-reconciliation.service';
import { TransactionVerificationService } from './services/transaction-verification.service';
import { TransactionScheduler } from './transaction.scheduler';
import { TransactionStatus } from './entities/transaction-status.entity';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionStatus]),
    ScheduleModule.forRoot(),
    AnalyticsModule,
  ],
  providers: [
    BlockchainService,
    TransactionReconciliationService,
    TransactionVerificationService,
    TransactionScheduler,
  ],
  exports: [
    BlockchainService,
    TransactionReconciliationService,
    TransactionVerificationService,
  ],
  controllers: [],
})
export class BlockchainModule {}
