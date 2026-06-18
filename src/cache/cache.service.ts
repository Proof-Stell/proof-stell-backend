import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private hits = 0;
  private misses = 0;

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.cacheManager.get<T>(key);
    if (value) {
      this.hits++;
      this.logger.debug(`Cache hit for key: ${key}`);
    } else {
      this.misses++;
      this.logger.debug(`Cache miss for key: ${key}`);
    }
    return value;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    await this.cacheManager.set(key, value, ttl);
    this.logger.debug(`Cache set for key: ${key}, ttl: ${ttl}`);
  }

  async increment(key: string, ttl?: number): Promise<number> {
    const redisClient = this.getRedisClient();
    if (redisClient?.incr) {
      const value = await redisClient.incr(key);
      if (value === 1 && ttl && redisClient.expire) {
        await redisClient.expire(key, ttl);
      }
      this.logger.debug(`Cache increment for key: ${key}, value: ${value}`);
      return value;
    }

    const current = (await this.get<number>(key)) || 0;
    const value = current + 1;
    await this.set(key, value, ttl);
    return value;
  }

  async reset(): Promise<void> {
    /* Cache reset not available in cache-manager v6+ */
    this.logger.debug(`Cache reset called (no-op in cache-manager v6+)`);
  }

  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
    const redisClient = this.getRedisClient();
    if (redisClient?.del) {
      await redisClient.del(key);
    }
    this.logger.debug(`Cache entry deleted for key: ${key}`);
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalRequests: total,
    };
  }

  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }

  private getRedisClient(): any {
    const cacheManager = this.cacheManager as any;
    const store = cacheManager.store || cacheManager.stores?.[0];
    return store?.getClient?.() || store?.client || store?.redis || undefined;
  }
}
