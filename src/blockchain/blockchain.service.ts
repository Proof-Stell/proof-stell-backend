import { Inject, Injectable, forwardRef, Logger, BadRequestException } from '@nestjs/common';
import { Provider, Account, Contract } from 'starknet';
import { TypedConfigService } from '../common/config/typed-config.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics-event.enum';
import { TransactionReconciliationService, generateIdempotencyKey } from './services/transaction-reconciliation.service';
import { TransactionStatusType } from './entities/transaction-status.entity';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private provider: Provider;
  private account: Account;

  constructor(
    private readonly configService: TypedConfigService,
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analyticsService: AnalyticsService,
    private readonly reconciliationService: TransactionReconciliationService,
  ) {
    this.provider = new Provider({
      nodeUrl: this.configService.starknetRpcUrl ||
        'https://starknet-goerli.g.alchemy.com/v2/demo',
    });
    const privateKey = this.configService.starknetPrivateKey;
    const accountAddress = this.configService.starknetAccountAddress;
    this.account = new Account(this.provider, accountAddress, privateKey);
  }

  async checkHealth(): Promise<void> {
    try {
      await this.provider.getBlockNumber();
    } catch {
      throw new Error('Blockchain provider is unavailable');
    }
  }

  /**
   * Sends an idempotent mint transaction.
   * Uses an idempotency key to prevent duplicate submissions if retried.
   * @param userId The user ID to mint tokens for
   * @param nonce Optional nonce for generating the idempotency key
   * @returns Object with transaction_hash and idempotencyKey
   */
  async sendMintTx(
    userId: number,
    nonce?: string,
  ): Promise<{ transaction_hash: string; idempotencyKey: string }> {
    const idempotencyKey = generateIdempotencyKey(userId, 'mint', nonce);

    // Check if we already have a successful transaction for this operation
    const existing = await this.reconciliationService.checkExistingTransaction(
      idempotencyKey,
    );

    if (
      existing &&
      existing.status === TransactionStatusType.CONFIRMED &&
      existing.transactionHash
    ) {
      this.logger.log(
        `Returning existing confirmed mint transaction: ${existing.transactionHash}`,
      );
      return {
        transaction_hash: existing.transactionHash,
        idempotencyKey,
      };
    }

    // Record the attempt
    const txStatus = await this.reconciliationService.recordTransactionAttempt({
      userId,
      operationType: 'mint',
      idempotencyKey,
      requestParameters: { userId },
    });

    try {
      const contractAddress = this.configService.mintContractAddress;
      const tx = await this.account.execute({
        contractAddress,
        entrypoint: 'mint',
        calldata: [userId.toString()],
      });

      const txHash = tx.transaction_hash;

      // Update with the broadcasted hash
      await this.reconciliationService.updateTransactionBroadcast(
        idempotencyKey,
        txHash,
      );

      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.TokenMinted, {
          userId: String(userId),
          metadata: {
            transaction_hash: txHash,
            idempotencyKey,
          },
        });
      }

      this.logger.log(
        `Mint transaction sent: userId=${userId}, hash=${txHash}, idempotencyKey=${idempotencyKey}`,
      );

      return {
        transaction_hash: txHash,
        idempotencyKey,
      };
    } catch (error) {
      this.logger.error(
        `Mint transaction failed: userId=${userId}, error=${error.message}`,
      );

      // Mark as failed for retry logic
      await this.reconciliationService.updateTransactionFailed(
        idempotencyKey,
        error.message,
      );

      throw error;
    }
  }

  /**
   * Sends an idempotent transfer transaction.
   * @param fromUserId The user ID sending tokens
   * @param toUserId The user ID receiving tokens
   * @param amount The amount to transfer
   * @param nonce Optional nonce for generating the idempotency key
   * @returns Object with transaction_hash and idempotencyKey
   */
  async sendTransferTx(
    fromUserId: number,
    toUserId: number,
    amount: number,
    nonce?: string,
  ): Promise<{ transaction_hash: string; idempotencyKey: string }> {
    const idempotencyKey = generateIdempotencyKey(
      fromUserId,
      `transfer:${toUserId}:${amount}`,
      nonce,
    );

    // Check if we already have a successful transaction for this operation
    const existing = await this.reconciliationService.checkExistingTransaction(
      idempotencyKey,
    );

    if (
      existing &&
      existing.status === TransactionStatusType.CONFIRMED &&
      existing.transactionHash
    ) {
      this.logger.log(
        `Returning existing confirmed transfer transaction: ${existing.transactionHash}`,
      );
      return {
        transaction_hash: existing.transactionHash,
        idempotencyKey,
      };
    }

    // Record the attempt
    await this.reconciliationService.recordTransactionAttempt({
      userId: fromUserId,
      operationType: `transfer`,
      idempotencyKey,
      requestParameters: { fromUserId, toUserId, amount },
    });

    try {
      const contractAddress = this.configService.mintContractAddress;
      const tx = await this.account.execute({
        contractAddress,
        entrypoint: 'transfer',
        calldata: [
          fromUserId.toString(),
          toUserId.toString(),
          amount.toString(),
        ],
      });

      const txHash = tx.transaction_hash;

      // Update with the broadcasted hash
      await this.reconciliationService.updateTransactionBroadcast(
        idempotencyKey,
        txHash,
      );

      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.TokenTransferred, {
          userId: String(fromUserId),
          metadata: {
            toUserId,
            amount,
            transaction_hash: txHash,
            idempotencyKey,
          },
        });
      }

      this.logger.log(
        `Transfer transaction sent: from=${fromUserId}, to=${toUserId}, amount=${amount}, hash=${txHash}`,
      );

      return {
        transaction_hash: txHash,
        idempotencyKey,
      };
    } catch (error) {
      this.logger.error(
        `Transfer transaction failed: from=${fromUserId}, to=${toUserId}, error=${error.message}`,
      );

      await this.reconciliationService.updateTransactionFailed(
        idempotencyKey,
        error.message,
      );

      throw error;
    }
  }

  /**
   * Sends an idempotent burn transaction.
   * @param userId The user ID burning tokens
   * @param amount The amount to burn
   * @param nonce Optional nonce for generating the idempotency key
   * @returns Object with transaction_hash and idempotencyKey
   */
  async sendBurnTx(
    userId: number,
    amount: number,
    nonce?: string,
  ): Promise<{ transaction_hash: string; idempotencyKey: string }> {
    const idempotencyKey = generateIdempotencyKey(
      userId,
      `burn:${amount}`,
      nonce,
    );

    // Check if we already have a successful transaction for this operation
    const existing = await this.reconciliationService.checkExistingTransaction(
      idempotencyKey,
    );

    if (
      existing &&
      existing.status === TransactionStatusType.CONFIRMED &&
      existing.transactionHash
    ) {
      this.logger.log(
        `Returning existing confirmed burn transaction: ${existing.transactionHash}`,
      );
      return {
        transaction_hash: existing.transactionHash,
        idempotencyKey,
      };
    }

    // Record the attempt
    await this.reconciliationService.recordTransactionAttempt({
      userId,
      operationType: `burn`,
      idempotencyKey,
      requestParameters: { userId, amount },
    });

    try {
      const contractAddress = this.configService.mintContractAddress;
      const tx = await this.account.execute({
        contractAddress,
        entrypoint: 'burn',
        calldata: [userId.toString(), amount.toString()],
      });

      const txHash = tx.transaction_hash;

      // Update with the broadcasted hash
      await this.reconciliationService.updateTransactionBroadcast(
        idempotencyKey,
        txHash,
      );

      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.TokenBurned, {
          userId: String(userId),
          metadata: { amount, transaction_hash: txHash, idempotencyKey },
        });
      }

      this.logger.log(
        `Burn transaction sent: userId=${userId}, amount=${amount}, hash=${txHash}`,
      );

      return {
        transaction_hash: txHash,
        idempotencyKey,
      };
    } catch (error) {
      this.logger.error(
        `Burn transaction failed: userId=${userId}, error=${error.message}`,
      );

      await this.reconciliationService.updateTransactionFailed(
        idempotencyKey,
        error.message,
      );

      throw error;
    }
  }

  async getBalance(userId: number): Promise<{ balance: string }> {
    const contractAddress = this.configService.mintContractAddress;
    const contract = new Contract([], contractAddress, this.provider);
    const result = await contract.call('balanceOf', [userId.toString()]);
    const balance = result?.toString() || '0';
    return { balance };
  }
}
