# Cache Backend Contract and Distributed Locking Documentation

## Overview

This document describes the cache service's backend contract, TTL handling, and distributed locking behavior. The cache service provides consistent semantics across Redis and in-memory backends with graceful fallback capabilities.

## Cache Backend Contract

### Supported Backends

The cache service supports two backend modes:

1. **Redis Backend** (`CacheBackend.REDIS`)
   - Full distributed caching capabilities
   - Atomic operations (INCR, SET with NX)
   - TTL-based expiration
   - Cluster-safe distributed locking
   - Preferred for production environments

2. **In-Memory Backend** (`CacheBackend.MEMORY`)
   - Local process caching only
   - Non-atomic operations (get + set patterns)
   - TTL-based expiration (via cache-manager)
   - Local locking only
   - Used for development or when Redis is unavailable

### Backend Detection

The cache service automatically detects the available backend on initialization:

```typescript
// Automatic detection in constructor
constructor(
  @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  private readonly distributedLockService: DistributedLockService,
) {
  this.detectBackend();
}
```

Backend detection checks for Redis client availability and sets the appropriate mode.

## TTL Handling and Normalization

### TTL Units

All cache operations use **seconds** as the standard TTL unit:
- `cacheService.set(key, value, ttl)` - TTL in seconds
- `cacheService.increment(key, ttl)` - TTL in seconds
- `cacheService.setIfNotExists(key, value, ttl)` - TTL in seconds

### TTL Normalization Rules

TTL values are automatically normalized and validated:

1. **Negative values**: Rejected with warning, treated as no TTL
2. **Zero values**: Treated as no TTL
3. **Values < 1 second**: Treated as no TTL
4. **Maximum TTL**: Clamped to 365 days (31,536,000 seconds)
5. **Undefined/null**: Uses cache-manager default TTL

```typescript
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

  const MAX_TTL = 365 * 24 * 60 * 60; // 365 days
  if (ttl > MAX_TTL) {
    this.logger.warn(`TTL ${ttl}s exceeds maximum, clamping to ${MAX_TTL}s`);
    return MAX_TTL;
  }

  return ttl;
}
```

### TTL Examples

```typescript
// Valid TTL values
await cacheService.set('key', 'value', 3600);  // 1 hour
await cacheService.set('key', 'value', 300);   // 5 minutes
await cacheService.set('key', 'value', 86400); // 1 day

// Edge cases
await cacheService.set('key', 'value', 0);     // No TTL
await cacheService.set('key', 'value', -1);    // No TTL (warning logged)
await cacheService.set('key', 'value', 40000000); // Clamped to 365 days
await cacheService.set('key', 'value');        // Uses default TTL
```

## Core Cache Operations

### set(key, value, ttl?)

**Behavior:**
- Normalizes TTL before storage
- Delegates to cache-manager (Redis or memory)
- Logs backend type for debugging

**Consistency:**
- Both backends store the value with the specified TTL
- Same semantics across Redis and memory

### get(key)

**Behavior:**
- Retrieves value from cache
- Tracks hit/miss statistics by backend type
- Logs backend type for debugging

**Consistency:**
- Both backends return the cached value or undefined
- Statistics distinguish Redis vs memory hits/misses

### increment(key, ttl?)

**Redis Backend:**
- Uses atomic `INCR` operation
- Sets TTL on first increment only (when value === 1)
- Fully atomic operation

**In-Memory Backend:**
- Uses `get` + `value + 1` + `set` pattern
- Non-atomic (race conditions possible in concurrent scenarios)
- Same final behavior as Redis

**Fallback:**
- If Redis fails during increment, automatically falls back to in-memory
- Logs warning about fallback

### setIfNotExists(key, value, ttl?)

**Redis Backend:**
- Uses atomic `SET key value NX EX ttl` operation
- Returns `true` if key was set, `false` if key already existed
- Tracks key collisions in statistics

**In-Memory Backend:**
- Uses `get` + conditional `set` pattern
- Non-atomic (race conditions possible)
- Same final behavior as Redis

**Fallback:**
- If Redis fails, automatically falls back to in-memory
- Logs warning about fallback

### waitForValue(key, timeoutMs, intervalMs?, predicate?)

**Behavior:**
- Polls cache until value appears or timeout expires
- Works identically on both backends
- Tracks number of attempts for debugging

**Consistency:**
- Pure polling operation, same behavior on both backends
- No backend-specific logic

## Distributed Locking

### Lock Backend Modes

The distributed lock service supports two modes:

