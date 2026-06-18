import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { ReferralService } from '../services/referral.service';
import { User } from '../entities/user.entity';
import type { RegisterDto } from '../dto/auth.dto';
import * as bcrypt from 'bcrypt';
import { jest } from '@jest/globals';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: Repository<User>;
  let referralService: ReferralService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: ReferralService,
          useValue: {
            generateUniqueReferralCode: jest.fn(),
            validateReferralCode: jest.fn(),
            createReferralRelationship: jest.fn(),
            handleRegistrationComplete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    referralService = module.get<ReferralService>(ReferralService);
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'password123',
      referralCode: 'REFER123',
    };

    it('should successfully register a new user', async () => {
      const hashedPassword = 'hashedPassword';
      const referralCode = 'USER123';
      const savedUser = {
        id: 'user-id',
        ...registerDto,
        password: hashedPassword,
        referralCode,
      } as User;
      const referrer = { id: 'referrer-id' } as User;

      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
      (bcrypt.hash as jest.MockedFunction<any>).mockResolvedValue(
        hashedPassword,
      );
      jest
        .spyOn(referralService, 'generateUniqueReferralCode')
        .mockResolvedValue(referralCode);
      jest.spyOn(userRepository, 'create').mockReturnValue(savedUser);
      jest.spyOn(userRepository, 'save').mockResolvedValue(savedUser);
      jest
        .spyOn(referralService, 'validateReferralCode')
        .mockResolvedValue(referrer);
      jest
        .spyOn(referralService, 'createReferralRelationship')
        .mockResolvedValue({} as any);
      jest
        .spyOn(referralService, 'handleRegistrationComplete')
        .mockResolvedValue();

      const result = await service.register(registerDto);

      expect(result).toEqual(savedUser);
      expect(referralService.createReferralRelationship).toHaveBeenCalledWith(
        referrer,
        savedUser,
      );
      expect(referralService.handleRegistrationComplete).toHaveBeenCalledWith(
        savedUser.id,
      );
    });

    it('should throw ConflictException if user already exists', async () => {
      const existingUser = { id: 'existing-id' } as User;
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(existingUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should register without referral code', async () => {
      const registerDtoWithoutReferral = { ...registerDto };
      delete registerDtoWithoutReferral.referralCode;

      const hashedPassword = 'hashedPassword';
      const referralCode = 'USER123';
      const savedUser = {
        id: 'user-id',
        ...registerDtoWithoutReferral,
        password: hashedPassword,
        referralCode,
      } as User;

      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
      (bcrypt.hash as jest.MockedFunction<any>).mockResolvedValue(
        hashedPassword,
      );
      jest
        .spyOn(referralService, 'generateUniqueReferralCode')
        .mockResolvedValue(referralCode);
      jest.spyOn(userRepository, 'create').mockReturnValue(savedUser);
      jest.spyOn(userRepository, 'save').mockResolvedValue(savedUser);
      jest
        .spyOn(referralService, 'handleRegistrationComplete')
        .mockResolvedValue();

      const result = await service.register(registerDtoWithoutReferral);

      expect(result).toEqual(savedUser);
      expect(referralService.createReferralRelationship).not.toHaveBeenCalled();
    });
  });
});
