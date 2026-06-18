import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserModule } from 'src/users/users.module';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './providers/auth.service';
import { HashingService } from './providers/hashing.service';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { CacheModule } from 'src/cache/cache.module';
import { TypedConfigService } from 'src/common/config/typed-config.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    PassportModule,
    AnalyticsModule,
    CacheModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '7d',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    HashingService,
    RolesGuard,
    TypedConfigService,
  ],
  exports: [AuthService, HashingService],
})
export class AuthModule {}