1. **Redis Mode** (`LockBackend.REDIS`)
   - True distributed locking across cluster
   - Atomic `SET key token NX PX ttl` operation
   - Lua script for safe release
   - TTL acts as safety net for crashes

2. **Fallback Mode** (`LockBackend.FALLBACK`)
   - Local in-memory locking only
   - Process-local lock tracking
   - Used when Redis is unavailable
   - Not cluster-safe

### Lock TTL Handling

Lock operations use **milliseconds** as the TTL unit (different from cache operations):

```typescript
// Lock TTL normalization
private normalizeTtl(ttlMs: number): number {
  const MIN_TTL = 100;    // 100ms minimum
  const MAX_TTL = 3600000; // 1 hour maximum
  
  if (ttlMs < MIN_TTL) return MIN_TTL;
  if (ttlMs > MAX_TTL) return MAX_TTL;
  return ttlMs;
}
```

### Lock Acquisition

**Redis Mode:**
```typescript
const lock = await cacheService.acquireLock('resource:key', 30000, 3);
// TTL: 30000ms (30 seconds)
// Retries: 3 attempts with exponential backoff
```

**Fallback Mode:**
- Activates automatically when Redis is unavailable
- Tracks locks in local `Set<string>`
- No distributed coordination
- Suitable for single-instance development

**Resilience:**
- If Redis fails during acquisition, automatically attempts fallback
- Logs warnings about mode changes
- Tracks acquisition failures in statistics

### Lock Release

**Redis Mode:**
- Uses atomic Lua script to verify token before deletion
- Prevents accidental release of re-acquired locks
- Returns `true` if released, `false` if not held

**Fallback Mode:**
- Simple removal from local tracking set
- Always succeeds if lock was tracked locally

**Error Handling:**
- If Redis fails during release, relies on TTL for cleanup
- Cleans up local state regardless of Redis success
- Logs warnings about Redis unavailability

### Lock Usage Pattern

```typescript
const lock = await cacheService.acquireLock('leaderboard:recalculate', 30000, 3);
if (!lock) {
  // Lock not acquired, handle gracefully
  return;
}

try {
  // Critical section
  await performCriticalOperation();
} finally {
  await cacheService.releaseLock(lock);
}
```

### Helper: withLock

Convenience helper for automatic lock management:

```typescript
const result = await cacheService.withLock('resource:key', 30000, async () => {
  // Critical section
  return await performOperation();
});

if (!result) {
  // Lock not acquired
}
```

## Cache Statistics

### Statistics Overview

The cache service provides detailed statistics to distinguish backend performance:

```typescript
interface CacheStats {
  hits: number;              // Total cache hits
  misses: number;            // Total cache misses
  hitRate: number;           // Hit rate (0-1)
  totalRequests: number;    // Total cache operations
  backend: CacheBackend;     // Current backend type
  redisHits: number;         // Redis-specific hits
  redisMisses: number;       // Redis-specific misses
  memoryHits: number;        // Memory-specific hits
  memoryMisses: number;      // Memory-specific misses
  lockFailures: number;      // Lock acquisition failures
  keyCollisions: number;     // setIfNotExists collisions
}
```

### Using Statistics

```typescript
const stats = cacheService.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
console.log(`Backend: ${stats.backend}`);
console.log(`Redis hits: ${stats.redisHits}, Memory hits: ${stats.memoryHits}`);
console.log(`Lock failures: ${stats.lockFailures}`);
console.log(`Key collisions: ${stats.keyCollisions}`);

// Reset statistics
cacheService.resetStats();
```

### Lock Statistics

The distributed lock service also provides statistics:

```typescript
const lockStats = distributedLockService.getStats();
console.log(`Lock backend: ${lockStats.backend}`);
console.log(`Active locks: ${lockStats.activeLocks}`);
console.log(`Acquisition failures: ${lockStats.acquisitionFailures}`);
console.log(`Release failures: ${lockStats.releaseFailures}`);
```

## Error Handling and Resilience

### Redis Failure Handling

**Cache Operations:**
- `increment`: Falls back to in-memory if Redis fails
- `setIfNotExists`: Falls back to in-memory if Redis fails
- `get`/`set`: Delegates to cache-manager error handling
- All failures are logged with warnings

**Lock Operations:**
- `acquire`: Attempts fallback if Redis fails
- `release`: Relies on TTL if Redis fails during release
- All failures are logged with warnings

### Graceful Degradation

The cache service is designed to degrade gracefully:

