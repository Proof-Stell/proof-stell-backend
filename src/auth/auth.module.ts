import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UserModule } from 'src/users/users.module';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './providers/auth.service';
import { AuthTokenService } from './providers/auth-token.service';
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
      inject: [TypedConfigService],
      useFactory: async (configService: TypedConfigService) => ({
        secret: configService.jwtSecret,
        signOptions: {
          issuer: configService.jwtIssuer,
          audience: configService.jwtAudience,
          expiresIn: configService.jwtAccessTtl,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokenService,
    LocalStrategy,
    JwtStrategy,
    RolesGuard,
    TypedConfigService,
  ],
  exports: [AuthService, AuthTokenService],
})
export class AuthModule {}
