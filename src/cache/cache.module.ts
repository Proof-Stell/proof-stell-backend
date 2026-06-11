import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import * as redisStore from 'cache-manager-ioredis';
import { TypedConfigService } from '../common/config/typed-config.service';
import { CacheService } from './cache.service';
import { CacheInterceptor } from './interceptors/cache.interceptor';
import { CacheController } from './cache.controller';

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      isGlobal: true,
      useFactory: (configService: TypedConfigService) => ({
        store: redisStore,
        host: configService.redisHost,
        port: configService.redisPort,
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
      inject: [TypedConfigService],
    }),
  ],
  controllers: [CacheController],
  providers: [CacheService, CacheInterceptor],
  exports: [CacheService, CacheInterceptor, NestCacheModule],
})
export class CacheModule {}
