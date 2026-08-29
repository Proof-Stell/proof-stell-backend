import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Role } from '../../common/enums/role.enum';
import { GameSession } from '../../game-session/entities/game-session.entity';
import { Leaderboard } from '../../leaderboard/entities/leaderboard.entity';
import { UserBadge } from '../../badge/entities/user-badge.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  @Exclude()
  password: string;

  @Column()
  username: string;

  @Column({
    type: 'enum',
    enum: Role,
    default: Role.PLAYER,
  })
  role: Role;

  @Column({ nullable: true })
  walletAddress?: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ nullable: true })
  emailVerificationToken?: string;

  @Column({ nullable: true, type: 'timestamp' })
  emailVerificationExpires?: Date;

  @Column({ nullable: true })
  lastLogin?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true, length: 50 })
  displayName?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ type: 'simple-json', nullable: true })
  emailPreferences?: {
    promotional: boolean;
    transactional: boolean;
  };

  // Game statistics
  @Column({ default: 0 })
  gamesPlayed: number;

  @Column({ default: 0 })
  totalScore: number;

  @Column({ default: 0 })
  highestScore: number;

  @Column({ default: 0 })
  referrals: number;

  @Column({ default: 0 })
  currentStreak: number;

  @Column({ default: 0 })
  longestStreak: number;

  // Relations
  @OneToMany(() => GameSession, (game) => game.user)
  gameSessions: GameSession[];

  @OneToMany(() => UserBadge, (userBadge) => userBadge.user)
  userBadges: UserBadge[];

  @OneToOne(() => Leaderboard, (leaderboard) => leaderboard.user)
  leaderboard: Leaderboard;
}
