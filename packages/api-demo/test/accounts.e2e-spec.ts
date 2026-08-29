import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { App } from 'supertest/types';
import { AccountsModule } from '../src/accounts/accounts.module';

// Characterizes the NoSQL operator-injection flaw in isolation — the raw
// AccountsModule with no DevoxGuard protection. Needs a live MongoDB (the
// module connects and seeds on boot), so it self-skips unless Mongo is
// reachable, matching cors.e2e-spec.ts. CI sets DEVOX_REQUIRE_SERVICES=1 to
// turn a skip into a failure.
const MONGO_URI = 'mongodb://localhost:27017';

async function isMongoAvailable(): Promise<boolean> {
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 1500,
    });
    await client.connect();
    await client.db('api-demo').command({ ping: 1 });
    await client.close();
    return true;
  } catch {
    return false;
  }
}

describe('NoSQL injection — unprotected /account/login (e2e)', () => {
  jest.setTimeout(15_000);
  let app: INestApplication<App> | undefined;
  let mongoAvailable = false;

  beforeAll(async () => {
    mongoAvailable = await isMongoAvailable();
    if (!mongoAvailable && process.env.DEVOX_REQUIRE_SERVICES === '1') {
      throw new Error(
        '[accounts.e2e-spec] DEVOX_REQUIRE_SERVICES=1 but MongoDB is unreachable.',
      );
    }
    if (!mongoAvailable) {
      console.warn(
        '[accounts.e2e-spec] MongoDB not reachable on localhost — skipping. ' +
          'Run `docker compose -f docker-compose.dev.yml up -d` to exercise this test.',
      );
      return;
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AccountsModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('authenticates with correct credentials', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .post('/account/login')
      .send({ email: 'admin@corp.test', password: 'sup3r-s3cret' })
      .expect(201);

    expect(res.body).toMatchObject({ authenticated: true, role: 'admin' });
  });

  it('rejects a wrong password', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .post('/account/login')
      .send({ email: 'admin@corp.test', password: 'guess' })
      .expect(201);

    expect(res.body).toMatchObject({ authenticated: false });
  });

  it('operator injection bypasses the password check and leaks the apiToken (unprotected)', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .post('/account/login')
      .send({ email: 'admin@corp.test', password: { $ne: '' } })
      .expect(201);

    expect(res.body).toMatchObject({ authenticated: true, role: 'admin' });
    expect(res.body.apiToken).toBe('tok_admin_88de');
  });
});
