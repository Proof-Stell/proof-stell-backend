import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TransactionStatusType {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  UNKNOWN = 'unknown',
}

@Entity('transaction_status')
@Index(['idempotencyKey'], { unique: true })
@Index(['transactionHash'])
@Index(['userId', 'operationType'])
@Index(['status'])
export class TransactionStatus {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Stable idempotency key to prevent duplicate submissions.
   * Format: "${userId}:${operationType}:${nonce}:${timestamp}"
   */
  @Column({ unique: true })
  idempotencyKey: string;

  @Column()
  userId: number;

  @Column()
  operationType: string; // 'mint', 'transfer', 'burn', etc.

  @Column({ nullable: true })
  transactionHash: string;

  @Column({
    type: 'enum',
    enum: TransactionStatusType,
    default: TransactionStatusType.PENDING,
  })
  status: TransactionStatusType;

  @Column({ default: 0 })
  retryCount: number;

  @Column({ nullable: true })
  errorMessage: string;

  /**
   * Additional metadata for the transaction
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  /**
   * Timestamp of the last reconciliation check
   */
  @Column({ nullable: true })
  lastReconciledAt: Date;

  /**
   * Request parameters that were used to create this transaction
   */
  @Column({ type: 'jsonb', nullable: true })
  requestParameters: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
