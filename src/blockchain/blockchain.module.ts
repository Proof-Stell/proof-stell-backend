import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockchainService } from './blockchain.service';
import { TransactionReconciliationService } from './services/transaction-reconciliation.service';
import { TransactionVerificationService } from './services/transaction-verification.service';
import { TransactionStatus } from './entities/transaction-status.entity';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [TypeOrmModule.forFeature([TransactionStatus]), AnalyticsModule],
  providers: [
    BlockchainService,
    TransactionReconciliationService,
    TransactionVerificationService,
  ],
  exports: [
    BlockchainService,
    TransactionReconciliationService,
    TransactionVerificationService,
  ],
  controllers: [],
})
export class BlockchainModule {}
