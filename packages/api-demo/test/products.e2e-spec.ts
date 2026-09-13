import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProductsModule } from '../src/products/products.module';

// Characterizes the SQL-injection flaw in isolation — the raw ProductsModule
// with no DevoxGuard protection layered on. Uses in-process SQLite (sql.js),
// so unlike the Mongo-backed suites this needs no Docker and always runs. The
// companion injection-blocked.e2e-spec.ts proves the protected app rejects the
// same payloads.
describe('SQL injection — unprotected /products/search (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ProductsModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('benign search matches products by name', async () => {
    const res = await request(app.getHttpServer())
      .get('/products/search')
      .query({ q: 'Keyboard' })
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: 'Wireless Keyboard' });
  });

  it("' OR '1'='1 returns every product (injection succeeds unprotected)", async () => {
    const res = await request(app.getHttpServer())
      .get('/products/search')
      .query({ q: "' OR '1'='1" })
      .expect(200);

    // A legitimate LIKE match on that literal term would return nothing;
    // the tautology dumps the whole table.
    expect(res.body.length).toBe(5);
  });

  it('UNION SELECT exfiltrates the internal-only column', async () => {
    const res = await request(app.getHttpServer())
      .get('/products/search')
      .query({
        q: "zzz' UNION SELECT id, internalNote, category, price FROM products --",
      })
      .expect(200);

    // internalNote is never in the legitimate projection, but the UNION
    // surfaces it in the `name` position.
    const leaked = res.body.map((row: { name: string }) => row.name).join(' ');
    expect(leaked).toContain('margin');
  });
});
