import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { NextFunction, Request, Response } from 'express';
import { OrdersModule } from '../src/orders/orders.module';
import { UsersModule } from '../src/users/users.module';
import { ReviewsModule } from '../src/reviews/reviews.module';
import { FakeAuthMiddleware } from '../src/auth/fake-auth.middleware';

// Deliberately imports the raw feature modules, not AppModule: AppModule
// now wires in DevoxGuardModule (requires a live MongoDB connection at
// startup and actively blocks these same requests once protected). This
// suite exists to characterize the app's flaws in isolation, independent
// of whatever protection is layered on top — see
// test/cors.e2e-spec.ts for a Docker-gated test against the full,
// protected app.
describe('api-demo vulnerable endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [OrdersModule, UsersModule, ReviewsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const authMiddleware = new FakeAuthMiddleware();
    app.use((req: Request, res: Response, next: NextFunction) => authMiddleware.use(req, res, next));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('IDOR: user 2 can read order 1, which belongs to user 1', async () => {
    // Order 1 belongs to user 1 (seed-data.ts); user 2 has no ownership
    // relationship to it, yet the unprotected endpoint returns it anyway.
    const res = await request(app.getHttpServer())
      .get('/orders/1')
      .set('Authorization', 'Bearer 2')
      .expect(200);

    expect(res.body).toMatchObject({ id: '1', userId: '1' });
  });

  it('mass assignment: PATCH /users/:id lets the caller set role and isAdmin', async () => {
    const res = await request(app.getHttpServer())
      .patch('/users/1')
      .set('Authorization', 'Bearer 1')
      .send({ role: 'admin', isAdmin: true })
      .expect(200);

    expect(res.body).toMatchObject({ role: 'admin', isAdmin: true });
  });

  it('excessive exposure: GET /users/:id/profile leaks passwordHash', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/1/profile')
      .set('Authorization', 'Bearer 1')
      .expect(200);

    expect(res.body).toHaveProperty('passwordHash');
  });
});
