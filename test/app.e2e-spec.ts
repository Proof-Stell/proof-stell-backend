import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as express from 'express';
import * as request from 'supertest';
import * as sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { UserController } from '../src/users/controllers/users.controller';
import { UserService } from '../src/users/providers/users.service';
import { AvatarService } from '../src/users/avatar/avatar.service';
import { User } from '../src/users/entities/user.entity';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { CacheService } from '../src/cache/cache.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LoggingService } from '../src/logging/logging.service';

describe('Avatar upload (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let user: User;
  let pngBuffer: Buffer;
  const userId = '9f3e5dfa-7f65-4653-aa34-b7424af1e2b7';
  const avatarDir = path.join(process.cwd(), 'public', 'avatars');

  beforeAll(async () => {
    pngBuffer = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: '#2f80ed',
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(async () => {
    await fs.rm(avatarDir, { recursive: true, force: true });
    await fs.mkdir(avatarDir, { recursive: true });

    user = {
      id: userId,
      email: 'avatar@example.com',
      username: 'avatar-user',
      avatarUrl: undefined,
    } as User;

    const mockLoggingService = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      log: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        AvatarService,
        {
          provide: UserService,
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(async () => user),
            save: jest.fn(async (updatedUser: User) => {
              user = { ...user, ...updatedUser } as User;
              return user;
            }),
          },
        },
        {
          provide: LoggingService,
          useValue: mockLoggingService,
        },
        {
          provide: APP_FILTER,
          useClass: HttpExceptionFilter,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: userId, role: 'player' };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use('/avatars', express.static(avatarDir));
    await app.init();
    server = app.getHttpAdapter().getInstance();
  });

  afterEach(async () => {
    await app?.close();
    await fs.rm(avatarDir, { recursive: true, force: true });
  });

  it('normalizes a valid avatar and serves it statically', async () => {
    const res = await request(server)
      .post('/api/v1/users/profile/avatar')
      .set('Authorization', 'Bearer test-token')
      .attach('file', pngBuffer, {
        filename: '../../avatar.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(res.body.avatarUrl).toMatch(/^\/avatars\/.*-avatar\.webp$/);

    const outputPath = path.join(avatarDir, path.basename(res.body.avatarUrl));
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(200);
    expect(metadata.exif).toBeUndefined();

    await request(server)
      .get(res.body.avatarUrl)
      .expect(200)
      .expect('Content-Type', /image\/webp/);
  });

  it('returns a structured BadRequestException for invalid MIME types', async () => {
    const res = await request(server)
      .post('/api/v1/users/profile/avatar')
      .set('Authorization', 'Bearer test-token')
      .attach('file', pngBuffer, {
        filename: 'avatar.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'AVATAR_INVALID_MIME_TYPE',
        message: 'Avatar file must be a JPEG, PNG, or GIF image',
      }),
    );
  });

  it('rejects files disguised as images', async () => {
    const res = await request(server)
      .post('/api/v1/users/profile/avatar')
      .set('Authorization', 'Bearer test-token')
      .attach('file', Buffer.from('not really a png'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'AVATAR_INVALID_SIGNATURE',
        message: 'Avatar file content is not a supported image',
      }),
    );
  });

  it('rejects oversized uploads with a structured BadRequestException', async () => {
    const res = await request(server)
      .post('/api/v1/users/profile/avatar')
      .set('Authorization', 'Bearer test-token')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(res.body).toEqual(
      expect.objectContaining({
        code: 'AVATAR_FILE_TOO_LARGE',
        message: 'Avatar file must be 2MB or smaller',
      }),
    );
  });

  it('deletes the previous local avatar when replacing it', async () => {
    const oldFilename = 'old-avatar.webp';
    const oldPath = path.join(avatarDir, oldFilename);
    await fs.writeFile(oldPath, Buffer.from('old avatar'));
    user.avatarUrl = `/avatars/${oldFilename}`;

    const res = await request(server)
      .post('/api/v1/users/profile/avatar')
      .set('Authorization', 'Bearer test-token')
      .attach('file', pngBuffer, {
        filename: 'replacement.png',
        contentType: 'image/png',
      })
      .expect(201);

    await expect(fs.access(oldPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await request(server).get(res.body.avatarUrl).expect(200);
  });

  describe('error response shape', () => {
    it('400 error has statusCode, timestamp, path and message fields', async () => {
      const res = await request(server)
        .post('/api/v1/users/profile/avatar')
        .set('Authorization', 'Bearer test-token')
        .attach('file', pngBuffer, {
          filename: 'avatar.pdf',
          contentType: 'application/pdf',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(typeof res.body.statusCode).toBe('number');
      expect(res.body.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(typeof res.body.message).toBeDefined();
    });
  });
});
