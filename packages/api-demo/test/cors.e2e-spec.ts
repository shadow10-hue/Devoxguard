import { INestApplication } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { App } from 'supertest/types';
import { createApp } from '../src/main';

/**
 * Regression test: the dashboard (a separate origin, e.g. localhost:5173)
 * calling the protected API (e.g. localhost:3000) was silently broken —
 * no CORS configured, so the browser's OPTIONS preflight 404'd and the
 * real request never went out. Found by actually driving the dashboard
 * against a live server in a browser, not by any mocked unit test.
 *
 * Requires `docker compose -f docker-compose.dev.yml up -d` (AppModule
 * wires in DevoxGuardModule, which needs a live MongoDB connection at
 * startup). Skips gracefully (passes, logs a warning) when Mongo isn't
 * reachable, so `npm run test:e2e` never requires Docker to succeed.
 */
const MONGO_URI = 'mongodb://localhost:27017';
const DASHBOARD_ORIGIN = 'http://localhost:5173';

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

describe('CORS (e2e)', () => {
  jest.setTimeout(15_000);
  let app: INestApplication<App> | undefined;
  let mongoAvailable = false;

  beforeAll(async () => {
    mongoAvailable = await isMongoAvailable();
    if (!mongoAvailable && process.env.DEVOX_REQUIRE_SERVICES === '1') {
      // CI sets DEVOX_REQUIRE_SERVICES=1: an unreachable MongoDB must fail
      // the build, not silently skip the suite.
      throw new Error(
        '[cors.e2e-spec] DEVOX_REQUIRE_SERVICES=1 but MongoDB is unreachable.',
      );
    }
    if (!mongoAvailable) {
      console.warn(
        '[cors.e2e-spec] MongoDB not reachable on localhost — skipping. ' +
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

  it('answers the OPTIONS preflight for a cross-origin dashboard request', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .options('/devoxguard/api/stats/overview')
      .set('Origin', DASHBOARD_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-devoxguard-api-key');

    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
  });

  it('allows the actual cross-origin request through', async () => {
    if (!mongoAvailable || !app) return;

    const res = await request(app.getHttpServer())
      .get('/devoxguard/api/rules')
      .set('Origin', DASHBOARD_ORIGIN)
      .set('x-devoxguard-api-key', 'dev-api-key');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(DASHBOARD_ORIGIN);
  });
});
