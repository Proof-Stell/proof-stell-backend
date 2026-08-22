import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DistributedLockService } from './distributed-lock.service';
import { AcquiredLock } from './distributed-lock.service';

/**
 * Cache backend type for tracking and debugging
 */
export enum CacheBackend {
  REDIS = 'redis',
  MEMORY = 'memory',
  UNKNOWN = 'unknown'
}

/**
 * Detailed cache statistics including backend-specific metrics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  backend: CacheBackend;
  redisHits: number;
  redisMisses: number;
  memoryHits: number;
  memoryMisses: number;
  lockFailures: number;
  keyCollisions: number;
}

/**
 * Service for managing cache operations with Redis backend.
 * 
 * This service provides a unified interface for caching operations including
 * get, set, increment, delete, and health checks. It tracks cache statistics
 * (hits/misses) and supports both memory and Redis-based caching with consistent
 * semantics across backends.
 * 
 * ## Cache Key Convention
 * Follow the pattern: `<module>:<entity>:<id>`
 * Examples:
 * - `user:profile:123`
 * - `leaderboard:ranking:daily`
 * - `game:session:abc-123`
 * 
 * ## TTL Handling
 * All TTL values are normalized to seconds and validated before use:
 * - Minimum: 1 second (values < 1 are treated as no TTL)
 * - Maximum: 365 days (values > 31536000 are clamped)
 * - Negative values are rejected
 * 
 * @example
 * ```typescript
 * const cacheService = new CacheService(cacheManager);
 * await cacheService.set('user:profile:123', userData, 3600);
 * const data = await cacheService.get('user:profile:123');
 * ```
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private hits = 0;
  private misses = 0;
  private redisHits = 0;
  private redisMisses = 0;
  private memoryHits = 0;
  private memoryMisses = 0;
  private lockFailures = 0;
  private keyCollisions = 0;
  private backend: CacheBackend = CacheBackend.UNKNOWN;

  /**
   * Creates a new CacheService instance.
   * 
   * @param cacheManager - The cache-manager instance (configured for Redis or memory)
   */
  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly distributedLockService: DistributedLockService,
  ) {
    this.detectBackend();
  }

  /**
   * Retrieves a value from the cache.
   * 
   * This method fetches a value by key and tracks cache hit/miss statistics
   * with backend-specific tracking.
   * 
   * @param key - The cache key to retrieve
   * @returns Promise containing the cached value or undefined if not found
   * 
   * @example
   * ```typescript
   * const userData = await cacheService.get<User>('user:profile:123');
   * if (userData) {
   *   console.log('Cache hit:', userData);
   * }
   * ```
   */
  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.cacheManager.get<T>(key);
    if (value) {
      this.hits++;
      this.trackBackendHit(true);
      this.logger.debug(`Cache hit for key: ${key} (backend: ${this.backend})`);
    } else {
      this.misses++;
      this.trackBackendHit(false);
      this.logger.debug(`Cache miss for key: ${key} (backend: ${this.backend})`);
    }
    return value;
  }

  /**
   * Sets a value in the cache with an optional TTL.
   * 
   * This method stores a value in the cache with an optional time-to-live
   * in seconds. If no TTL is provided, the value persists based on the
   * cache manager's default configuration. TTL values are normalized and
   * validated before storage.
   * 
   * @param key - The cache key to set
   * @param value - The value to cache
   * @param ttl - Time-to-live in seconds (optional)
   * 
   * @example
   * ```typescript
   * // Cache for 1 hour
   * await cacheService.set('user:profile:123', userData, 3600);
   * 
   * // Cache with default TTL
   * await cacheService.set('leaderboard:ranking:daily', rankings);
   * ```
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const normalizedTtl = this.normalizeTtl(ttl);
    await this.cacheManager.set(key, value, normalizedTtl);
    this.logger.debug(`Cache set for key: ${key}, ttl: ${normalizedTtl || 'default'} (backend: ${this.backend})`);
  }

  /**
   * Increments a counter value in the cache.
   * 
   * This method atomically increments a counter value. If the key doesn't exist,
   * it initializes to 1. Supports Redis INCR operation for better performance
 * when Redis is available.
   * 
   * @param key - The cache key for the counter
   * @param ttl - Time-to-live in seconds (optional, only applied on first increment)
   * @returns Promise containing the new counter value
   * 
   * @example
   * ```typescript
   * // Increment request counter with 5-minute TTL
   * const count = await cacheService.increment('api:requests:123', 300);
 * console.log('Request count:', count);
   * ```
   */
  async increment(key: string, ttl?: number): Promise<number> {
    const normalizedTtl = this.normalizeTtl(ttl);
    const redisClient = this.getRedisClient();
    
    if (redisClient?.incr) {
      try {
        const value = await redisClient.incr(key);
        if (value === 1 && normalizedTtl && redisClient.expire) {
          await redisClient.expire(key, normalizedTtl);
        }
        this.logger.debug(`Cache increment (Redis) for key: ${key}, value: ${value}`);
        return value;
      } catch (error) {
        this.logger.warn(`Redis increment failed for key ${key}, falling back to in-memory: ${(error as Error).message}`);
        // Fall through to in-memory implementation
      }
    }

    // In-memory fallback with consistent semantics
    const current = (await this.get<number>(key)) || 0;
    const value = current + 1;
    await this.set(key, value, normalizedTtl);
    this.logger.debug(`Cache increment (memory) for key: ${key}, value: ${value}`);
    return value;
  }

  /**
   * Resets the cache (no-op in cache-manager v6+).
   * 
   * This method is kept for compatibility but does not perform any operation
   * as cache-manager v6+ removed the reset functionality.
   * 
   * @deprecated Use specific key deletion instead
   */
  async reset(): Promise<void> {
    /* Cache reset not available in cache-manager v6+ */
    this.logger.debug(`Cache reset called (no-op in cache-manager v6+)`);
  }

  /**
   * Pings the Redis server to check connectivity.
   * 
   * This method verifies that the Redis backend is responsive by sending
   * a PING command and expecting a PONG response.
   * 
   * @returns Promise that resolves if Redis is responsive
   * @throws {Error} If Redis client is unavailable or ping fails
   * 
   * @example
   * ```typescript
   * try {
   *   await cacheService.ping();
   *   console.log('Redis is healthy');
   * } catch (error) {
   *   console.error('Redis is down:', error.message);
   * }
   * ```
   */
  async ping(): Promise<void> {
    const redisClient = this.getRedisClient();

    if (!redisClient?.ping) {
      throw new Error('Redis client is unavailable');
    }

    try {
      const response = await redisClient.ping();
      if (typeof response === 'string' && response.toUpperCase() === 'PONG') {
        return;
      }
      throw new Error('Redis ping returned an unexpected response');
    } catch {
      throw new Error('Redis ping failed');
    }
  }

  /**
   * Deletes a specific key from the cache.
   * 
   * This method removes a key from both the cache-manager and the Redis
   * backend if available.
   * 
   * @param key - The cache key to delete
   * 
   * @example
   * ```typescript
   * await cacheService.del('user:profile:123');
   * ```
   */
  async del(key: string): Promise<void> {
    await this.cacheManager.del(key);
    const redisClient = this.getRedisClient();
    if (redisClient?.del) {
      await redisClient.del(key);
    }
    this.logger.debug(`Cache entry deleted for key: ${key}`);
  }

  /**
   * Attempts to acquire a distributed lock for the given key.
   * 
   * This method wraps the Redis-based distributed lock with retry logic
   * to handle concurrent acquisition attempts. If the lock cannot be
   * acquired after the specified number of retries, null is returned.
   * 
   * @param key - The lock key to acquire
   * @param ttl - Time-to-live in milliseconds (default: 30000)
   * @param retries - Number of retry attempts (default: 3)
   * @returns Promise containing the acquired lock handle or null
   * 
   * @example
   * ```typescript
   * const lock = await cacheService.acquireLock('leaderboard:recalculate', 30000, 3);
   * if (!lock) {
   *   console.log('Could not acquire lock');
   *   return;
   * }
   * try {
   *   // Critical section
   * } finally {
   *   await cacheService.releaseLock(lock);
   * }
   * ```
   */
  async acquireLock(key: string, ttl: number = 30000, retries = 3): Promise<AcquiredLock | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const lock = await this.distributedLockService.acquire(key, ttl);
      if (lock) {
        return lock;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    this.lockFailures++;
    this.logger.warn(`Failed to acquire lock '${key}' after ${retries + 1} attempts (backend: ${this.backend})`);
    return null;
  }

  /**
   * Releases a previously acquired distributed lock.
   * 
   * This method safely releases a lock using an atomic Lua script to
   * prevent releasing a lock that has been re-acquired by another instance.
   * 
   * @param lock - The lock handle returned from acquireLock
   * @returns Promise containing true if the lock was released, false otherwise
   * 
   * @example
   * ```typescript
   * const released = await cacheService.releaseLock(lock);
   * ```
   */
  async releaseLock(lock: AcquiredLock | null | undefined): Promise<boolean> {
    if (!lock) {
      return false;
    }
    return this.distributedLockService.release(lock);
  }

  /**
   * Executes a callback while holding a distributed lock.
   * 
   * This helper acquires a lock, runs the provided callback, and releases
   * the lock in a finally block. Returns null if the lock cannot be acquired.
   * 
   * @param key - The lock key to acquire
   * @param ttl - Time-to-live in milliseconds
   * @param callback - The async callback to execute while holding the lock
   * @returns Promise containing the callback result or null if lock not acquired
   * 
   * @example
   * ```typescript
   * const result = await cacheService.withLock('leaderboard:recalculate', 30000, async () => {
   *   await recalculateRanks();
   *   return 'done';
   * });
   * if (!result) {
   *   console.log('Recalculation skipped: lock not acquired');
   * }
   * ```
   */
  async withLock<T>(key: string, ttl: number, callback: () => Promise<T>): Promise<T | null> {
    const lock = await this.acquireLock(key, ttl);
    if (!lock) {
      this.logger.debug(`Skipping work for lock '${key}'; not acquired.`);
      return null;
    }
    try {
      return await callback();
    } finally {
      await this.releaseLock(lock);
    }
  }

  async setIfNotExists<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    const normalizedTtl = this.normalizeTtl(ttl);
    const client = this.getRedisClient();
    
    if (client?.set) {
      try {
        const serialized = JSON.stringify(value);
        const options: any = { nx: true };
        if (normalizedTtl) {
          options.ex = normalizedTtl;
        }
        const result = await client.set(key, serialized, options);
        const success = result === 'OK';
        if (!success) {
          this.keyCollisions++;
          this.logger.debug(`Key collision for setIfNotExists: ${key}`);
        }
        return success;
      } catch (error) {
        this.logger.warn(`Redis setIfNotExists failed for key ${key}, falling back to in-memory: ${(error as Error).message}`);
        // Fall through to in-memory implementation
      }
    }

    // In-memory fallback with consistent semantics
    const existing = await this.get<T>(key);
    if (existing !== undefined) {
      this.keyCollisions++;
      this.logger.debug(`Key collision for setIfNotExists (memory): ${key}`);
      return false;
    }
    await this.set(key, value, normalizedTtl);
    return true;
  }

  async waitForValue<T>(
    key: string,
    timeoutMs: number,
    intervalMs = 100,
    predicate?: (value: T | undefined) => boolean,
  ): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;
    
    while (Date.now() < deadline) {
      attempts++;
      const value = await this.get<T>(key);
      if (value !== undefined && (!predicate || predicate(value))) {
        this.logger.debug(`waitForValue succeeded for key: ${key} after ${attempts} attempts`);
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    
    this.logger.debug(`waitForValue timed out for key: ${key} after ${attempts} attempts`);
    return undefined;
  }

  /**
   * Gets cache statistics including hits, misses, and hit rate.
   * 
   * This method returns performance metrics for the cache service,
   * useful for monitoring and optimization. Includes backend-specific
   * metrics to distinguish Redis vs in-memory performance.
   * 
   * @returns Object containing detailed cache statistics
   * 
   * @example
   * ```typescript
   * const stats = cacheService.getStats();
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
   * console.log(`Backend: ${stats.backend}`);
   * ```
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      totalRequests: total,
      backend: this.backend,
      redisHits: this.redisHits,
      redisMisses: this.redisMisses,
      memoryHits: this.memoryHits,
      memoryMisses: this.memoryMisses,
      lockFailures: this.lockFailures,
      keyCollisions: this.keyCollisions,
    };
  }

  /**
   * Resets cache statistics counters.
   * 
   * This method zeroes out all statistics counters, useful for
   * periodic monitoring or testing.
   * 
   * @example
   * ```typescript
   * cacheService.resetStats();
   * ```
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
    this.redisHits = 0;
    this.redisMisses = 0;
    this.memoryHits = 0;
    this.memoryMisses = 0;
    this.lockFailures = 0;
    this.keyCollisions = 0;
  }

  /**
   * Gets the underlying Redis client instance.
   * 
   * This private method attempts to extract the Redis client from the
   * cache-manager store configuration. It handles multiple store implementations.
   * 
   * @returns The Redis client instance or undefined if not available
   * @private
   */
  private getRedisClient(): any {
    const cacheManager = this.cacheManager as any;
    const store = cacheManager.store || cacheManager.stores?.[0];
    return store?.getClient?.() || store?.client || store?.redis || undefined;
  }

  /**
   * Normalizes and validates TTL values.
   * 
   * Ensures TTL values are within acceptable ranges:
   * - Converts to seconds if needed
   * - Rejects negative values
   * - Clamps to maximum (365 days)
   * - Treats values < 1 as "no TTL"
   * 
   * @param ttl - The TTL value in seconds (optional)
   * @returns Normalized TTL in seconds, or undefined for no TTL
   * @private
   */
  private normalizeTtl(ttl?: number): number | undefined {
    if (ttl === undefined || ttl === null) {
      return undefined;
    }

    if (ttl < 0) {
      this.logger.warn(`Invalid negative TTL ${ttl} provided, treating as no TTL`);
      return undefined;
    }

    if (ttl < 1) {
      return undefined;
    }

    // Maximum TTL: 365 days in seconds
    const MAX_TTL = 365 * 24 * 60 * 60;
    if (ttl > MAX_TTL) {
      this.logger.warn(`TTL ${ttl}s exceeds maximum, clamping to ${MAX_TTL}s`);
      return MAX_TTL;
    }

    return ttl;
  }

  /**
   * Detects the current cache backend on initialization.
   * 
   * Determines whether Redis or in-memory caching is being used
   * by checking for Redis client availability.
   * 
   * @private
   */
  private detectBackend(): void {
    const redisClient = this.getRedisClient();
    if (redisClient) {
      this.backend = CacheBackend.REDIS;
      this.logger.log('Cache backend detected: Redis');
    } else {
      this.backend = CacheBackend.MEMORY;
      this.logger.log('Cache backend detected: In-memory (Redis unavailable)');
    }
  }

  /**
   * Tracks cache hits/misses by backend type.
   * 
   * Updates backend-specific statistics based on current backend
   * and whether the operation was a hit or miss.
   * 
   * @param isHit - Whether the operation was a cache hit
   * @private
   */
  private trackBackendHit(isHit: boolean): void {
    if (this.backend === CacheBackend.REDIS) {
      if (isHit) {
        this.redisHits++;
      } else {
        this.redisMisses++;
      }
    } else {
      if (isHit) {
        this.memoryHits++;
      } else {
        this.memoryMisses++;
      }
    }
  }
}
