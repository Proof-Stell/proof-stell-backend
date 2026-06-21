import { Injectable, Logger } from '@nestjs/common';
import { Provider } from 'starknet';
import { TypedConfigService } from '../../common/config/typed-config.service';
import { TransactionReconciliationService } from './transaction-reconciliation.service';
import { TransactionStatusType } from '../entities/transaction-status.entity';

/**
 * Verifies the on-chain status of blockchain transactions.
 * This helps reconcile the backend state with the actual blockchain state
 * when transient errors occur during transaction submission or confirmation.
 */
@Injectable()
export class TransactionVerificationService {
  private readonly logger = new Logger(TransactionVerificationService.name);
  private provider: Provider;

  constructor(
    private readonly configService: TypedConfigService,
    private readonly reconciliationService: TransactionReconciliationService,
  ) {
    this.provider = new Provider({
      nodeUrl: this.configService.starknetRpcUrl ||
        'https://starknet-goerli.g.alchemy.com/v2/demo',
    });
  }

  /**
   * Verifies the status of a transaction on the blockchain.
   * Returns the on-chain status without modifying the database.
   * This is a read-only operation useful for reconciliation.
   */
  async verifyTransactionOnChain(
    transactionHash: string,
  ): Promise<{
    status: 'pending' | 'success' | 'failed' | 'not_found';
    details?: any;
  }> {
    try {
      this.logger.debug(`Verifying transaction on-chain: ${transactionHash}`);

      const receipt = await this.provider.getTransactionReceipt(transactionHash);

      if (!receipt) {
        this.logger.warn(
          `Transaction receipt not found on-chain: ${transactionHash}`,
        );
        return { status: 'not_found' };
      }

      // Check the transaction execution status
      const executionStatus = (receipt as any).execution_status || (receipt as any).status;
      const revertReason = (receipt as any).revert_reason;

      if (executionStatus === 'SUCCEEDED' || executionStatus === 'succeeded') {
        this.logger.log(
          `Transaction verified as successful on-chain: ${transactionHash}`,
        );
        return {
          status: 'success',
          details: {
            blockNumber: (receipt as any).block_number,
            blockHash: (receipt as any).block_hash,
          },
        };
      } else if (
        executionStatus === 'FAILED' ||
        executionStatus === 'failed' ||
        revertReason
      ) {
        this.logger.error(
          `Transaction failed on-chain: ${transactionHash}, reason: ${revertReason}`,
        );
        return {
          status: 'failed',
          details: { revertReason },
        };
      } else if (
        executionStatus === 'PENDING' ||
        executionStatus === 'pending' ||
        !executionStatus
      ) {
        this.logger.debug(
          `Transaction still pending on-chain: ${transactionHash}`,
        );
        return {
          status: 'pending',
          details: {
            blockNumber: (receipt as any).block_number,
          },
        };
      }

      // Unknown status
      this.logger.warn(
        `Unknown transaction status on-chain: ${transactionHash}, status: ${executionStatus}`,
      );
      return { status: 'not_found' };
    } catch (error) {
      this.logger.error(
        `Error verifying transaction on-chain: ${transactionHash}, error: ${error.message}`,
      );
      // If we can't verify, assume we need more time
      return { status: 'not_found' };
    }
  }

  /**
   * Performs reconciliation for a specific transaction.
   * Updates the transaction status based on the on-chain state.
   */
  async reconcileTransaction(idempotencyKey: string): Promise<void> {
    try {
      const transactionStatus =
        await this.reconciliationService.getTransactionStatus(idempotencyKey);

      if (!transactionStatus) {
        this.logger.warn(
          `No transaction found for idempotency key: ${idempotencyKey}`,
        );
        return;
      }

      // Skip if already confirmed
      if (transactionStatus.status === TransactionStatusType.CONFIRMED) {
        this.logger.debug(
          `Transaction already confirmed, skipping reconciliation: ${idempotencyKey}`,
        );
        return;
      }

      // If no transaction hash yet, can't verify
      if (!transactionStatus.transactionHash) {
        this.logger.debug(
          `No transaction hash available yet, skipping verification: ${idempotencyKey}`,
        );
        return;
      }

      // Verify the transaction on-chain
      const verification = await this.verifyTransactionOnChain(
        transactionStatus.transactionHash,
      );

      switch (verification.status) {
        case 'success':
          await this.reconciliationService.updateTransactionConfirmed(
            idempotencyKey,
            verification.details,
          );
          this.logger.log(
            `Transaction reconciled as confirmed: ${idempotencyKey}`,
          );
          break;

        case 'failed':
          await this.reconciliationService.updateTransactionFailed(
            idempotencyKey,
            `On-chain verification failed: ${verification.details?.revertReason || 'unknown reason'}`,
          );
          this.logger.error(
            `Transaction reconciled as failed: ${idempotencyKey}`,
          );
          break;

        case 'pending':
          // Still pending, update the reconciliation timestamp but keep status
          await this.reconciliationService.getTransactionStatus(idempotencyKey);
          this.logger.debug(
            `Transaction still pending on-chain: ${idempotencyKey}`,
          );
          break;

        case 'not_found':
          // Mark as unknown to trigger further reconciliation
          if (
            transactionStatus.retryCount >= 3 ||
            (new Date().getTime() - transactionStatus.createdAt.getTime()) >
              15 * 60 * 1000 // 15 minutes
          ) {
            // If we've retried multiple times or it's old, mark as unknown
            await this.reconciliationService.markUnknownStatus(idempotencyKey);
            this.logger.warn(
              `Transaction marked as unknown (not found after retries): ${idempotencyKey}`,
            );
          }
          break;
      }
    } catch (error) {
      this.logger.error(
        `Error during transaction reconciliation: ${idempotencyKey}, error: ${error.message}`,
      );
    }
  }

  /**
   * Performs bulk reconciliation for all pending/unknown transactions.
   */
  async reconcileAllPendingTransactions(): Promise<void> {
    try {
      this.logger.debug('Starting bulk transaction reconciliation...');

      const pendingTransactions =
        await this.reconciliationService.getTransactionsNeedingReconciliation();

      if (pendingTransactions.length === 0) {
        this.logger.debug('No pending transactions to reconcile');
        return;
      }

      this.logger.log(
        `Reconciling ${pendingTransactions.length} pending transactions`,
      );

      for (const transaction of pendingTransactions) {
        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
          await this.reconcileTransaction(transaction.idempotencyKey);
        } catch (error) {
          this.logger.error(
            `Failed to reconcile transaction ${transaction.idempotencyKey}: ${error.message}`,
          );
        }
      }

      this.logger.log('Bulk transaction reconciliation completed');
    } catch (error) {
      this.logger.error(
        `Error during bulk reconciliation: ${error.message}`,
      );
    }
  }
}
