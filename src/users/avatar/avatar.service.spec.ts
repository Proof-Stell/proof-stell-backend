import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AvatarService } from './avatar.service';
import { User } from '../entities/user.entity';
import * as sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';

const mockSharpPipeline = {
  metadata: jest.fn(),
  rotate: jest.fn().mockReturnThis(),
  resize: jest.fn().mockReturnThis(),
  webp: jest.fn().mockReturnThis(),
  toFile: jest.fn(),
};

jest.mock('sharp', () => {
  const sharpMock = jest.fn(() => mockSharpPipeline) as any;
  sharpMock.fit = { cover: 'cover' };
  sharpMock.strategy = { attention: 'attention' };
  return sharpMock;
});

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  unlink: jest.fn(),
}));

describe('AvatarService', () => {
  let service: AvatarService;
  let userRepository: jest.Mocked<Repository<User>>;

  const mockUserId = '9f3e5dfa-7f65-4653-aa34-b7424af1e2b7';
  const pngBuffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  const mockUser = {
    id: mockUserId,
    username: 'testuser',
    email: 'test@example.com',
    avatarUrl: '/avatars/old-avatar.webp',
  } as User;

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: '../../upload.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: pngBuffer.length,
    buffer: pngBuffer,
    stream: null,
    destination: null,
    filename: null,
    path: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvatarService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ ...mockUser }),
            save: jest.fn().mockImplementation(async (user) => user),
          },
        },
      ],
    }).compile();

    service = module.get<AvatarService>(AvatarService);
    userRepository = module.get(getRepositoryToken(User));

    jest.clearAllMocks();
    mockSharpPipeline.metadata.mockResolvedValue({
      format: 'png',
      width: 320,
      height: 240,
    });
    mockSharpPipeline.toFile.mockResolvedValue({ info: { size: 100 } });
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  it('should process, normalize, save, and replace an avatar', async () => {
    const result = await service.uploadAndSaveAvatar(mockUserId, mockFile);

    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: mockUserId },
    });
    expect(fs.mkdir).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'avatars'),
      { recursive: true },
    );
    expect(sharp).toHaveBeenCalledWith(mockFile.buffer, { failOn: 'warning' });
    expect(sharp).toHaveBeenCalledWith(mockFile.buffer);
    expect(mockSharpPipeline.resize).toHaveBeenCalledWith(200, 200, {
      fit: sharp.fit.cover,
      position: sharp.strategy.attention,
    });
    expect(mockSharpPipeline.webp).toHaveBeenCalledWith({ quality: 80 });
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarUrl: expect.stringMatching(
          /^\/avatars\/9f3e5dfa-7f65-4653-aa34-b7424af1e2b7-.*-avatar\.webp$/,
        ),
      }),
    );
    expect(fs.unlink).toHaveBeenCalledWith(
      path.join(process.cwd(), 'public', 'avatars', 'old-avatar.webp'),
    );
    expect(result).toEqual({
      message: 'Avatar uploaded successfully',
      avatarUrl: expect.stringMatching(/^\/avatars\/.*-avatar\.webp$/),
    });
  });

  it('should reject an invalid declared MIME type', async () => {
    await expect(
      service.uploadAndSaveAvatar(mockUserId, {
        ...mockFile,
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(sharp).not.toHaveBeenCalled();
  });

  it('should reject disguised non-image content', async () => {
    await expect(
      service.uploadAndSaveAvatar(mockUserId, {
        ...mockFile,
        buffer: Buffer.from('not an image'),
        size: 12,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(sharp).not.toHaveBeenCalled();
  });

  it('should reject oversized files before processing', async () => {
    await expect(
      service.uploadAndSaveAvatar(mockUserId, {
        ...mockFile,
        size: 2 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(sharp).not.toHaveBeenCalled();
  });

  it('should reject images with dimensions over the limit', async () => {
    mockSharpPipeline.metadata.mockResolvedValueOnce({
      format: 'png',
      width: 5000,
      height: 200,
    });

    await expect(
      service.uploadAndSaveAvatar(mockUserId, mockFile),
    ).rejects.toThrow(BadRequestException);

    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('should throw NotFoundException if user is missing', async () => {
    userRepository.findOne.mockResolvedValueOnce(null);

    await expect(
      service.uploadAndSaveAvatar(mockUserId, mockFile),
    ).rejects.toThrow(NotFoundException);

    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(mockSharpPipeline.toFile).not.toHaveBeenCalled();
  });

  it('should return default avatar URL', () => {
    expect(service.getDefaultAvatarUrl()).toBe('/avatars/default-avatar.png');
  });
});
