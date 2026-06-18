import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AvatarService } from './avatar.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { AvatarUploadInterceptor } from './avatar-upload.interceptor';

@UseGuards(JwtAuthGuard)
@Controller('avatars')
export class AvatarController {
  constructor(private readonly avatarService: AvatarService) {}

  @Post('upload')
  @UseInterceptors(AvatarUploadInterceptor())
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const userId = req.user['id'];
    if (!userId) {
      throw new HttpException(
        'User ID not found in token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.avatarService.uploadAndSaveAvatar(userId, file);
  }
}
