import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { TypedConfigService } from '../common/config/typed-config.service';

/**
 * Release a lock only if the value still matches the holder token.
 * Uses an atomic Lua script to avoid releasing a lock that has already
 * expired and been re-acquired by another instance.
 */
const RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export const LOCK_RELEASE_OK = 1;
export const LOCK_RELEASE_NOT_HELD = 0;

export enum LockBackend {
  REDIS = 'redis',
  FALLBACK = 'fallback'
}

export interface AcquiredLock {
  key: string;
  token: string;
  backend: LockBackend;
}

/**
 * Cluster-safe distributed lock built on the existing Redis connection
 * used by `CacheService`. Uses `SET key value NX PX ttl` semantics with a
 * unique holder token, so a healthy worker does not accidentally delete a
 * lock acquired by another instance when its TTL unexpectedly expired.
 * Designed so a crashed worker does not deadlock the rest of the cluster
 * (TTL acts as the safety boundary).
 *
 * The service provides graceful fallback when Redis is unavailable:
 * - Redis mode: Full distributed locking with atomic operations
 * - Fallback mode: Local in-memory locking for development/single-instance scenarios
 *
 * The service is intentionally Redis-primary but does not depend on any
 * third-party lock library — the Redis backend is already a hard
 * dependency of the application via `CacheModule`.
 */
