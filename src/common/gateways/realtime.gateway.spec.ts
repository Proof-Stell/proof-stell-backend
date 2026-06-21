import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from './realtime.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { JwtService } from '@nestjs/jwt';
import { LoggingService } from '../../logging/logging.service';
import { AuthTokenService } from '../../auth/providers/auth-token.service';

// Mock Socket.IO Server and Socket
class MockSocket {
  id = 'socket1';
  rooms = new Set();
  disconnected = false;
  join(room: string) {
    this.rooms.add(room);
  }
  disconnect(force?: boolean) {
    this.disconnected = true;
  }
}

class MockServer {
  to(room: string) {
    return this;
  }
  emit(event: string, payload: any) {
    return { event, payload };
  }
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let client: any;

  beforeEach(async () => {
    const mockLoggingService = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      logUserAction: jest.fn(),
      logSecurityEvent: jest.fn(),
      logDatabaseOperation: jest.fn(),
      logBusinessEvent: jest.fn(),
      logPerformanceMetric: jest.fn(),
    };

    const mockAuthTokenService = {
      verifyAccessToken: jest
        .fn()
        .mockResolvedValue({ sub: 'user1', role: 'admin' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        WsJwtGuard,
        JwtService,
        { provide: LoggingService, useValue: mockLoggingService },
        { provide: AuthTokenService, useValue: mockAuthTokenService },
      ],
    }).compile();
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    gateway.server = new MockServer() as any;
    client = new MockSocket();
    client.user = { sub: 'user1', role: 'admin' };
  });

  it('should handle connection and join user room', async () => {
    await gateway.handleConnection(client);
    expect(client.rooms.has('user:user1')).toBe(true);
    expect(gateway['connectedUsers'].get(client.id)).toBe('user1');
  });

  it('should handle disconnect and cleanup', async () => {
    gateway['connectedUsers'].set(client.id, 'user1');
    await gateway.handleDisconnect(client);
    expect(gateway['connectedUsers'].has(client.id)).toBe(false);
  });

  it('should reject connection without user', async () => {
    const badClient = new MockSocket();
    await gateway.handleConnection(badClient as any);
    expect(badClient.disconnected).toBe(true);
  });

  it('should subscribe to leaderboard with valid id', async () => {
    const res = await gateway.handleLeaderboardSubscribe(client, {
      leaderboardId: 'abc',
    });
    expect(res).toEqual({ event: 'subscribed', leaderboardId: 'abc' });
    expect(client.rooms.has('leaderboard:abc')).toBe(true);
  });

  it('should return error for invalid leaderboard id', async () => {
    const res = await gateway.handleLeaderboardSubscribe(client, {
      leaderboardId: '',
    });
    expect(res.error).toBe('Invalid leaderboardId');
  });

  it('should subscribe to game with valid id', async () => {
    const res = await gateway.handleGameSubscribe(client, { gameId: 'game1' });
    expect(res).toEqual({ event: 'subscribed', gameId: 'game1' });
    expect(client.rooms.has('game:game1')).toBe(true);
  });

  it('should return error for invalid game id', async () => {
    const res = await gateway.handleGameSubscribe(client, { gameId: '' });
    expect(res.error).toBe('Invalid gameId');
  });

  it('should emit notification for admin', async () => {
    const payload = {
      userId: 'user2',
      message: 'msg',
      type: 'info',
      title: 'Test',
      icon: '🔔',
    };
    const res = await gateway.handleSendNotification(client, payload);
    expect(res.status).toBe('sent');
  });

  it('should reject notification for non-admin', async () => {
    client.user.role = 'user';
    const payload = {
      userId: 'user2',
      message: 'msg',
      type: 'info',
      title: 'Test',
      icon: '🔔',
    };
    const res = await gateway.handleSendNotification(client, payload);
    expect(res.error).toBe('Unauthorized');
  });

  it('should return validation error for invalid notification', async () => {
    const payload = { userId: '', message: '', type: 'info' };
    const res = await gateway.handleSendNotification(client, payload);
    expect(res.error).toBe('Validation failed');
  });
});
