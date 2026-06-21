import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Challenge } from './entities/challenge.entity';
import { ChallengeAttempt } from './entities/challenge-attempt.entity';
import { UserDifficultyProfile } from './entities/user-difficulty-profile.entity';
import { ScheduledChallenge } from './entities/scheduled-challenge.entity';
import { ChallengesService } from './services/challenges.service';
import { DynamicDifficultyService } from './services/dynamic-difficulty.service';
import { ChallengeGenerationService } from './services/challenge-generation.service';
import { ScheduledChallengeService } from './services/scheduled-challenge.service';
import { ChallengesController } from './challenges.controller';
import { DailyChallengeService } from './services/daily-challenge.service';
import { DailyChallenge } from './entities/daily-challenge.entity';
import { ChallengeParticipation } from './entities/challenge-participation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Challenge,
      ChallengeAttempt,
      UserDifficultyProfile,
      ScheduledChallenge,
      DailyChallenge,
      ChallengeParticipation,
    ]),
    ScheduleModule.forRoot(),
  ],
  controllers: [ChallengesController],
  providers: [
    ChallengesService,
    DynamicDifficultyService,
    ChallengeGenerationService,
    ScheduledChallengeService,
    DailyChallengeService,
  ],
  exports: [
    ChallengesService,
    DynamicDifficultyService,
    ChallengeGenerationService,
    ScheduledChallengeService,
    DailyChallengeService,
  ],
})
export class ChallengesModule {}
