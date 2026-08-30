import { User } from 'src/users/entities/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

export enum GameStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

@Entity('games')
@Index(['userId', 'createdAt'])
@Index(['status'])
@Index(['score'])
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column()
  score: number;

  @Column({ default: 0 })
  maxPossibleScore: number;

  @Column({
    type: 'enum',
    enum: GameStatus,
    default: GameStatus.IN_PROGRESS,
  })
  status: GameStatus;

  @Column({ default: 0 })
  duration: number; // in seconds

  @Column({ default: 1 })
  level: number;

  @Column('jsonb', { nullable: true })
  gameData: {
    gameType?: string;
    difficulty?: string;
    achievements?: string[];
    metadata?: Record<string, any>;
  };

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
