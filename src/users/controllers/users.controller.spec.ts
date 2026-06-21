import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../../auth/controllers/auth.controller';
import { AuthService } from '../../auth/providers/auth.service';
import { BadRequestException } from '@nestjs/common';

describe('AuthController - Email Verification Flow Tests', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    register: jest.fn(),
    verifyEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should successfully pass verification on valid tokens', async () => {
    mockAuthService.verifyEmail.mockResolvedValue({
      message: 'Email address successfully verified.',
    });

    const res = await controller.verifyEmail('valid-token-string');
    expect(res.message).toContain('successfully verified');
    expect(authService.verifyEmail).toHaveBeenCalledWith('valid-token-string');
  });

  it('should reject requests with missing token signatures', async () => {
    mockAuthService.verifyEmail.mockRejectedValue(
      new BadRequestException('Token must be provided.'),
    );

    await expect(controller.verifyEmail('')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should reject requests when token has already expired', async () => {
    mockAuthService.verifyEmail.mockRejectedValue(
      new BadRequestException('Verification token has expired.'),
    );

    await expect(controller.verifyEmail('expired-token')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should fail elegantly if token has already been spent or used', async () => {
    mockAuthService.verifyEmail.mockRejectedValue(
      new BadRequestException('Invalid or already used verification token.'),
    );

    await expect(controller.verifyEmail('spent-token')).rejects.toThrow(
      BadRequestException,
    );
  });
});
