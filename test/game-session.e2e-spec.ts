import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('GameSession (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let accessToken1: string;
  let userId1: string;
  let accessToken2: string;
  let userId2: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    // Register User 1
    const res1 = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `user1-${Date.now()}@example.com`,
        username: `user1-${Date.now()}`,
        password: 'TestPass123!',
      });
    userId1 = res1.body.user ? res1.body.user.id : res1.body.id;

    const loginRes1 = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: res1.body.user?.email || `user1-${Date.now()}@example.com`,
        password: 'TestPass123!',
      });
    accessToken1 = loginRes1.body.accessToken || loginRes1.body.access_token;

    // Register User 2
    const res2 = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `user2-${Date.now()}@example.com`,
        username: `user2-${Date.now()}`,
        password: 'TestPass123!',
      });
    userId2 = res2.body.user ? res2.body.user.id : res2.body.id;

    const loginRes2 = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: res2.body.user?.email || `user2-${Date.now()}@example.com`,
        password: 'TestPass123!',
      });
    accessToken2 = loginRes2.body.accessToken || loginRes2.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('IDOR Prevention', () => {
    it('should not allow user2 to fetch user1 sessions', async () => {
      // Trying to fetch user1's sessions with user2's token
      const res = await request(server)
        .get(`/session/user/${userId1}`)
        .set('Authorization', `Bearer ${accessToken2}`)
        .expect(403);

      expect(res.body.message).toMatch(/own sessions/i);
    });

    it('should allow user1 to fetch their own sessions', async () => {
      await request(server)
        .get(`/session/user/${userId1}`)
        .set('Authorization', `Bearer ${accessToken1}`)
        .expect(200);
    });
  });

  describe('Route Shadowing', () => {
    it('should properly route to analytics summary without 404', async () => {
      // If it's shadowed by /:sessionId, it would throw NotFound or error
      const res = await request(server)
        .get('/session/analytics/summary')
        .set('Authorization', `Bearer ${accessToken1}`)
        .expect(200);

      expect(res.body).toBeDefined();
    });
  });

  // Note: testing HMAC fully might require a valid challenge ID in the DB.
});
