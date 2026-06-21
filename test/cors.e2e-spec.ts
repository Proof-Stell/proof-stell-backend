import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import * as request from 'supertest';
import { TypedConfigService } from '../src/common/config/typed-config.service';

describe('CORS and security headers (e2e)', () => {
  describe('with CORS enabled', () => {
    let app: INestApplication;
    let server: any;

    beforeAll(async () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://example.com';
      process.env.CORS_ENABLED = 'true';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');

      const configService = app.get(TypedConfigService);
      const allowedOrigins = configService.allowedOrigins
        ? configService.allowedOrigins
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : ['http://localhost:3000'];

      if (configService.corsEnabled) {
        app.enableCors({
          origin: allowedOrigins,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
          credentials: true,
        });
      }

      await app.init();
      server = app.getHttpAdapter().getInstance();
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.ALLOWED_ORIGINS;
      delete process.env.CORS_ENABLED;
    });

    describe('CORS - accepted origins', () => {
      it('allows request from a configured origin', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .expect(HttpStatus.OK);

        expect(res.headers['access-control-allow-origin']).toBe(
          'http://localhost:3000',
        );
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      });

      it('allows request from a second configured origin', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'https://example.com')
          .expect(HttpStatus.OK);

        expect(res.headers['access-control-allow-origin']).toBe(
          'https://example.com',
        );
      });

      it('handles OPTIONS preflight requests from configured origin', async () => {
        const res = await request(server)
          .options('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .set('Access-Control-Request-Method', 'GET')
          .expect(HttpStatus.OK);

        expect(res.headers['access-control-allow-origin']).toBe(
          'http://localhost:3000',
        );
      });
    });

    describe('CORS - rejected origins', () => {
      it('does not echo back unconfigured origin', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'https://evil.com')
          .expect(HttpStatus.OK);

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });

      it('does not echo back wildcard origin', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://attacker.example')
          .expect(HttpStatus.OK);

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      });
    });

    describe('security headers', () => {
      it('sets X-Content-Type-Options to nosniff', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .expect(HttpStatus.OK);

        expect(res.headers['x-content-type-options']).toBe('nosniff');
      });

      it('sets X-Frame-Options to DENY', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .expect(HttpStatus.OK);

        expect(res.headers['x-frame-options']).toBe('DENY');
      });

      it('sets Content-Security-Policy header', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .expect(HttpStatus.OK);

        expect(res.headers['content-security-policy']).toBeTruthy();
        expect(res.headers['content-security-policy']).toContain(
          "default-src 'self'",
        );
      });

      it('sets Referrer-Policy header', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .expect(HttpStatus.OK);

        expect(res.headers['referrer-policy']).toBe(
          'strict-origin-when-cross-origin',
        );
      });

      it('strips X-Powered-By header', async () => {
        const res = await request(server)
          .get('/api/v1')
          .set('Origin', 'http://localhost:3000')
          .expect(HttpStatus.OK);

        expect(res.headers['x-powered-by']).toBeUndefined();
      });
    });
  });

  describe('with CORS disabled', () => {
    let app: INestApplication;
    let server: any;

    beforeAll(async () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
      process.env.CORS_ENABLED = 'false';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');

      const configService = app.get(TypedConfigService);

      if (configService.corsEnabled) {
        const allowedOrigins = configService.allowedOrigins
          ? configService.allowedOrigins
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : ['http://localhost:3000'];
        app.enableCors({
          origin: allowedOrigins,
          methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
          credentials: true,
        });
      }

      await app.init();
      server = app.getHttpAdapter().getInstance();
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.ALLOWED_ORIGINS;
      delete process.env.CORS_ENABLED;
    });

    it('does not set Access-Control-Allow-Origin header for any origin', async () => {
      const res = await request(server)
        .get('/api/v1')
        .set('Origin', 'http://localhost:3000')
        .expect(HttpStatus.OK);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('security headers are still applied even when CORS is disabled', async () => {
      const res = await request(server).get('/api/v1').expect(HttpStatus.OK);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
