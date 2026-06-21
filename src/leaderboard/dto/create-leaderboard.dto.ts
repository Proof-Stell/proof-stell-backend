import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CreateLeaderboardDto {
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  score: number;
}
