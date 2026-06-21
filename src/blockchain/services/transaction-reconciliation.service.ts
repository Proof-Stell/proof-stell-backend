import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransactionStatus,
  TransactionStatusType,
} from '../entities/transaction-status.entity';
import * as crypto from 'crypto';

/**
 * Generates a stable idempotency key based on user, operation type, and parameters.
 * This ensures that identical requests can be safely retried without duplicate submissions.
 */
export function generateIdempotencyKey(
  userId: number,
  operationType: string,
  nonce?: string,
): string {
  const key = `${userId}:${operationType}:${nonce || crypto.randomBytes(8).toString('hex')}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

interface TransactionReconciliationOptions {
  userId: number;
  operationType: string;
  idempotencyKey: string;
  requestParameters: Record<string, any>;
}

@Injectable()
export class TransactionReconciliationService {
  private readonly logger = new Logger(TransactionReconciliationService.name);

  constructor(
    @InjectRepository(TransactionStatus)
    private readonly transactionStatusRepo: Repository<TransactionStatus>,
  ) {}

  /**
   * Checks if a transaction with the given idempotency key already exists.
   * If it does and was successful, returns the existing transaction hash.
   * This prevents duplicate submissions for the same operation.
   */
  async checkExistingTransaction(
    idempotencyKey: string,
  ): Promise<TransactionStatus | null> {
    const existing = await this.transactionStatusRepo.findOne({
      where: { idempotencyKey },
    });

    if (existing) {
      this.logger.debug(
        `Found existing transaction for idempotency key ${idempotencyKey}: ` +
          `hash=${existing.transactionHash}, status=${existing.status}`,
      );
    }

    return existing;
  }

  /**
   * Records a new transaction submission attempt.
   * This is called when a transaction is about to be broadcast.
   */
  async recordTransactionAttempt(
    options: TransactionReconciliationOptions,
  ): Promise<TransactionStatus> {
    const existing = await this.checkExistingTransaction(
      options.idempotencyKey,
    );

    if (existing) {
      if (existing.status === TransactionStatusType.CONFIRMED) {
        this.logger.warn(
          `Duplicate submission prevented: idempotencyKey=${options.idempotencyKey}, ` +
            `existing hash=${existing.transactionHash}`,
        );
        // Return the existing confirmed transaction instead of creating a new one
        return existing;
      } else if (
        existing.status === TransactionStatusType.PENDING &&
        existing.retryCount < 3
      ) {
        // Allow retries for pending transactions
        existing.retryCount += 1;
        return this.transactionStatusRepo.save(existing);
      } else if (existing.status === TransactionStatusType.FAILED) {
        // Reset failed transactions to allow retry
        existing.status = TransactionStatusType.PENDING;
        existing.retryCount = 1;
        existing.errorMessage = null;
        return this.transactionStatusRepo.save(existing);
      }
    }

    // Create a new transaction status record
    const transactionStatus = this.transactionStatusRepo.create({
      idempotencyKey: options.idempotencyKey,
      userId: options.userId,
      operationType: options.operationType,
      status: TransactionStatusType.PENDING,
      retryCount: 1,
      requestParameters: options.requestParameters,
    });

    return this.transactionStatusRepo.save(transactionStatus);
  }

  /**
   * Updates the transaction status after successful broadcast.
   * This should be called immediately after receiving the transaction hash from the provider.
   */
  async updateTransactionBroadcast(
    idempotencyKey: string,
    transactionHash: string,
  ): Promise<TransactionStatus> {
    const transaction = await this.transactionStatusRepo.findOne({
      where: { idempotencyKey },
    });

    if (!transaction) {
      throw new BadRequestException(
        `Transaction record not found for idempotency key: ${idempotencyKey}`,
      );
    }

    transaction.transactionHash = transactionHash;
    transaction.status = TransactionStatusType.PENDING;
    transaction.lastReconciledAt = new Date();

    this.logger.log(
      `Transaction broadcast recorded: idempotencyKey=${idempotencyKey}, hash=${transactionHash}`,
    );

    return this.transactionStatusRepo.save(transaction);
  }

  /**
   * Updates the transaction status after confirmation.
   * This should be called when the transaction is confirmed on-chain.
   */
  async updateTransactionConfirmed(
    idempotencyKey: string,
    metadata?: Record<string, any>,
  ): Promise<TransactionStatus> {
    const transaction = await this.transactionStatusRepo.findOne({
      where: { idempotencyKey },
    });

    if (!transaction) {
      throw new BadRequestException(
        `Transaction record not found for idempotency key: ${idempotencyKey}`,
      );
    }

    transaction.status = TransactionStatusType.CONFIRMED;
    transaction.errorMessage = null;
    transaction.lastReconciledAt = new Date();

    if (metadata) {
      transaction.metadata = { ...transaction.metadata, ...metadata };
    }

    this.logger.log(
      `Transaction confirmed: idempotencyKey=${idempotencyKey}, hash=${transaction.transactionHash}`,
    );

    return this.transactionStatusRepo.save(transaction);
  }

  /**
   * Updates the transaction status after failure.
   * Records the error for debugging and allows future retries.
   */
  async updateTransactionFailed(
    idempotencyKey: string,
    errorMessage: string,
  ): Promise<TransactionStatus> {
    const transaction = await this.transactionStatusRepo.findOne({
      where: { idempotencyKey },
    });

    if (!transaction) {
      throw new BadRequestException(
        `Transaction record not found for idempotency key: ${idempotencyKey}`,
      );
    }

    transaction.status = TransactionStatusType.FAILED;
    transaction.errorMessage = errorMessage;
    transaction.lastReconciledAt = new Date();

    this.logger.error(
      `Transaction failed: idempotencyKey=${idempotencyKey}, error=${errorMessage}`,
    );

    return this.transactionStatusRepo.save(transaction);
  }

  /**
   * Marks a transaction as unknown status (reconciliation needed).
   * This is called when we can't determine the actual status after a transient failure.
   */
  async markUnknownStatus(idempotencyKey: string): Promise<TransactionStatus> {
    const transaction = await this.transactionStatusRepo.findOne({
      where: { idempotencyKey },
    });

    if (!transaction) {
      throw new BadRequestException(
        `Transaction record not found for idempotency key: ${idempotencyKey}`,
      );
    }

    transaction.status = TransactionStatusType.UNKNOWN;
    transaction.lastReconciledAt = new Date();

    this.logger.warn(
      `Transaction status marked as unknown: idempotencyKey=${idempotencyKey}`,
    );

    return this.transactionStatusRepo.save(transaction);
  }

  /**
   * Retrieves transaction status for reconciliation.
   * Returns transactions that need to be checked against the blockchain.
   */
  async getTransactionsNeedingReconciliation(
    maxAgeMs: number = 5 * 60 * 1000, // 5 minutes
  ): Promise<TransactionStatus[]> {
    const cutoffTime = new Date(Date.now() - maxAgeMs);

    const transactions = await this.transactionStatusRepo.find({
      where: [
        {
          status: TransactionStatusType.PENDING,
        },
        {
          status: TransactionStatusType.UNKNOWN,
        },
      ],
      order: { createdAt: 'ASC' },
    });

    // Filter to transactions that are either old pending or unknown
    return transactions.filter((tx) => {
      const lastReconciled = tx.lastReconciledAt || tx.createdAt;
      return lastReconciled < cutoffTime || tx.status === TransactionStatusType.UNKNOWN;
    });
  }

  /**
   * Gets the status of a transaction by idempotency key.
   */
  async getTransactionStatus(
    idempotencyKey: string,
  ): Promise<TransactionStatus | null> {
    return this.transactionStatusRepo.findOne({
      where: { idempotencyKey },
    });
  }

  /**
   * Gets recent transactions for a user.
   */
  async getUserTransactions(
    userId: number,
    limit: number = 50,
  ): Promise<TransactionStatus[]> {
    return this.transactionStatusRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
