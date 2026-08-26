import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TypedConfigService } from '../../common/config/typed-config.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class JwtSecurityService {
  private readonly JWT_BLACKLIST_PREFIX = 'jwt_blacklist:';
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: TypedConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * Generate JWT token with expiration
   */
  async generateAccessToken(payload: any): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.configService.jwtSecret,
      issuer: this.configService.jwtIssuer,
      audience: this.configService.jwtAudience,
      expiresIn: this.configService.jwtAccessTtl,
    });
  }

  /**
   * Generate refresh token
   */
  async generateRefreshToken(payload: any): Promise<string> {
    return this.jwtService.signAsync(
      { ...payload, type: 'refresh' },
      {
        expiresIn: this.configService.jwtRefreshTtl,
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
      },
    );
  }

  /**
   * Verify token and check blacklist
   */
  async verifyToken(token: string): Promise<any> {
    // Check if token is blacklisted
    const isBlacklisted = await this.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new Error('Token has been revoked');
    }

    try {
      return await this.jwtService.verifyAsync(token, {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
      });
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Blacklist a token (token revocation)
   */
  async revokeToken(token: string): Promise<void> {
    try {
      const decoded = this.jwtService.decode(token);
      if (decoded && decoded.exp) {
        // Calculate TTL based on token expiry (convert milliseconds to seconds)
        const ttlMs = decoded.exp * 1000 - Date.now();
        if (ttlMs > 0) {
          const ttlSeconds = Math.ceil(ttlMs / 1000);
          await this.cacheManager.set(
            `${this.JWT_BLACKLIST_PREFIX}${token}`,
            'blacklisted',
            ttlSeconds, // Use seconds for consistency with cache service
          );
        }
      }
    } catch (error) {
      // Token might be malformed, blacklist it anyway for safety
      await this.cacheManager.set(
        `${this.JWT_BLACKLIST_PREFIX}${token}`,
        'blacklisted',
        3600, // 1 hour default TTL in seconds
      );
    }
  }

  /**
   * Check if token is blacklisted
   */
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    const blacklisted = await this.cacheManager.get(
      `${this.JWT_BLACKLIST_PREFIX}${token}`,
    );
    return !!blacklisted;
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.jwtSecret,
        issuer: this.configService.jwtIssuer,
        audience: this.configService.jwtAudience,
      });

      if (payload.type !== 'refresh') {
        throw new Error('Invalid refresh token');
      }

      // Generate new access token
      const { type, ...accessPayload } = payload;
      return await this.generateAccessToken(accessPayload);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }
}
