import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LeaderboardService } from './Leaderboard.service';
import { Leaderboard } from './entities/leaderboard.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { TypedConfigService } from '../common/config/typed-config.service';
import { NotificationService } from '../notification/notification.service';

const mockRepository = {
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  clear: jest.fn(),
};

const mockConfigService = {
  leaderboardRecalculationStrategy: 'batch',
};

const mockNotificationService = {
  create: jest.fn(),
};

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let gateway: RealtimeGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: getRepositoryToken(Leaderboard),
          useValue: mockRepository,
        },
        {
          provide: TypedConfigService,
          useValue: mockConfigService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: RealtimeGateway,
          useValue: {
            emitLeaderboardUpdate: jest.fn(),
            emitUserRankChange: jest.fn(),
            emitLeaderboardStats: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitScore', () => {
    it('should create new leaderboard entry for new user', async () => {
      const userId = 'test-user-id';
      const createDto = { score: 100 };
      const mockEntry = { id: 1, userId, score: 100, rank: 1 };

      mockRepository.findOne.mockResolvedValueOnce(null);
      mockRepository.create.mockReturnValue(mockEntry);
      mockRepository.save.mockResolvedValue(mockEntry);
      mockRepository.find.mockResolvedValue([mockEntry]);
      mockRepository.findOne.mockResolvedValueOnce(mockEntry);
      mockRepository.findAndCount.mockResolvedValue([[mockEntry], 1]);
      mockConfigService.leaderboardRecalculationStrategy = 'batch';

      const result = await service.submitScore(userId, createDto);
      expect(result).toEqual(mockEntry);
    });

    it('should throw BadRequestException for lower score', async () => {
      const userId = 'test-user-id';
      const createDto = { score: 50 };
      const existingEntry = { id: 1, userId, score: 100, rank: 1 };

      mockRepository.findOne.mockResolvedValue(existingEntry);

      await expect(service.submitScore(userId, createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getUserLeaderboard', () => {
    it('should throw NotFoundException for non-existent user', async () => {
      const userId = 'non-existent-user';
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserLeaderboard(userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('should reset leaderboard', async () => {
    mockRepository.findAndCount.mockResolvedValue([[], 0]);
    await service.resetLeaderboard();
    expect(mockRepository.clear).toHaveBeenCalled();
    expect(gateway.emitLeaderboardUpdate).toHaveBeenCalled();
  });
});
