import {
  IsString,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
  MinLength,
  IsOptional,
} from 'class-validator';

export type NotificationType =
  | 'info'
  | 'reward'
  | 'challenge'
  | 'system'
  | 'game_event'
  | 'leaderboard';

export class CreateNotificationDto {
  @IsArray()
  @ArrayNotEmpty()
  userIds: string[];

  @IsString()
  @MinLength(2)
  title: string;

  @IsString()
  @MinLength(2)
  message: string;

  @IsEnum([
    'info',
    'reward',
    'challenge',
    'system',
    'game_event',
    'leaderboard',
  ])
  type: NotificationType;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  eventId?: string; // Optional id to deduplicate notifications across submissions
}
