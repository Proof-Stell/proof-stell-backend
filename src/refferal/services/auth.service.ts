import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import type { RegisterDto } from '../dto/auth.dto';
import { ReferralService } from './referral.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private referralService: ReferralService,
  ) {}

  async register(registerDto: RegisterDto): Promise<User> {
    const { email, username, password, referralCode } = registerDto;

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { username }],
    });

    if (existingUser) {
      throw new ConflictException(
        'User with this email or username already exists',
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate unique referral code for new user
    const newUserReferralCode =
      await this.referralService.generateUniqueReferralCode();

    // Create user
    const user = this.userRepository.create({
      email,
      username,
      password: hashedPassword,
      referralCode: newUserReferralCode,
    });

    const savedUser = await this.userRepository.save(user);

    // Handle referral if code provided
    if (referralCode) {
      const referrer = await this.referralService.validateReferralCode(
        referralCode,
        savedUser.id,
      );
      if (referrer) {
        await this.referralService.createReferralRelationship(
          referrer,
          savedUser,
        );
      }
    }

    // Mark registration as complete
    await this.referralService.handleRegistrationComplete(savedUser.id);

    return savedUser;
  }
}
