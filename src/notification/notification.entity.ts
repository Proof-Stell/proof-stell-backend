import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type NotificationType =
  | 'info'
  | 'reward'
  | 'challenge'
  | 'system'
  | 'game_event'
  | 'leaderboard';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  title: string;

  @Column('text')
  message: string;

  @Column({ type: 'varchar' })
  type: NotificationType;

  @Column({ nullable: true })
  icon?: string;

  @Column({ nullable: true })
  eventId?: string;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
