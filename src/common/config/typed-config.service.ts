import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  bcryptSaltRounds: number;
  leaderboardRecalculationStrategy: string;
  redisHost: string;
  redisPort: number;
  authMaxFailedAttempts: number;
  authLockoutDurationSeconds: number;
  authAttemptWindowSeconds: number;
  starknetPrivateKey: string;
  starknetAccountAddress: string;
  mintContractAddress: string;
  // Add more config types as needed
}

@Injectable()
export class TypedConfigService {
  constructor(private readonly configService: ConfigService) {}

  get app(): AppConfig {
    return {
      port: this.configService.get<number>('app.port'),
      nodeEnv: this.configService.get<string>('app.nodeEnv'),
      databaseUrl: this.configService.get<string>('app.databaseUrl'),
      jwtSecret: this.configService.get<string>('app.jwtSecret'),
      bcryptSaltRounds: this.configService.get<number>(
        'app.bcryptSaltRounds',
        12,
      ),
      leaderboardRecalculationStrategy: this.configService.get<string>(
        'app.leaderboardRecalculationStrategy',
        'batch',
      ),
      redisHost: this.configService.get<string>('app.redisHost', 'localhost'),
      redisPort: this.configService.get<number>('app.redisPort', 6379),
      authMaxFailedAttempts: this.configService.get<number>(
        'app.authMaxFailedAttempts',
        5,
      ),
      authLockoutDurationSeconds: this.configService.get<number>(
        'app.authLockoutDurationSeconds',
        900,
      ),
      authAttemptWindowSeconds: this.configService.get<number>(
        'app.authAttemptWindowSeconds',
        900,
      ),
      starknetPrivateKey: this.configService.get<string>(
        'app.starknetPrivateKey',
      ),
      starknetAccountAddress: this.configService.get<string>(
        'app.starknetAccountAddress',
      ),
      mintContractAddress: this.configService.get<string>(
        'app.mintContractAddress',
      ),
      // Add more config getters as needed
    };
  }

  // Direct getters for convenience
  get port() {
    return this.app.port;
  }
  get nodeEnv() {
    return this.app.nodeEnv;
  }
  get databaseUrl() {
    return this.app.databaseUrl;
  }
  get jwtSecret() {
    return this.app.jwtSecret;
  }
  get bcryptSaltRounds() {
    return this.app.bcryptSaltRounds;
  }
  get leaderboardRecalculationStrategy() {
    return this.app.leaderboardRecalculationStrategy;
  }
  get redisHost() {
    return this.app.redisHost;
  }
  get redisPort() {
    return this.app.redisPort;
  }
  get authMaxFailedAttempts() {
    return this.app.authMaxFailedAttempts;
  }
  get authLockoutDurationSeconds() {
    return this.app.authLockoutDurationSeconds;
  }
  get authAttemptWindowSeconds() {
    return this.app.authAttemptWindowSeconds;
  }
  get starknetPrivateKey() {
    return this.app.starknetPrivateKey;
  }
  get starknetAccountAddress() {
    return this.app.starknetAccountAddress;
  }
  get mintContractAddress() {
    return this.app.mintContractAddress;
  }
}
