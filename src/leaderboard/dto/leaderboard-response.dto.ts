import { Expose, Type } from 'class-transformer';
import { ReadUserDto } from '../../users/dto/read-user.dto';

export class LeaderboardResponseDto {
  @Expose()
  id: number;

  @Expose()
  userId: string;

  @Expose()
  score: number;

  @Expose()
  rank: number;

  @Expose()
  updatedAt: Date;

  @Expose()
  @Type(() => ReadUserDto)
  user: ReadUserDto;
}

export class GlobalLeaderboardResponseDto {
  @Expose()
  @Type(() => LeaderboardResponseDto)
  leaderboard: LeaderboardResponseDto[];

  @Expose()
  total: number;

  @Expose()
  page: number;

  @Expose()
  limit: number;
}
