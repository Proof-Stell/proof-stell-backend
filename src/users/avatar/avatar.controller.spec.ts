import { HttpException } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';

describe('AvatarController', () => {
  let controller: AvatarController;
  let avatarService: jest.Mocked<AvatarService>;

  const mockUserId = '9f3e5dfa-7f65-4653-aa34-b7424af1e2b7';
  const mockFile = {
    originalname: 'avatar.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('image'),
  } as Express.Multer.File;

  beforeEach(() => {
    avatarService = {
      uploadAndSaveAvatar: jest.fn().mockResolvedValue({
        message: 'Avatar uploaded successfully',
        avatarUrl: `/avatars/${mockUserId}-avatar.webp`,
      }),
    } as unknown as jest.Mocked<AvatarService>;

    controller = new AvatarController(avatarService);
  });

  it('delegates uploads to AvatarService', async () => {
    await expect(
      controller.uploadAvatar(mockFile, {
        user: { id: mockUserId },
      } as any),
    ).resolves.toEqual({
      message: 'Avatar uploaded successfully',
      avatarUrl: `/avatars/${mockUserId}-avatar.webp`,
    });

    expect(avatarService.uploadAndSaveAvatar).toHaveBeenCalledWith(
      mockUserId,
      mockFile,
    );
  });

  it('rejects requests without a user id', async () => {
    await expect(
      controller.uploadAvatar(mockFile, { user: {} } as any),
    ).rejects.toThrow(HttpException);

    expect(avatarService.uploadAndSaveAvatar).not.toHaveBeenCalled();
  });
});
