import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { GameSession } from './entities/game-session.entity';
import { InputEvent } from './entities/input-event.entity';
import { ReportSessionDto } from './dto/report-session.dto';
import { StartSessionDto } from './dto/start-session.dto';
import * as crypto from 'crypto';

export interface SessionAnalytics {
  totalSessions: string;
  averageScore: number;
  highestScore: number;
  averageDuration: number;
}

@Injectable()
export class GameSessionService {
  private readonly logger = new Logger(GameSessionService.name);

  constructor(
    @InjectRepository(GameSession)
    private gameSessionRepository: Repository<GameSession>,
    @InjectRepository(InputEvent)
    private inputEventRepository: Repository<InputEvent>,
    private dataSource: DataSource,
  ) {}

  async startSession(
    userId: string,
    dto: StartSessionDto,
  ): Promise<{ sessionId: string; nonce: string }> {
    const nonce = crypto.randomBytes(32).toString('hex');
    const gameSession = this.gameSessionRepository.create({
      userId,
      challengeId: dto.challengeId,
      nonce,
      isVerified: false,
    });
    const savedSession = await this.gameSessionRepository.save(gameSession);
    return { sessionId: savedSession.id, nonce };
  }

  async reportSession(
    userId: string,
    reportSessionDto: ReportSessionDto,
  ): Promise<GameSession> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const gameSession = await queryRunner.manager.findOne(GameSession, {
        where: { id: reportSessionDto.sessionId, userId },
      });

      if (!gameSession) {
        throw new NotFoundException(
          'Session not found or does not belong to you',
        );
      }

      if (gameSession.nonceUsedAt) {
        throw new BadRequestException('Session has already been reported');
      }

      // Verify session HMAC integrity
      const calculatedHash = this.calculateSessionHash(
        gameSession.nonce,
        reportSessionDto,
      );
      if (calculatedHash !== reportSessionDto.signature) {
        throw new BadRequestException('Session integrity check failed');
      }

      // Update game session
      gameSession.score = reportSessionDto.score;
      gameSession.duration = reportSessionDto.duration;
      gameSession.metadata = reportSessionDto.metadata;
      gameSession.isVerified = true;
      gameSession.nonceUsedAt = new Date();

      const savedSession = await queryRunner.manager.save(
        GameSession,
        gameSession,
      );

      // Create input events in batches for performance
      const batchSize = 1000;
      const inputBatches = this.chunkArray(reportSessionDto.inputs, batchSize);

      for (const batch of inputBatches) {
        const inputEvents = batch.map((input) =>
          queryRunner.manager.create(InputEvent, {
            gameSessionId: savedSession.id,
            eventType: input.eventType,
            timestamp: input.timestamp,
            eventData: input.eventData,
            clientId: input.clientId,
          }),
        );

        await queryRunner.manager.save(InputEvent, inputEvents);
      }

      await queryRunner.commitTransaction();

      this.logger.log(
        `Game session reported successfully for user ${userId}, session ${savedSession.id}`,
      );

      return savedSession;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to report session for user ${userId}: ${errorMessage}`,
        error instanceof Error ? error.stack : '',
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findSessionsByUser(
    userId: string,
    requestingUser: { id: string; role: string },
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ sessions: GameSession[]; total: number }> {
    if (requestingUser.id !== userId && requestingUser.role !== 'admin') {
      throw new ForbiddenException('You can only access your own sessions');
    }

    // Avoid eager loading of large relations by default. Load only summary fields for listing.
    const [sessions, total] = await this.gameSessionRepository
      .createQueryBuilder('gs')
      .select([
        'gs.id',
        'gs.userId',
        'gs.challengeId',
        'gs.score',
        'gs.duration',
        'gs.createdAt',
      ])
      .where('gs.userId = :userId', { userId })
      .orderBy('gs.createdAt', 'DESC')
      .limit(limit)
      .offset(offset)
      .getManyAndCount();

    return { sessions, total };
  }

  async findSessionById(sessionId: string): Promise<GameSession> {
    const session = await this.gameSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user', 'challenge', 'inputs'],
    });

    if (!session) {
      throw new NotFoundException('Game session not found');
    }

    return session;
  }

  async getSessionAnalytics(
    userId?: string,
    challengeId?: string,
  ): Promise<SessionAnalytics> {
    const queryBuilder = this.gameSessionRepository.createQueryBuilder('gs');

    if (userId) {
      queryBuilder.andWhere('gs.userId = :userId', { userId });
    }

    if (challengeId) {
      queryBuilder.andWhere('gs.challengeId = :challengeId', { challengeId });
    }

    const analytics = await queryBuilder
      .select([
        'COUNT(*) as totalSessions',
        'AVG(gs.score) as averageScore',
        'MAX(gs.score) as highestScore',
        'AVG(gs.duration) as averageDuration',
      ])
      .getRawOne<{
        totalSessions: string;
        averageScore: number;
        highestScore: number;
        averageDuration: number;
      }>();

    return analytics as SessionAnalytics;
  }

  private calculateSessionHash(
    nonce: string,
    sessionData: ReportSessionDto,
  ): string {
    const dataToHash = {
      challengeId: sessionData.challengeId,
      score: sessionData.score,
      duration: sessionData.duration,
      inputCount: sessionData.inputs.length,
      firstInput: sessionData.inputs[0]?.timestamp || 0,
      lastInput:
        sessionData.inputs[sessionData.inputs.length - 1]?.timestamp || 0,
    };

    const serverSecret =
      process.env.SESSION_HMAC_SECRET || 'default-dev-secret';

    return crypto
      .createHmac('sha256', serverSecret)
      .update(nonce + JSON.stringify(dataToHash))
      .digest('hex');
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
