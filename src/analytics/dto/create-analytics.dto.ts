import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsEvent } from '../analytics-event.enum';

export class CreateAnalyticsDto {
  @ApiProperty({
    description: 'Type of analytics event',
    enum: AnalyticsEvent,
    example: AnalyticsEvent.GameStarted,
  })
  @IsEnum(AnalyticsEvent)
  eventType: AnalyticsEvent;

  @ApiProperty({
    description: 'User ID associated with the event',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the event',
    example: { level: 5, score: 1500, gameType: 'mole-hunt' },
  })
  @IsOptional()
  metadata?: Record<string, any>;
}
