import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('mint')
@Index(['userId'])
@Index(['transactionHash'])
@Index(['idempotencyKey'], { unique: true })
export class Mint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ nullable: true })
  transactionHash: string;

  /**
   * Idempotency key to prevent duplicate mint operations.
   * References the key in TransactionStatus entity.
   */
  @Column({ unique: true, nullable: true })
  idempotencyKey: string;

  /**
   * Transaction status: 'pending', 'confirmed', 'failed'
   */
  @Column({ default: 'pending' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
