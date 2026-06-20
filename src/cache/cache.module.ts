import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as redisStore from 'cache-manager-ioredis';
import { CacheService } from './cache.service';
import { CacheInterceptor } from './interceptors/cache.interceptor';
import { CacheController } from './cache.controller';
import { DistributedLockService } from './distributed-lock.service';

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      isGlobal: true,
      useFactory: (configService: ConfigService) => ({
        store: redisStore,
        host: configService.get<string>('app.redisHost', 'localhost'),
        port: configService.get<number>('app.redisPort', 6379),
        ttl: 300, // Default 5 minutes TTL
        max: 1000, // Maximum number of items in cache
        keyPrefix: 'Proof-Stell:', // Prefix for all cache keys
        // Redis connection options
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keepAlive: 30000,
        family: 4, // IPv4
        // Serialization options
        serialize: JSON.stringify,
        deserialize: JSON.parse,
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CacheController],
  providers: [CacheService, CacheInterceptor, DistributedLockService],
  exports: [
    CacheService,
    CacheInterceptor,
    DistributedLockService,
    NestCacheModule,
  ],
})
export class CacheModule {}
