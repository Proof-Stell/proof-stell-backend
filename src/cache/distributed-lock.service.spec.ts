import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  DistributedLockService,
  LOCK_RELEASE_OK,
} from './distributed-lock.service';
import { TypedConfigService } from '../common/config/typed-config.service';

describe('DistributedLockService', () => {
  let service: DistributedLockService;
  let redisClient: any;

  const buildModule = async (client: any) => {
    const cacheManager: any = {
      store: client ? { getClient: () => client } : undefined,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DistributedLockService,
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
        {
          provide: TypedConfigService,
          useValue: {
            cronLockTtlMs: 300_000,
            schedulerInstanceId: 'instance-under-test',
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DistributedLockService);
    redisClient = client;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('acquire', () => {
    it('returns a lock handle when SET NX returns OK', async () => {
      redisClient = { set: jest.fn().mockResolvedValue('OK') };
      await buildModule(redisClient);

      const lock = await service.acquire('test:lock', 60_000);

      expect(lock).not.toBeNull();
      expect(lock?.key).toBe('test:lock');
      expect(typeof lock?.token).toBe('string');
      expect(redisClient.set).toHaveBeenCalledTimes(1);
      const [key, value, options] = redisClient.set.mock.calls[0];
      expect(key).toBe('test:lock');
      expect(value).toBe(lock?.token);
      expect(options).toEqual({ px: 60_000, nx: true });
    });

    it('returns null when SET NX returns null because another instance holds the lock', async () => {
      redisClient = { set: jest.fn().mockResolvedValue(null) };
      await buildModule(redisClient);

      const lock = await service.acquire('test:lock', 60_000);

      expect(lock).toBeNull();
      expect(redisClient.set).toHaveBeenCalled();
    });

    it('fails open when no Redis client is available', async () => {
      await buildModule(null);

      const lock = await service.acquire('test:lock');

      expect(lock).not.toBeNull();
      expect(lock?.key).toBe('test:lock');
    });

    it('returns null and logs when the underlying redis call throws', async () => {
      redisClient = {
        set: jest.fn().mockRejectedValue(new Error('connection reset')),
      };
      await buildModule(redisClient);

      const lock = await service.acquire('test:lock', 60_000);

      expect(lock).toBeNull();
      expect(redisClient.set).toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('uses an atomic Lua script and returns true when lock is owned', async () => {
      redisClient = {
        eval: jest.fn().mockResolvedValue(LOCK_RELEASE_OK),
      };
      await buildModule(redisClient);

      const result = await service.release({
        key: 'test:lock',
        token: 'instance-under-test:123:abc',
      });

      expect(result).toBe(true);
      expect(redisClient.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, token] = redisClient.eval.mock.calls[0];
      expect(script).toContain('GET');
      expect(script).toContain('DEL');
      expect(numKeys).toBe(1);
      expect(key).toBe('test:lock');
      expect(token).toBe('instance-under-test:123:abc');
    });

    it('returns false when the eval script reports the lock is no longer held', async () => {
      redisClient = { eval: jest.fn().mockResolvedValue(0) };
      await buildModule(redisClient);

      const result = await service.release({
        key: 'test:lock',
        token: 'instance-under-test:123:abc',
      });

      expect(result).toBe(false);
    });

    it('returns false immediately when called with null', async () => {
      await buildModule(null);

      const result = await service.release(null);

      expect(result).toBe(false);
    });

    it('returns true when Redis is unavailable but a fail-open lock was issued', async () => {
      await buildModule(null);
      const lock = await service.acquire('test:lock');
      expect(lock).not.toBeNull();

      const result = await service.release(lock);

      expect(result).toBe(true);
      // No Redis means no eval script should be issued.
      expect(redisClient).toBeNull();
    });
  });

  describe('runWithLock', () => {
    it('runs the protected unit of work and releases the lock on success', async () => {
      redisClient = {
        set: jest.fn().mockResolvedValue('OK'),
        eval: jest.fn().mockResolvedValue(LOCK_RELEASE_OK),
      };
      await buildModule(redisClient);

      const work = jest.fn().mockResolvedValue('result-value');

      const result = await service.runWithLock('test:lock', 60_000, work);

      expect(result).toBe('result-value');
      expect(work).toHaveBeenCalledTimes(1);
      expect(redisClient.set).toHaveBeenCalled();
      expect(redisClient.eval).toHaveBeenCalled();
    });

    it('still releases the lock when the protected unit throws', async () => {
      redisClient = {
        set: jest.fn().mockResolvedValue('OK'),
        eval: jest.fn().mockResolvedValue(LOCK_RELEASE_OK),
      };
      await buildModule(redisClient);

      const boom = new Error('work failed');

      await expect(
        service.runWithLock('test:lock', 60_000, async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);

      expect(redisClient.eval).toHaveBeenCalled();
    });

    it('returns null and never runs the work when the lock cannot be acquired', async () => {
      redisClient = { set: jest.fn().mockResolvedValue(null) };
      await buildModule(redisClient);

      const work = jest.fn();

      const result = await service.runWithLock('test:lock', 60_000, work);

      expect(result).toBeNull();
      expect(work).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('does NOT issue DEL on shutdown — TTL reclaims any stale lock', async () => {
      // Using DEL on shutdown would race with another node that legitimately
      // re-acquired the same key after our TTL expired.
      redisClient = {
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn(),
      };
      await buildModule(redisClient);

      await service.acquire('test:lock-a');
      await service.acquire('test:lock-b');

      await service.onModuleDestroy();

      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('is a no-op when no locks were acquired during the session', async () => {
      redisClient = { del: jest.fn() };
      await buildModule(redisClient);

      await service.onModuleDestroy();

      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });
});