1. **Redis available**: Full distributed caching and locking
2. **Redis unavailable**: In-memory caching with local locking
3. **Redis intermittent**: Automatic fallback and recovery
4. **Partial failures**: Operation-specific fallback

### Logging

All important events are logged with appropriate levels:

- `log`: Backend detection, lock acquisition/release
- `warn`: Redis failures, fallback activation, TTL issues
- `debug`: Cache hits/misses, operation details
- `error`: Operation failures

## Best Practices

### TTL Selection

- **Short-lived data** (session data, counters): 5-15 minutes
- **Medium-lived data** (user profiles, rankings): 1-24 hours
- **Long-lived data** (configuration, static content): 1-7 days
- **Avoid very long TTLs**: Use 365 days maximum

### Lock Usage

- **Keep lock TTL short**: 5-30 seconds for most operations
- **Always release locks**: Use `try/finally` or `withLock` helper
- **Handle lock failures**: Return null or retry with backoff
- **Avoid nested locks**: Can lead to deadlocks

### Cache Key Design

Follow the pattern: `<module>:<entity>:<id>`

```typescript
// Good key patterns
'user:profile:123'
'leaderboard:global:page:1:limit:50'
'wallet:transaction:user456:request789'

// Avoid
'userdata123' // Too generic
'user-profile-123' // Inconsistent separator
```

### Monitoring

Monitor cache statistics regularly:

```typescript
// In a scheduled task
setInterval(() => {
  const stats = cacheService.getStats();
  if (stats.hitRate < 0.5) {
    logger.warn('Low cache hit rate detected');
  }
  if (stats.lockFailures > 10) {
    logger.warn('High lock failure rate detected');
  }
}, 60000); // Every minute
```

## Migration Guide

### From Direct Cache-Manager Usage

**Before:**
```typescript
constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

async getData() {
  const cached = await this.cacheManager.get('key');
  if (cached) return cached;
  
  const data = await fetchFromDb();
  await this.cacheManager.set('key', data, 3600);
  return data;
}
```

**After:**
```typescript
constructor(private cacheService: CacheService) {}

async getData() {
  const cached = await this.cacheService.get('key');
  if (cached) return cached;
  
  const data = await fetchFromDb();
  await this.cacheService.set('key', data, 3600);
  return data;
}
```

### TTL Unit Conversion

If you were using milliseconds with cache-manager, convert to seconds:

```typescript
// Before (milliseconds)
await cacheManager.set('key', value, 3600000); // 1 hour in ms

// After (seconds)
await cacheService.set('key', value, 3600); // 1 hour in seconds
```

## Testing

### Testing with Mock Cache

```typescript
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  increment: jest.fn(),
  // ... other methods
} as unknown as CacheService;
```

### Testing Backend Detection

```typescript
// Test Redis mode
const redisCacheService = new CacheService(redisCacheManager, lockService);
expect(redisCacheService.getStats().backend).toBe(CacheBackend.REDIS);

// Test memory mode
const memoryCacheService = new CacheService(memoryCacheManager, lockService);
expect(memoryCacheService.getStats().backend).toBe(CacheBackend.MEMORY);
```

### Testing Lock Fallback

```typescript
// Test lock acquisition failure handling
const lock = await cacheService.acquireLock('test:key', 1000, 0);
expect(lock).toBeNull();
expect(cacheService.getStats().lockFailures).toBeGreaterThan(0);
```

## Troubleshooting

### High Lock Failure Rate

**Symptoms:** `lockFailures` counter increasing rapidly

**Possible Causes:**
- Lock TTL too short for operations
- High contention on lock keys
- Redis connectivity issues

**Solutions:**
- Increase lock TTL
- Reduce lock contention
- Check Redis connectivity

### Low Cache Hit Rate

**Symptoms:** `hitRate` below 50%

**Possible Causes:**
- TTL too short
- Cache keys not reused
- Cache eviction due to memory limits

**Solutions:**
- Increase TTL for frequently accessed data
- Review cache key patterns
- Check Redis memory configuration

### Backend Switching

**Symptoms:** Backend type changes between requests

**Possible Causes:**
- Redis connectivity issues
- Intermittent network problems

**Solutions:**
- Check Redis connection stability
- Monitor Redis logs
- Consider Redis Sentinel/Cluster for high availability

## Conclusion

The cache service provides a robust, consistent interface for caching operations across Redis and in-memory backends. By following this contract and understanding the behavior differences, you can build resilient applications that gracefully handle cache backend failures while maintaining consistent semantics.