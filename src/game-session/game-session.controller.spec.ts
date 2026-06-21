import { Test, TestingModule } from '@nestjs/testing';
import { GameSessionController } from './game-session.controller';
import { GameSessionService } from './game-session.service';
import { SessionIntegrityGuard } from '../common/guards/session-integrity.guard';

describe('GameSessionController', () => {
  let controller: GameSessionController;
  let service: GameSessionService;

  const mockGameSessionService = {
    startSession: jest.fn(),
    reportSession: jest.fn(),
    findSessionsByUser: jest.fn(),
    findSessionById: jest.fn(),
    getSessionAnalytics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameSessionController],
      providers: [
        {
          provide: GameSessionService,
          useValue: mockGameSessionService,
        },
      ],
    })
      .overrideGuard(SessionIntegrityGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<GameSessionController>(GameSessionController);
    service = module.get<GameSessionService>(GameSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call startSession', async () => {
    const req = { user: { id: 'user-1', role: 'player' } } as any;
    const dto = { challengeId: 'challenge-1' };
    mockGameSessionService.startSession.mockResolvedValue({
      sessionId: 'session-1',
      nonce: 'abc',
    });

    const result = await controller.startSession(req, dto);

    expect(service.startSession).toHaveBeenCalledWith('user-1', dto);
    expect(result).toEqual({ sessionId: 'session-1', nonce: 'abc' });
  });

  it('should call getUserSessions with caller identity', async () => {
    const req = { user: { id: 'user-1', role: 'player' } } as any;
    mockGameSessionService.findSessionsByUser.mockResolvedValue({
      sessions: [],
      total: 0,
    });

    await controller.getUserSessions(req, 'user-2', 10, 0);

    expect(service.findSessionsByUser).toHaveBeenCalledWith(
      'user-2',
      req.user,
      10,
      0,
    );
  });
});
