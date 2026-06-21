import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './Leaderboard.service';

const mockLeaderboardService = {
  getGlobalLeaderboard: jest.fn(),
  getUserLeaderboard: jest.fn(),
  submitScore: jest.fn(),
  resetLeaderboard: jest.fn(),
};

describe('LeaderboardController', () => {
  let controller: LeaderboardController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaderboardController],
      providers: [
        {
          provide: LeaderboardService,
          useValue: mockLeaderboardService,
        },
      ],
    }).compile();

    controller = module.get<LeaderboardController>(LeaderboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getGlobalLeaderboard', () => {
    it('should return global leaderboard', async () => {
      const mockResult = {
        leaderboard: [],
        total: 0,
        page: 1,
        limit: 50,
      };
      mockLeaderboardService.getGlobalLeaderboard.mockResolvedValue(mockResult);

      const result = await controller.getGlobalLeaderboard(1, 50);
      expect(result).toBeDefined();
      expect(mockLeaderboardService.getGlobalLeaderboard).toHaveBeenCalledWith(
        1,
        50,
      );
    });
  });
});
