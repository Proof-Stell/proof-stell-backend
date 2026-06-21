import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../users/providers/users.service';
import { MailService } from '../../mail/mail.service';
import { CreateUserDto } from '../../users/dto/create-user.dto';
import { ReadUserDto } from '../../users/dto/read-user.dto';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async register(createUserDto: CreateUserDto): Promise<ReadUserDto> {
    // 1. Generate security token credentials beforehand
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour expiration window

    // 2. Pass complete fields down to UserService for conflict validation and storage
    const savedUserDto = await this.usersService.create({
      ...createUserDto,
      isEmailVerified: false,
      emailVerificationToken,
      emailVerificationExpires,
    } as any); // Safely cast if fields are structurally managed via entity metadata overrides

    // 3. Compile the dynamic redirect URL using server configuration environments
    const baseUrl =
      this.configService.get<string>('FRONTEND_BASE_URL') ||
      'http://localhost:3000';
    const verificationUrl = `${baseUrl}/auth/verify-email?token=${emailVerificationToken}`;

    // 4. Dispatch the onboarding email matching the MailService parameters
    await this.mailService.sendVerificationEmail(
      savedUserDto.email,
      savedUserDto.username,
      verificationUrl,
    );

    return savedUserDto;
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    if (!token) {
      throw new BadRequestException('Token must be provided.');
    }

    // This lookup now successfully includes emailVerificationExpires thanks to our previous fix
    const user = await this.usersService.findByVerificationToken(token);

    if (!user || !user.emailVerificationToken) {
      throw new BadRequestException(
        'Invalid or already used verification token.',
      );
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email address has already been verified.');
    }

    const now = new Date();
    if (user.emailVerificationExpires && now > user.emailVerificationExpires) {
      throw new BadRequestException('Verification token has expired.');
    }

    // Safely clear verification metadata tokens to prevent reuse attacks
    await this.usersService.update(user.id, {
      isEmailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    } as any);

    return { message: 'Email address successfully verified.' };
  }
}
