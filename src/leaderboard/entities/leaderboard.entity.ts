import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('leaderboard')
@Index(['score'], { unique: false })
export class Leaderboard {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid' })
  @Index({ unique: true })
  userId!: string;

  @Column({ type: 'integer', default: 0 })
  score!: number;

  @Column({ type: 'integer', default: 0 })
  rank!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
