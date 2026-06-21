import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { LoggingService } from '../../logging/logging.service';
import { NotificationDto } from './dto/notification.dto';
import { validateOrReject, ValidationError } from 'class-validator';

/** Derive WebSocket CORS origins from the same env var as HTTP CORS. */
const wsCorsOrigin = ((): string | string[] | boolean => {
  const corsEnabled = process.env.CORS_ENABLED !== 'false';
  if (!corsEnabled) {
    return false;
  }
  const raw = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
})();

@WebSocketGateway({
  namespace: '/realtime',
  cors:
    wsCorsOrigin === false
      ? false
      : {
          origin: wsCorsOrigin,
          credentials: true,
        },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly loggingService: LoggingService) {}

  // Track connected users for demonstration
  private connectedUsers: Map<string, string> = new Map();

  @UseGuards(WsJwtGuard)
  handleConnection(client: Socket) {
    try {
      const user = (client as any).user;
      if (!user || !user.sub) {
        this.loggingService.warn(
          'Connection attempt without valid user payload.',
          {
            module: 'realtime',
            action: 'connection',
            metadata: { socketId: client.id },
          },
        );
        client.disconnect(true);
        return;
      }
      client.join(`user:${user.sub}`);
      this.connectedUsers.set(client.id, user.sub);
      this.loggingService.info(`User ${user.sub} connected`, {
        userId: user.sub,
        module: 'realtime',
        action: 'connection',
        metadata: { socketId: client.id },
      });
    } catch (err) {
      this.loggingService.error(
        'Error in handleConnection',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'connection',
          metadata: { socketId: client.id },
        },
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    if (userId) {
      this.loggingService.info(`User ${userId} disconnected`, {
        userId,
        module: 'realtime',
        action: 'disconnection',
        metadata: { socketId: client.id },
      });
      this.connectedUsers.delete(client.id);
    } else {
      this.loggingService.info('Unknown user disconnected', {
        module: 'realtime',
        action: 'disconnection',
        metadata: { socketId: client.id },
      });
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leaderboard:subscribe')
  handleLeaderboardSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { leaderboardId: string },
  ) {
    try {
      if (
        !data ||
        typeof data.leaderboardId !== 'string' ||
        !data.leaderboardId.trim()
      ) {
        return { error: 'Invalid leaderboardId' };
      }
      client.join(`leaderboard:${data.leaderboardId}`);
      return { event: 'subscribed', leaderboardId: data.leaderboardId };
    } catch (err) {
      this.loggingService.error(
        'Error in leaderboard:subscribe',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'leaderboard:subscribe',
        },
      );
      return { error: 'Subscription failed' };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('game:subscribe')
  handleGameSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { gameId: string },
  ) {
    try {
      if (!data || typeof data.gameId !== 'string' || !data.gameId.trim()) {
        return { error: 'Invalid gameId' };
      }
      client.join(`game:${data.gameId}`);
      return { event: 'subscribed', gameId: data.gameId };
    } catch (err) {
      this.loggingService.error(
        'Error in game:subscribe',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'game:subscribe',
        },
      );
      return { error: 'Subscription failed' };
    }
  }

  emitLeaderboardUpdate(
    leaderboardId: string,
    scores: any[],
    updateType:
      | 'score_change'
      | 'rank_change'
      | 'new_entry'
      | 'reset' = 'score_change',
  ) {
    const updateData = {
      leaderboardId,
      scores,
      updateType,
      timestamp: new Date().toISOString(),
      totalEntries: scores.length,
    };

    this.server
      .to(`leaderboard:${leaderboardId}`)
      .emit('leaderboard:update', updateData);
    const clientCount =
      this.server.sockets.adapter.rooms.get(`leaderboard:${leaderboardId}`)
        ?.size || 0;
    this.loggingService.info(
      `Emitted leaderboard update for ${leaderboardId} (${updateType})`,
      {
        module: 'realtime',
        action: 'leaderboard:emit',
        metadata: { leaderboardId, updateType, clientCount },
      },
    );
  }

  emitUserRankChange(
    userId: string,
    oldRank: number,
    newRank: number,
    score: number,
  ) {
    this.server.to(`user:${userId}`).emit('leaderboard:rank-change', {
      userId,
      oldRank,
      newRank,
      score,
      timestamp: new Date().toISOString(),
    });
  }

  emitLeaderboardStats(leaderboardId: string, stats: any) {
    this.server.to(`leaderboard:${leaderboardId}`).emit('leaderboard:stats', {
      leaderboardId,
      stats,
      timestamp: new Date().toISOString(),
    });
  }

  emitGameStateChange(gameId: string, state: 'started' | 'paused' | 'ended') {
    this.server
      .to(`game:${gameId}`)
      .emit('game:state-change', { gameId, state });
  }

  emitNotification(
    userId: string,
    message: string,
    type: string,
    icon?: string,
  ) {
    this.server
      .to(`user:${userId}`)
      .emit('notification:alert', { message, type, icon });
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:send')
  async handleSendNotification(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: NotificationDto,
  ) {
    try {
      await validateOrReject(Object.assign(new NotificationDto(), payload));
      const user = (client as any).user;
      if (user.role !== 'admin') return { error: 'Unauthorized' };
      this.emitNotification(
        payload.userId,
        payload.message,
        payload.type,
        payload.icon,
      );
      return { status: 'sent' };
    } catch (err) {
      if (Array.isArray(err) && err[0] instanceof ValidationError) {
        return { error: 'Validation failed', details: err };
      }
      this.loggingService.error(
        'Error in notification:send',
        err instanceof Error ? err : new Error(String(err)),
        {
          module: 'realtime',
          action: 'notification:send',
        },
      );
      return { error: 'Notification failed' };
    }
  }
}
