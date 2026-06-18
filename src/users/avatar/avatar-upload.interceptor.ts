import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

export const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;

export function AvatarUploadInterceptor(
  fieldName = 'file',
): Type<NestInterceptor> {
  const Interceptor = FileInterceptor(fieldName, {
    storage: memoryStorage(),
    limits: {
      fileSize: MAX_AVATAR_FILE_SIZE,
      files: 1,
      fields: 0,
    },
  });

  @Injectable()
  class AvatarUploadMixinInterceptor
    extends Interceptor
    implements NestInterceptor
  {
    async intercept(context: ExecutionContext, next: CallHandler) {
      try {
        return await super.intercept(context, next);
      } catch (error) {
        const code = (error as { code?: string }).code;
        const status =
          error instanceof HttpException ? error.getStatus() : undefined;
        if (code === 'LIMIT_FILE_SIZE' || status === 413) {
          throw new BadRequestException({
            code: 'AVATAR_FILE_TOO_LARGE',
            message: 'Avatar file must be 2MB or smaller',
          });
        }
        if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_FIELD_COUNT') {
          throw new BadRequestException({
            code: 'AVATAR_UPLOAD_LIMIT_EXCEEDED',
            message: 'Upload only one avatar file',
          });
        }
        throw error;
      }
    }
  }

  return AvatarUploadMixinInterceptor;
}
