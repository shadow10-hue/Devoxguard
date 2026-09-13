import { INestApplication } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { App } from 'supertest/types';
import { createApp } from '../src/main';

// The end-to-end proof: the fully protected app (createApp wires in
// DevoxGuard) rejects the very SQLi and NoSQLi payloads that
// products.e2e-spec.ts / accounts.e2e-spec.ts show are exploitable when the
// engine is absent — while letting benign traffic through. Needs a live
// MongoDB (DevoxGuard + AccountsModule both connect at boot); self-skips
// unless reachable, fails hard under DEVOX_REQUIRE_SERVICES=1 (CI).
const MONGO_URI = 'mongodb://localhost:27017';

async function isMongoAvailable(): Promise<boolean> {
  try {
    const client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 1500,
    });
    await client.connect();
    await client.db('devoxguard').command({ ping: 1 });
    await client.close();
    return true;
  } catch {
    return false;
  }
}

describe('DevoxGuard blocks injection end-to-end (e2e)', () => {
  jest.setTimeout(20_000);
  let app: INestApplication<App> | undefined;
  let mongoAvailable = false;

  beforeAll(async () => {
    mongoAvailable = await isMongoAvailable();
    if (!mongoAvailable && process.env.DEVOX_REQUIRE_SERVICES === '1') {
      throw new Error(
        '[injection-blocked.e2e-spec] DEVOX_REQUIRE_SERVICES=1 but MongoDB is unreachable.',
      );
    }
    if (!mongoAvailable) {
      console.warn(
        '[injection-blocked.e2e-spec] MongoDB not reachable on localhost — skipping. ' +
          'Run `docker compose -f docker-compose.dev.yml up -d` to exercise this test.',
      );
      return;
    }
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('blocks a SQL-injection query with 403', async () => {
    if (!mongoAvailable || !app) return;

    await request(app.getHttpServer())
      .get('/products/search')
      .query({ q: "' OR '1'='1" })
      .expect(403);
  });

  it('allows a benign product search with 200', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .get('/products/search')
      .query({ q: 'Keyboard' })
      .expect(200);

    expect(res.body).toHaveLength(1);
  });

  it('blocks a NoSQL operator-injection login with 403', async () => {
    if (!mongoAvailable || !app) return;

    await request(app.getHttpServer())
      .post('/account/login')
      .send({ email: 'admin@corp.test', password: { $ne: '' } })
      .expect(403);
  });

  it('allows a benign login with 200/201', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .post('/account/login')
      .send({ email: 'alice@corp.test', password: 'correct-horse' });

    expect(res.status).toBeLessThan(300);
    expect(res.body).toMatchObject({
      authenticated: true,
      email: 'alice@corp.test',
    });
  });
});
