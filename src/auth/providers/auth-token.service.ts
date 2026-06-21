import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { CacheService } from 'src/cache/cache.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: string;
  jti?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

@Injectable()
export class AuthTokenService {
  private readonly revokedTokenPrefix = 'auth:jwt:revoked:';

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: TypedConfigService,
    private readonly cacheService: CacheService,
  ) {}

  signAccessToken(user: { id: string; email: string; role: string }): string {
    return this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        jti: randomUUID(),
      },
      {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
        expiresIn: this.configService.jwtAccessTtl,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenClaims>(
        token,
        {
          secret: this.configService.jwtSecret,
          issuer: this.configService.jwtIssuer,
          audience: this.configService.jwtAudience,
        },
      );

      await this.assertTokenIsActive(payload, token);
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async assertTokenIsActive(
    payload: AccessTokenClaims,
    token?: string,
  ): Promise<void> {
    const revoked = await this.cacheService.get<boolean>(
      this.buildRevokedTokenKey(payload, token),
    );

    if (revoked) {
      throw new UnauthorizedException('Token has been revoked');
    }
  }

  async revokeAccessToken(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token);
    const ttl = this.getRemainingTtlSeconds(decoded);

    if (ttl <= 0) {
      return;
    }

    await this.cacheService.set(
      this.buildRevokedTokenKey(decoded || undefined, token),
      true,
      ttl,
    );
  }

  private buildRevokedTokenKey(
    payload?: Pick<AccessTokenClaims, 'jti'> | null,
    token?: string,
  ): string {
    const tokenId =
      payload?.jti ||
      createHash('sha256')
        .update(token || '')
        .digest('hex');

    return `${this.revokedTokenPrefix}${tokenId}`;
  }

  private getRemainingTtlSeconds(payload: AccessTokenClaims | null): number {
    if (!payload?.exp) {
      return this.durationToSeconds(this.configService.jwtAccessTtl);
    }

    return Math.max(payload.exp - Math.floor(Date.now() / 1000), 0);
  }

  private durationToSeconds(duration: string): number {
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
      return 0;
    }

    const value = Number(match[1]);
    const multipliers: Record<string, number> = {
      ms: 1 / 1000,
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };

    return Math.ceil(value * multipliers[match[2]]);
  }
}
