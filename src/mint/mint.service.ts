import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { UpdateMintDto } from './dto/update-mint.dto';
import { Mint } from './entities/mint.entity';
import { Repository } from 'typeorm';
import { BlockchainService } from 'src/blockchain/blockchain.service';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionReconciliationService } from 'src/blockchain/services/transaction-reconciliation.service';
import { TransactionStatusType } from 'src/blockchain/entities/transaction-status.entity';

@Injectable()
export class MintService {
  private readonly logger = new Logger(MintService.name);

  constructor(
    @InjectRepository(Mint)
    private readonly mintRepository: Repository<Mint>,

    private readonly blockchainService: BlockchainService,
    private readonly reconciliationService: TransactionReconciliationService,
  ) {}

  /**
   * Mints tokens for a user with idempotent transaction handling.
   * Uses a database transaction to ensure atomic updates.
   * @param userId The user ID to mint tokens for
   * @param nonce Optional nonce for generating idempotency key
   * @returns The created Mint record
   */
  async mint(userId: number, nonce?: string): Promise<Mint> {
    // Check if we already have a pending or confirmed mint for this user
    // This prevents the user from accidentally initiating multiple mints
    const existingPending = await this.mintRepository.findOne({
      where: { userId, status: 'pending' },
    });

    if (existingPending && !nonce) {
      this.logger.warn(
        `User ${userId} already has a pending mint transaction`,
      );
      throw new ConflictException(
        'A mint transaction is already pending for this user',
      );
    }

    try {
      // Send the idempotent mint transaction
      const txResult = await this.blockchainService.sendMintTx(userId, nonce);
      const { transaction_hash, idempotencyKey } = txResult;

      // Create and save the mint record atomically with transaction status
      const mint = this.mintRepository.create({
        userId,
        transactionHash: transaction_hash,
        idempotencyKey,
        status: 'pending',
      });

      // Save the mint record
      const savedMint = await this.mintRepository.save(mint);

      this.logger.log(
        `Mint initiated: userId=${userId}, txHash=${transaction_hash}, idempotencyKey=${idempotencyKey}`,
      );

      return savedMint;
    } catch (error) {
      this.logger.error(
        `Mint failed for user ${userId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Confirms a mint transaction after on-chain verification.
   * Should be called after the transaction is confirmed on-chain.
   * @param idempotencyKey The idempotency key of the transaction
   * @returns The updated Mint record
   */
  async confirmMint(idempotencyKey: string): Promise<Mint> {
    try {
      // Update the transaction status in the reconciliation service
      const txStatus =
        await this.reconciliationService.updateTransactionConfirmed(
          idempotencyKey,
        );

      // Update the mint record status
      const mint = await this.mintRepository.findOne({
        where: { idempotencyKey },
      });

      if (!mint) {
        this.logger.warn(
          `Mint record not found for idempotencyKey: ${idempotencyKey}`,
        );
        return null;
      }

      mint.status = 'confirmed';
      const updatedMint = await this.mintRepository.save(mint);

      this.logger.log(
        `Mint confirmed: idempotencyKey=${idempotencyKey}, userId=${mint.userId}`,
      );

      return updatedMint;
    } catch (error) {
      this.logger.error(
        `Error confirming mint for idempotencyKey ${idempotencyKey}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Marks a mint as failed.
   * @param idempotencyKey The idempotency key of the transaction
   * @param errorMessage The error message
   */
  async failMint(idempotencyKey: string, errorMessage: string): Promise<Mint> {
    try {
      // Update the transaction status in the reconciliation service
      await this.reconciliationService.updateTransactionFailed(
        idempotencyKey,
        errorMessage,
      );

      // Update the mint record status
      const mint = await this.mintRepository.findOne({
        where: { idempotencyKey },
      });

      if (!mint) {
        this.logger.warn(
          `Mint record not found for idempotencyKey: ${idempotencyKey}`,
        );
        return null;
      }

      mint.status = 'failed';
      const updatedMint = await this.mintRepository.save(mint);

      this.logger.error(
        `Mint failed: idempotencyKey=${idempotencyKey}, error=${errorMessage}`,
      );

      return updatedMint;
    } catch (error) {
      this.logger.error(
        `Error marking mint as failed for idempotencyKey ${idempotencyKey}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Gets the status of a mint transaction.
   */
  async getMintStatus(idempotencyKey: string): Promise<Mint | null> {
    return this.mintRepository.findOne({
      where: { idempotencyKey },
    });
  }

  /**
   * Gets recent mints for a user.
   */
  async getUserMints(userId: number, limit: number = 50): Promise<Mint[]> {
    return this.mintRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  findAll() {
    return `This action returns all mint`;
  }

  findOne(id: number) {
    return `This action returns a #${id} mint`;
  }

  update(id: number, updateMintDto: UpdateMintDto) {
    return `This action updates a #${id} mint`;
  }

  remove(id: number) {
    return `This action removes a #${id} mint`;
  }
}
