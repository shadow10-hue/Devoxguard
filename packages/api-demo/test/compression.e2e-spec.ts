import { INestApplication } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { App } from 'supertest/types';
import { createApp } from '../src/main';

/**
 * Requires `docker compose -f docker-compose.dev.yml up -d` (AppModule
 * wires in DevoxGuardModule, which needs a live MongoDB connection at
 * startup). Skips gracefully (passes, logs a warning) when Mongo isn't
 * reachable, so `npm run test:e2e` never requires Docker to succeed —
 * same pattern as test/cors.e2e-spec.ts.
 */
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

describe('Response compression (e2e)', () => {
  jest.setTimeout(15_000);
  let app: INestApplication<App> | undefined;
  let mongoAvailable = false;

  beforeAll(async () => {
    mongoAvailable = await isMongoAvailable();
    if (!mongoAvailable && process.env.DEVOX_REQUIRE_SERVICES === '1') {
      throw new Error(
        '[compression.e2e-spec] DEVOX_REQUIRE_SERVICES=1 but MongoDB is unreachable.',
      );
    }
    if (!mongoAvailable) {
      console.warn(
        '[compression.e2e-spec] MongoDB not reachable on localhost — skipping. ' +
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

  it('gzip-compresses a JSON response when the client accepts it, without weakening Cache-Control', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .get('/orders/1')
      .set('Authorization', 'Bearer 1')
      .set('Accept-Encoding', 'gzip');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
