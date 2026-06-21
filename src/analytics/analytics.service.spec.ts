/* eslint-disable prettier/prettier */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEventEntity } from './entities/analytics-event.entity';
import { AnalyticsEvent } from './analytics-event.enum';

const mockRepo = {
  create: jest.fn((dto) => dto),
  save: jest.fn(async (entity) => ({ id: '1', ...entity })),
  createQueryBuilder: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
    delete: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    groupBy: jest.fn().mockReturnThis(),
  })),
};

const mockCache = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(AnalyticsEventEntity), useValue: mockRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sanitizeMetadata', () => {
    it('strips PII fields from metadata', () => {
      const raw = {
        email: 'user@example.com',
        password: 'secret',
        ip: '1.2.3.4',
        score: 42,
        level: 'beginner',
      };
      const clean = service.sanitizeMetadata(raw);
      expect(clean).not.toHaveProperty('email');
      expect(clean).not.toHaveProperty('password');
      expect(clean).not.toHaveProperty('ip');
      expect(clean).toEqual({ score: 42, level: 'beginner' });
    });

    it('returns empty object when metadata is undefined', () => {
      expect(service.sanitizeMetadata(undefined)).toEqual({});
    });
  });

  describe('track', () => {
    it('persists event and sanitizes metadata before saving', async () => {
      const result = await service.track(AnalyticsEvent.UserLoggedIn, {
        userId: 'u1',
        metadata: { email: 'x@y.com', score: 99 },
      });
      expect(mockRepo.save).toHaveBeenCalledTimes(1);
      const saved = mockRepo.save.mock.calls[0][0];
      expect(saved.metadata).not.toHaveProperty('email');
      expect(saved.metadata).toHaveProperty('score', 99);
      expect(result).toHaveProperty('id');
    });
  });

  describe('logEvent', () => {
    it('creates and saves an analytics entry', async () => {
      await service.logEvent({ event: AnalyticsEvent.SESSION_STARTED } as any);
      expect(mockRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('provider failure isolation', () => {
    it('track does not throw when repo.save fails', async () => {
      mockRepo.save.mockRejectedValueOnce(new Error('DB error'));
      await expect(
        service.track(AnalyticsEvent.UserRegistered, { userId: 'u2' }),
      ).rejects.toThrow('DB error');
    });
  });
});
