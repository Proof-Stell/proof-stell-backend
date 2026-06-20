import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DailyChallengeService } from './daily-challenge.service';
import { DailyChallenge } from '../entities/daily-challenge.entity';
import { ChallengeParticipation } from '../entities/challenge-participation.entity';
import { DistributedLockService } from '../../cache/distributed-lock.service';
import { TypedConfigService } from '../../common/config/typed-config.service';

describe('DailyChallengeService', () => {
  let service: DailyChallengeService;
  let dailyRepository: any;
  let participationRepository: any;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let lockService: jest.Mocked<DistributedLockService>;
  const fakeLockHandle = {
    key: 'lock:scheduler:daily-challenge:reset',
    token: 'instance-1:t:abc',
  };

  beforeEach(async () => {
    dailyRepository = {
      findOne: jest.fn(),
      create: jest.fn((entity) => entity),
      save: jest.fn().mockImplementation(async (entity) => ({
        id: 'challenge-id',
        ...entity,
      })),
    };

    participationRepository = {
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };

    eventEmitter = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventEmitter2>;

    lockService = {
      acquire: jest.fn(),
      release: jest.fn(),
    } as unknown as jest.Mocked<DistributedLockService>;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DailyChallengeService,
        {
          provide: getRepositoryToken(DailyChallenge),
          useValue: dailyRepository,
        },
        {
          provide: getRepositoryToken(ChallengeParticipation),
          useValue: participationRepository,
        },
        {
          provide: EventEmitter2,
          useValue: eventEmitter,
        },
        {
          provide: DistributedLockService,
          useValue: lockService,
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

    service = moduleRef.get(DailyChallengeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleDailyChallengeReset', () => {
    it('runs the reset routine end-to-end when the lock is acquired', async () => {
      // No current challenge -> archive is a no-op, then create a new challenge.
      dailyRepository.findOne.mockResolvedValue(null);
      lockService.acquire.mockResolvedValue(fakeLockHandle);
      lockService.release.mockResolvedValue(true);

      await service.handleDailyChallengeReset();

      expect(lockService.acquire).toHaveBeenCalledWith(
        'lock:scheduler:daily-challenge:reset',
        300_000,
      );
      expect(dailyRepository.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'daily-challenge.created',
        expect.objectContaining({ challengeId: 'challenge-id' }),
      );
      expect(lockService.release).toHaveBeenCalledWith(fakeLockHandle);
    });

    it('skips the reset entirely when another instance holds the lock', async () => {
      lockService.acquire.mockResolvedValue(null);
      lockService.release.mockResolvedValue(true);

      await service.handleDailyChallengeReset();

      expect(dailyRepository.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(lockService.release).not.toHaveBeenCalled();
    });

    it('releases the lock when the routine throws mid-way', async () => {
      lockService.acquire.mockResolvedValue(fakeLockHandle);
      lockService.release.mockResolvedValue(true);
      dailyRepository.findOne.mockRejectedValue(new Error('db down'));

      await expect(service.handleDailyChallengeReset()).rejects.toThrow(
        'db down',
      );
      expect(lockService.release).toHaveBeenCalledWith(fakeLockHandle);
    });

    it('archives the previously active challenge before creating a new one', async () => {
      const existing = {
        id: 'old-challenge',
        isActive: true,
        startAt: new Date(),
        endAt: new Date(),
      };
      // First findOne is for the active challenge (archive step)
      // Second findOne is inside archiveCurrentChallenge's getCurrentChallenge.
      dailyRepository.findOne.mockResolvedValueOnce(existing);
      lockService.acquire.mockResolvedValue(fakeLockHandle);
      lockService.release.mockResolvedValue(true);

      await service.handleDailyChallengeReset();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'daily-challenge.archived',
        expect.objectContaining({ challengeId: 'old-challenge' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'daily-challenge.created',
        expect.any(Object),
      );
    });
  });

  describe('manuallyTriggerReset', () => {
    it('does not acquire the scheduler lock — operators can recover mid-cycle', async () => {
      dailyRepository.findOne.mockResolvedValue(null);

      const challenge = await service.manuallyTriggerReset();

      expect(lockService.acquire).not.toHaveBeenCalled();
      expect(lockService.release).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'daily-challenge.manual-reset',
        expect.objectContaining({ challengeId: 'challenge-id' }),
      );
      expect(challenge).toBeDefined();
    });
  });
});
