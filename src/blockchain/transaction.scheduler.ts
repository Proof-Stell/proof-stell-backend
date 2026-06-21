import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionVerificationService } from './services/transaction-verification.service';

/**
 * Scheduled job for reconciling blockchain transactions.
 * Periodically checks the status of pending transactions against the blockchain.
 * This helps recover from transient failures and ensures consistency.
 */
@Injectable()
export class TransactionScheduler {
  private readonly logger = new Logger(TransactionScheduler.name);

  constructor(
    private readonly verificationService: TransactionVerificationService,
  ) {}

  /**
   * Reconciles pending transactions every 2 minutes.
   * This is a lightweight background job that checks the on-chain status
   * of transactions that are pending or in unknown state.
   */
  @Cron(CronExpression.EVERY_2_MINUTES)
  async reconcilePendingTransactions() {
    try {
      this.logger.debug('Starting scheduled transaction reconciliation...');
      await this.verificationService.reconcileAllPendingTransactions();
      this.logger.debug('Scheduled transaction reconciliation completed');
    } catch (error) {
      this.logger.error(
        `Error during scheduled reconciliation: ${error.message}`,
      );
    }
  }

  /**
   * Performs a more thorough reconciliation every 10 minutes.
   * Useful for catching edge cases and ensuring no transactions slip through.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async deepReconciliation() {
    try {
      this.logger.debug('Starting deep transaction reconciliation...');
      await this.verificationService.reconcileAllPendingTransactions();
      this.logger.debug('Deep reconciliation completed');
    } catch (error) {
      this.logger.error(`Error during deep reconciliation: ${error.message}`);
    }
  }
}
