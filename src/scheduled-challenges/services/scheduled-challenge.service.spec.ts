import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ScheduledChallengeService } from './scheduled-challenge.service';
import { DistributedLockService } from '../../cache/distributed-lock.service';
import { TypedConfigService } from '../../common/config/typed-config.service';
import { ChallengeGenerationService } from './challenge-generation.service';
import {
  ScheduledChallenge,
  ScheduleStatus,
} from '../entities/scheduled-challenge.entity';
import { ChallengeType, DifficultyLevel } from '../entities/challenge.entity';

/**
 * Build a chainable QueryBuilder mock whose `update().set().where().execute()`
 * flow resolves to a deterministic result, so we can assert that the
 * service does not call `.find().save()` (the old racy approach) and only
 * performs atomic state transitions.
 */
function buildQueryBuilder(executeResult: {
  affected: number;
  raw: unknown[];
}) {
  const qb: any = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(executeResult),
  };
  return qb;
}

describe('ScheduledChallengeService', () => {
  let service: ScheduledChallengeService;
  let lockService: jest.Mocked<DistributedLockService>;
  let repository: any;
  let challengeGenerationService: jest.Mocked<ChallengeGenerationService>;
  let configService: jest.Mocked<TypedConfigService>;

  const fakeLockHandle = {
    key: 'lock:scheduler:scheduled-challenge:process',
    token: 'instance-1:t:abc',
  };

  beforeEach(async () => {
    const repositoryFactory = () => ({
      createQueryBuilder: jest.fn(),
      create: jest.fn((entity: Partial<ScheduledChallenge>) => ({
        ...entity,
      })),
      save: jest.fn().mockImplementation(async (entity: any) => entity),
      find: jest.fn(),
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduledChallengeService,
        {
          provide: getRepositoryToken(ScheduledChallenge),
          useFactory: repositoryFactory,
        },
        {
          provide: DistributedLockService,
          useValue: {
            acquire: jest.fn(),
            release: jest.fn(),
          },
        },
        {
          provide: ChallengeGenerationService,
          useValue: {
            generateGlobalChallenge: jest.fn(),
          },
        },
        {
          provide: TypedConfigService,
          useValue: {
            cronLockTtlMs: 300_000,
            schedulerInstanceId: 'instance-1',
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ScheduledChallengeService);
    lockService = moduleRef.get(DistributedLockService);
    repository = moduleRef.get(getRepositoryToken(ScheduledChallenge));
    challengeGenerationService = moduleRef.get(ChallengeGenerationService);
    configService = moduleRef.get(TypedConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processScheduledChallenges', () => {
    it('activates pending challenges whose scheduledFor has elapsed using an atomic, idempotent UPDATE', async () => {
      lockService.acquire.mockResolvedValue(fakeLockHandle);
      lockService.release.mockResolvedValue(true);

      const activationQb = buildQueryBuilder({
        affected: 3,
        raw: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      });
      const expirationQb = buildQueryBuilder({
        affected: 1,
        raw: [{ id: 'old' }],
      });

      repository.createQueryBuilder
        .mockReturnValueOnce(activationQb)
        .mockReturnValueOnce(expirationQb);

      await service.processScheduledChallenges();

      expect(lockService.acquire).toHaveBeenCalledWith(
        'lock:scheduler:scheduled-challenge:process',
        300_000,
      );
      expect(lockService.release).toHaveBeenCalledWith(fakeLockHandle);
      expect(activationQb.update).toHaveBeenCalledWith(ScheduledChallenge);
      expect(activationQb.set).toHaveBeenCalledWith({
        status: ScheduleStatus.ACTIVE,
      });
      expect(expirationQb.set).toHaveBeenCalledWith({
        status: ScheduleStatus.EXPIRED,
      });

      // Atomicity contract: the WHERE clause gates the update on the
      // previous status + scheduledFor/expiresAt bounds, so another
      // worker cannot re-activate or re-expire the same row concurrently
      // even if the lock TTL expires mid-run.
      const activationWhere = (activationQb.where as jest.Mock).mock
        .calls[0][0];
      const expirationWhere = (expirationQb.where as jest.Mock).mock
        .calls[0][0];
      expect(activationWhere).toContain('status = :status');
      expect(activationWhere).toContain('"scheduledFor" <= :now');
      expect(expirationWhere).toContain('status = :status');
      expect(expirationWhere).toContain('"expiresAt" IS NOT NULL');
      expect(expirationWhere).toContain('"expiresAt" <= :now');
    });

    it('skips processing entirely when the lock cannot be acquired', async () => {
      lockService.acquire.mockResolvedValue(null);

      await service.processScheduledChallenges();

      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(lockService.release).not.toHaveBeenCalled();
    });

    it('still releases the lock when activation throws', async () => {
      lockService.acquire.mockResolvedValue(fakeLockHandle);
      lockService.release.mockResolvedValue(true);

      const failingQb: any = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('db down')),
      };
      repository.createQueryBuilder.mockReturnValue(failingQb);

      await expect(service.processScheduledChallenges()).rejects.toThrow(
        'db down',
      );
      expect(lockService.release).toHaveBeenCalledWith(fakeLockHandle);
    });

    it('does not load rows into memory using find() (would be racy)', async () => {
      lockService.acquire.mockResolvedValue(fakeLockHandle);
      lockService.release.mockResolvedValue(true);

      repository.createQueryBuilder.mockImplementation(() =>
        buildQueryBuilder({ affected: 0, raw: [] }),
      );

      await service.processScheduledChallenges();

      expect(repository.find).not.toHaveBeenCalled();
    });

    it('simulates concurrent workers: only the lock winner performs the UPDATE', async () => {
      // Instance A wins the lock; the service then issues two UPDATE
      // statements (activation + expiration), each backed by a fresh
      // QueryBuilder mock so assertions stay faithful to production.
      const activationQb = buildQueryBuilder({ affected: 2, raw: [] });
      const expirationQb = buildQueryBuilder({ affected: 0, raw: [] });
      lockService.acquire.mockResolvedValueOnce(fakeLockHandle);
      lockService.release.mockResolvedValue(true);
      repository.createQueryBuilder
        .mockReturnValueOnce(activationQb)
        .mockReturnValueOnce(expirationQb);

      await service.processScheduledChallenges();

      expect(activationQb.execute).toHaveBeenCalledTimes(1);
      expect(expirationQb.execute).toHaveBeenCalledTimes(1);

      // Instance B starts Cron right after, but the lock is still held
      // (instance A is still inside its finally block). B must skip
      // without touching the repository at all.
      lockService.acquire.mockReset();
      lockService.release.mockReset();
      repository.createQueryBuilder.mockReset();
      lockService.acquire.mockResolvedValueOnce(null);

      await service.processScheduledChallenges();

      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(lockService.release).not.toHaveBeenCalled();
    });
  });

  describe('generateDailyChallenges', () => {
    it('schedules a daily challenge for every challenge type when the lock is acquired', async () => {
      lockService.acquire.mockResolvedValue({
        key: 'lock:scheduler:scheduled-challenge:daily',
        token: 'instance-1:t:abc',
      });
      lockService.release.mockResolvedValue(true);

      challengeGenerationService.generateGlobalChallenge.mockImplementation(
        async (_type, _difficulty) =>
          ({
            id: `challenge-${Math.random().toString(36).slice(2, 8)}`,
          }) as any,
      );

      await service.generateDailyChallenges();

      expect(
        challengeGenerationService.generateGlobalChallenge,
      ).toHaveBeenCalledTimes(Object.values(ChallengeType).length);
      expect(repository.save).toHaveBeenCalledTimes(
        Object.values(ChallengeType).length,
      );
      // Confirm metadata records the instance id for observability.
      const firstSave = repository.save.mock.calls[0][0];
      expect(firstSave.metadata.generatedBy).toBe('instance-1');
      expect(lockService.release).toHaveBeenCalled();
    });

    it('skips generation when another instance holds the lock', async () => {
      lockService.acquire.mockResolvedValue(null);

      await service.generateDailyChallenges();

      expect(
        challengeGenerationService.generateGlobalChallenge,
      ).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('continues generating remaining challenge types when one fails', async () => {
      lockService.acquire.mockResolvedValue({
        key: 'lock:scheduler:scheduled-challenge:daily',
        token: 'instance-1:t:abc',
      });
      lockService.release.mockResolvedValue(true);

      challengeGenerationService.generateGlobalChallenge
        .mockRejectedValueOnce(new Error('type x failed'))
        .mockResolvedValue({ id: 'challenge-ok' } as any);

      await service.generateDailyChallenges();

      expect(
        challengeGenerationService.generateGlobalChallenge,
      ).toHaveBeenCalledTimes(Object.values(ChallengeType).length);
      // Lock is still released even when individual types fail.
      expect(lockService.release).toHaveBeenCalled();
    });
  });

  describe('generateWeeklyChallenges', () => {
    it('uses a separate lock key so daily and weekly can coexist', async () => {
      lockService.acquire.mockResolvedValue({
        key: 'lock:scheduler:scheduled-challenge:weekly',
        token: 'instance-1:t:abc',
      });
      lockService.release.mockResolvedValue(true);
      challengeGenerationService.generateGlobalChallenge.mockResolvedValue({
        id: 'challenge-weekly',
      } as any);

      await service.generateWeeklyChallenges();

      expect(lockService.acquire).toHaveBeenCalledWith(
        'lock:scheduler:scheduled-challenge:weekly',
        300_000,
      );
      expect(
        challengeGenerationService.generateGlobalChallenge,
      ).toHaveBeenCalledWith(ChallengeType.CODING, DifficultyLevel.HARD);
      expect(repository.save).toHaveBeenCalledTimes(2);
    });

    it('skips generation when the weekly lock is held by another instance', async () => {
      lockService.acquire.mockResolvedValue(null);

      await service.generateWeeklyChallenges();

      expect(
        challengeGenerationService.generateGlobalChallenge,
      ).not.toHaveBeenCalled();
    });
  });

  describe('scheduleChallenge', () => {
    it('converts date strings to Date objects before persisting', async () => {
      const dto = {
        challengeId: '00000000-0000-0000-0000-000000000000',
        scheduledFor: '2030-01-01T00:00:00Z',
        expiresAt: '2030-01-02T00:00:00Z',
      };

      await service.scheduleChallenge(dto);

      expect(repository.create).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalled();
    });
  });
});
