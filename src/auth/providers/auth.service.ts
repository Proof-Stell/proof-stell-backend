import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Inject,
  forwardRef,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { plainToClass } from 'class-transformer';
import { ReadUserDto } from 'src/users/dto/read-user.dto';
import { UserService } from 'src/users/providers/users.service';
import { RegisterDto } from '../dto/register.dto';
import { HashingService } from './hashing.service';
import { v4 as uuidv4 } from 'uuid';
import { MailService } from 'src/mail/mail.service';
import { addHours } from 'date-fns';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics-event.enum';
import { CacheService } from 'src/cache/cache.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';
import { createHash } from 'crypto';

interface LoginContext {
  ip?: string;
  userAgent?: string;
}

interface LockoutMetadata {
  lockedUntil: number;
  attempts: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtExpiresIn = '24h';

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private readonly hashingService: HashingService,
    private readonly mailService: MailService,
    private readonly cacheService: CacheService,
    private readonly configService: TypedConfigService,
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analyticsService: AnalyticsService,
  ) {}

  async validateUser(
    email: string,
    password: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<any> {
    const context = this.buildLoginContext(clientIp, userAgent);
    const normalizedEmail = this.normalizeEmail(email);
    const lockoutKeys = this.buildLockoutKeys(
      normalizedEmail,
      context.ip,
      context.userAgent,
    );

    // Check if account is locked
    await this.checkAccountLockout(normalizedEmail, lockoutKeys, context);

    const user = await this.userService.findByEmail(normalizedEmail);
    if (!user) {
      await this.recordFailedAttempt(normalizedEmail, lockoutKeys, context);
      this.logger.warn(
        `Failed login attempt for non-existent user: ${normalizedEmail} from IP: ${context.ip}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isActive === false) {
      this.logger.warn(`Login attempt for inactive user: ${normalizedEmail}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Please verify your email to log in');
    }

    const isMatch = await this.hashingService.comparePassword(
      password,
      user.password,
    );
    if (!isMatch) {
      await this.recordFailedAttempt(normalizedEmail, lockoutKeys, context);
      this.logger.warn(
        `Failed login attempt for user: ${normalizedEmail} from IP: ${context.ip}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    // Clear failed attempts on successful login
    await this.clearFailedAttempts(normalizedEmail, lockoutKeys, context);
    this.logger.log(`Successful login for user: ${normalizedEmail}`);

    return user;
  }

  async login(user: any, context?: LoginContext) {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
    };

    // Update last login
    await this.userService.updateLastLogin(user.id);

    // Track login event
    if (this.analyticsService) {
      await this.analyticsService.track(AnalyticsEvent.UserLoggedIn, {
        userId: user.id,
      });
    }

    return {
      access_token: this.jwtService.sign(payload),
      user: plainToClass(ReadUserDto, user, {
        excludeExtraneousValues: true,
      }),
    };
  }

  async register(
    registerDto: RegisterDto,
  ): Promise<{ access_token: string; user: ReadUserDto }> {
    try {
      const hashedPassword = await this.hashingService.hashPassword(
        registerDto.password,
      );
      const emailVerificationToken = uuidv4();
      const emailVerificationExpires = addHours(new Date(), 24);
      const user = await this.userService.create({
        ...registerDto,
        password: hashedPassword,
        isEmailVerified: false,
        emailVerificationToken,
        emailVerificationExpires,
        role: undefined,
      });
      const fullUser = await this.userService.findByEmail(user.email);
      const verificationUrl = `https://yourapp.com/verify-email?token=${emailVerificationToken}`;
      await this.mailService.sendVerificationEmail(
        fullUser.email,
        fullUser.username,
        verificationUrl,
      );
      // Track registration event
      if (this.analyticsService) {
        await this.analyticsService.track(AnalyticsEvent.UserRegistered, {
          userId: fullUser.id,
        });
      }
      return {
        access_token: '',
        user: fullUser,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new Error('Registration failed');
    }
  }

  async verifyEmail(token: string): Promise<boolean> {
    const user = await this.userService.findByVerificationToken(token);
    if (!user)
      throw new UnauthorizedException('Invalid or expired verification token');
    if (user.isEmailVerified)
      throw new ConflictException('Email already verified');
    if (
      !user.emailVerificationExpires ||
      user.emailVerificationExpires < new Date()
    ) {
      throw new UnauthorizedException('Verification token expired');
    }
    await this.userService.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });
    return true;
  }

  async resendVerificationEmail(email: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (!user) throw new UnauthorizedException('User not found');
    if (user.isEmailVerified)
      throw new ConflictException('Email already verified');
    const emailVerificationToken = uuidv4();
    const emailVerificationExpires = addHours(new Date(), 24);
    await this.userService.update(user.id, {
      emailVerificationToken,
      emailVerificationExpires,
    });
    const verificationUrl = `https://yourapp.com/verify-email?token=${emailVerificationToken}`;
    await this.mailService.sendVerificationEmail(
      user.email,
      user.username,
      verificationUrl,
    );
    return true;
  }

  private async checkAccountLockout(
    email: string,
    keys: { attemptsKey: string; lockoutKey: string },
    context: Required<LoginContext>,
  ): Promise<void> {
    const lockout = await this.cacheService.get<LockoutMetadata>(
      keys.lockoutKey,
    );

    if (lockout?.lockedUntil && lockout.lockedUntil > Date.now()) {
      const remainingSeconds = Math.ceil(
        (lockout.lockedUntil - Date.now()) / 1000,
      );
      this.logger.warn(
        `Lockout bypass attempt for user: ${email} from IP: ${context.ip}. Remaining: ${remainingSeconds} seconds`,
      );
      throw new HttpException(
        `Account temporarily locked due to too many failed login attempts. Try again in ${Math.ceil(
          remainingSeconds / 60,
        )} minutes.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (lockout) {
      await this.cacheService.del(keys.lockoutKey);
      await this.cacheService.del(keys.attemptsKey);
      this.logger.log(
        `Lockout expiration for user: ${email} from IP: ${context.ip}`,
      );
    }
  }

  private async recordFailedAttempt(
    email: string,
    keys: { attemptsKey: string; lockoutKey: string },
    context: Required<LoginContext>,
  ): Promise<void> {
    const attempts = await this.cacheService.increment(
      keys.attemptsKey,
      this.configService.authAttemptWindowSeconds,
    );

    this.logger.warn(
      `Failed login attempt recorded for user: ${email} from IP: ${context.ip}. Attempts: ${attempts}`,
    );

    if (attempts >= this.configService.authMaxFailedAttempts) {
      const lockout: LockoutMetadata = {
        attempts,
        lockedUntil:
          Date.now() + this.configService.authLockoutDurationSeconds * 1000,
      };

      await this.cacheService.set(
        keys.lockoutKey,
        lockout,
        this.getLockoutMetadataTtlSeconds(),
      );
      this.logger.warn(
        `Lockout triggered for user: ${email} from IP: ${context.ip} after ${attempts} failed attempts`,
      );
    }
  }

  private async clearFailedAttempts(
    email: string,
    keys: { attemptsKey: string; lockoutKey: string },
    context: Required<LoginContext>,
  ): Promise<void> {
    await Promise.all([
      this.cacheService.del(keys.attemptsKey),
      this.cacheService.del(keys.lockoutKey),
    ]);
    this.logger.log(
      `Successful reset of failed login attempts for user: ${email} from IP: ${context.ip}`,
    );
  }

  /**
   * Get remaining lockout time for an email
   */
  async getRemainingLockoutTime(
    email: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<number> {
    const context = this.buildLoginContext(clientIp, userAgent);
    const keys = this.buildLockoutKeys(
      this.normalizeEmail(email),
      context.ip,
      context.userAgent,
    );
    const lockout = await this.cacheService.get<LockoutMetadata>(
      keys.lockoutKey,
    );
    if (lockout?.lockedUntil && lockout.lockedUntil > Date.now()) {
      return Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
    }
    if (lockout) {
      await this.cacheService.del(keys.lockoutKey);
      await this.cacheService.del(keys.attemptsKey);
      this.logger.log(
        `Lockout expiration for user: ${this.normalizeEmail(email)} from IP: ${
          context.ip
        }`,
      );
    }
    return 0;
  }

  /**
   * Manually unlock an account (admin function)
   */
  async unlockAccount(
    email: string,
    clientIp?: string,
    userAgent?: string,
  ): Promise<void> {
    const context = this.buildLoginContext(clientIp, userAgent);
    const normalizedEmail = this.normalizeEmail(email);
    const keys = this.buildLockoutKeys(
      normalizedEmail,
      context.ip,
      context.userAgent,
    );
    await this.clearFailedAttempts(normalizedEmail, keys, context);
    this.logger.log(`Account manually unlocked for user: ${normalizedEmail}`);
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }

  private buildLoginContext(
    ip?: string,
    userAgent?: string,
  ): Required<LoginContext> {
    return {
      ip: (ip || 'unknown').trim() || 'unknown',
      userAgent: (userAgent || 'unknown').trim() || 'unknown',
    };
  }

  private buildLockoutKeys(email: string, ip: string, userAgent?: string) {
    const deviceHash = this.hashDeviceMetadata(userAgent);
    return {
      attemptsKey: `auth:attempts:${email}:${ip}:${deviceHash}`,
      lockoutKey: `auth:lockout:${email}:${ip}:${deviceHash}`,
    };
  }

  private hashDeviceMetadata(userAgent?: string): string {
    return createHash('sha256')
      .update((userAgent || 'unknown').trim().toLowerCase())
      .digest('hex')
      .slice(0, 16);
  }

  private getLockoutMetadataTtlSeconds(): number {
    return (
      this.configService.authLockoutDurationSeconds +
      this.configService.authAttemptWindowSeconds
    );
  }
}