@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly activeLocks = new Set<string>();
  private backend: LockBackend = LockBackend.REDIS;
  private acquisitionFailures = 0;
  private releaseFailures = 0;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: TypedConfigService,
  ) {
    this.detectBackend();
  }

  /**
   * Attempt to acquire a lock for the given key. Returns the lock handle
   * on success and `null` when another instance already holds the lock
   * (or the underlying Redis store rejects the request).
   * 
   * The method is resilient to Redis failures and will fall back to
   * local in-memory locking when Redis is unavailable.
   */
  async acquire(
    key: string,
    ttlMs: number = this.configService.cronLockTtlMs,
  ): Promise<AcquiredLock | null> {
    const normalizedTtlMs = this.normalizeTtl(ttlMs);
    const client = this.getRedisClient();
    // Token is `instanceId:timestamp:rand` — instance id + timestamp
    // dominate uniqueness, the random suffix is a cheap defense against
    // same-millisecond re-acquisition from the same instance. It is
    // not cryptographically random and that is intentional: this is a
    // coordination token, not a credential.
    const token = `${this.configService.schedulerInstanceId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    if (!client || typeof client.set !== 'function') {
      // Fail-open: without Redis we accept that we are not cluster-safe,
      // but the application must still be runnable for development.
      this.logger.warn(
        `Redis client unavailable; using fallback mode for lock '${key}' on instance ${this.configService.schedulerInstanceId}.`,
      );
      this.backend = LockBackend.FALLBACK;
      
      // Check if already held locally
      if (this.activeLocks.has(key)) {
        this.logger.debug(`Lock '${key}' already held locally (fallback mode).`);
        return null;
      }
      
      this.activeLocks.add(key);
      this.logger.log(
        `Acquired lock '${key}' in fallback mode for instance ${this.configService.schedulerInstanceId} (ttl=${normalizedTtlMs}ms).`,
      );
      return { key, token, backend: LockBackend.FALLBACK };
    }

    try {
      // SET key value NX PX ttl — atomic acquire with TTL safety net.
      // Using the options-object form keeps the lock future-compatible
      // with ioredis 5+ where the variadic caller is deprecated.
      const result = await client.set(key, token, { px: normalizedTtlMs, nx: true });

      if (result !== 'OK') {
        this.logger.debug(`Lock '${key}' is held by another instance.`);
        return null;
      }

      this.activeLocks.add(key);
      this.backend = LockBackend.REDIS;
      this.logger.log(
        `Acquired lock '${key}' for instance ${this.configService.schedulerInstanceId} (ttl=${normalizedTtlMs}ms, backend=redis).`,
      );
      return { key, token, backend: LockBackend.REDIS };
    } catch (error) {
      this.acquisitionFailures++;
      this.logger.error(
        `Failed to acquire lock '${key}' via Redis, attempting fallback: ${(error as Error).message}`,
      );
      
      // Attempt fallback on Redis failure
      if (this.activeLocks.has(key)) {
        this.logger.debug(`Lock '${key}' already held locally (fallback after Redis failure).`);
        return null;
      }
      
      this.backend = LockBackend.FALLBACK;
      this.activeLocks.add(key);
      this.logger.log(
        `Acquired lock '${key}' in fallback mode after Redis failure for instance ${this.configService.schedulerInstanceId}.`,
      );
      return { key, token, backend: LockBackend.FALLBACK };
    }
  }

  /**
   * Release a previously acquired lock. Only succeeds when the stored
   * value matches the token returned from `acquire`, preventing a
   * delayed release from deleting a lock owned by another instance.
   * 
   * Handles both Redis and fallback mode releases appropriately.
   */
  async release(lock: AcquiredLock | null | undefined): Promise<boolean> {
    if (!lock) {
      return false;
    }

    this.activeLocks.delete(lock.key);

    // Handle fallback mode locks
    if (lock.backend === LockBackend.FALLBACK) {
      this.logger.log(
        `Released lock '${lock.key}' in fallback mode for instance ${this.configService.schedulerInstanceId}.`,
      );
      return true;
    }

    const client = this.getRedisClient();
    if (!client || typeof client.eval !== 'function') {
      // If we can't reach Redis but the lock was acquired in Redis mode,
      // we still clean up local state and rely on TTL for safety
      this.logger.warn(
        `Redis unavailable during release of lock '${lock.key}'; relying on TTL for cleanup.`,
      );
      return true;
    }

    try {
      const result = await client.eval(
        RELEASE_LOCK_LUA,
        1,
        lock.key,
        lock.token,
      );
      const released = Number(result) === LOCK_RELEASE_OK;
      if (released) {
        this.logger.log(
          `Released lock '${lock.key}' for instance ${this.configService.schedulerInstanceId}.`,
        );
      } else {
        this.logger.debug(
          `Lock '${lock.key}' was no longer held by instance ${this.configService.schedulerInstanceId} when releasing.`,
        );
      }
      return released;
    } catch (error) {
      this.releaseFailures++;
      this.logger.error(
        `Failed to release lock '${lock.key}': ${(error as Error).message}`,
      );
      // Even if release fails, we've cleaned up local state
      // Redis TTL will handle the rest
      return false;
    }
  }

  /**
   * Convenience helper: acquire, run the protected unit of work, release
   * the lock on completion or error, and return the protected result.
   * Returns `null` when the lock could not be acquired so callers can
   * decide whether to skip silently or surface a warning.
   */
  async runWithLock<T>(
    key: string,
    ttlMs: number,
    work: () => Promise<T>,
  ): Promise<T | null> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) {
      this.logger.debug(`Skipping work for lock '${key}'; not acquired.`);
      return null;
    }
    try {
      return await work();
    } finally {
      await this.release(lock);
    }
  }

  /**
   * Best-effort cleanup on shutdown. We deliberately do NOT call
   * `DEL` directly here: if our TTL expired and another instance has
   * legitimately re-acquired the key, an unwary `DEL` would erase their
   * lock and allow a third node to double-run. Redis TTL is the safety
   * net for any lock we previously failed to release.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.activeLocks.size === 0) {
      return;
    }
    this.logger.log(
      `${this.activeLocks.size} lock(s) tracked at shutdown; relying on TTL to expire them.`,
    );
    this.activeLocks.clear();
  }

  /**
   * Try every known shape of underlying client, mirroring the pattern in
   * `CacheService`. Centralized here so each lock call does not have to
   * duplicate the discovery logic.
   */
  private getRedisClient(): any {
    const cacheManager = this.cacheManager as any;
    const store = cacheManager?.store || cacheManager?.stores?.[0];
    if (!store) {
      return undefined;
    }
    return (
      store.getClient?.() || store.client || store.redis || store.redisClient
    );
  }

  /**
   * Normalizes and validates lock TTL values.
   * 
   * Ensures TTL values are within acceptable ranges:
   * - Rejects negative values
   * - Clamps to reasonable maximum (1 hour)
   * - Ensures minimum (100ms)
   * 
   * @param ttlMs - The TTL value in milliseconds
   * @returns Normalized TTL in milliseconds
   * @private
   */
  private normalizeTtl(ttlMs: number): number {
    if (ttlMs < 0) {
      this.logger.warn(`Invalid negative lock TTL ${ttlMs}ms, using default`);
      return this.configService.cronLockTtlMs;
    }

    const MIN_TTL = 100; // 100ms minimum
    const MAX_TTL = 3600000; // 1 hour maximum

    if (ttlMs < MIN_TTL) {
      this.logger.warn(`Lock TTL ${ttlMs}ms below minimum, using ${MIN_TTL}ms`);
      return MIN_TTL;
    }

    if (ttlMs > MAX_TTL) {
      this.logger.warn(`Lock TTL ${ttlMs}ms exceeds maximum, using ${MAX_TTL}ms`);
      return MAX_TTL;
    }

    return ttlMs;
  }

  /**
   * Detects the available lock backend on initialization.
   * 
   * Determines whether Redis is available for distributed locking
   * or if fallback mode should be used.
   * 
   * @private
   */
  private detectBackend(): void {
    const client = this.getRedisClient();
    if (client && typeof client.set === 'function') {
      this.backend = LockBackend.REDIS;
      this.logger.log('Distributed lock backend: Redis');
    } else {
      this.backend = LockBackend.FALLBACK;
      this.logger.log('Distributed lock backend: Fallback (Redis unavailable)');
    }
  }

  /**
   * Gets lock service statistics.
   * 
   * Returns performance metrics for the lock service including
   * backend mode and failure counts.
   * 
   * @returns Lock service statistics
   */
  getStats() {
    return {
      backend: this.backend,
      activeLocks: this.activeLocks.size,
      acquisitionFailures: this.acquisitionFailures,
      releaseFailures: this.releaseFailures,
    };
  }

  /**
   * Resets lock service statistics.
   */
  resetStats() {
    this.acquisitionFailures = 0;
    this.releaseFailures = 0;
  }
}
