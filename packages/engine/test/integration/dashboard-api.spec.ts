import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { FindingsController } from '../../src/dashboard/findings.controller';
import { HealthController } from '../../src/dashboard/health.controller';
import { MetricsController } from '../../src/dashboard/metrics.controller';
import { RulesController } from '../../src/dashboard/rules.controller';
import { StatsController } from '../../src/dashboard/stats.controller';
import { DEVOXGUARD_CONFIG } from '../../src/devoxguard-config';
import { DEVOXGUARD_AUTH_RATE_LIMITER, InternalApiKeyGuard } from '../../src/guard/internal-api-key.guard';
import { TokenBucket } from '../../src/guard/rate-limiter/token-bucket';
import { AnomalyScoreTrendTracker } from '../../src/anomaly/anomaly-score-trend.tracker';
import { RuleRegistry } from '../../src/rules/rule-registry';
import { CompiledRule } from '../../src/rules/rule.types';
import { ElasticsearchFindingIndexer } from '../../src/storage/elasticsearch.indexer';
import { MongoFindingRepository, StoredFinding } from '../../src/storage/mongo.repository';
import { ELASTICSEARCH_INDEXER } from '../../src/storage/tokens';

const API_KEY = 'test-api-key';

function sampleFinding(overrides: Partial<StoredFinding> = {}): StoredFinding {
  return {
    id: 'f-1',
    requestId: 'req-1',
    type: 'idor',
    severity: 'high',
    route: '/orders/:id',
    method: 'GET',
    userId: 'user-1',
    detail: 'test finding',
    actionTaken: 'blocked',
    timestamp: Date.now(),
    ...overrides,
  };
}

function sampleRule(): CompiledRule {
  return {
    nom: 'idor-orders',
    route: '/orders/:id',
    methode: 'GET',
    conditionAst: { kind: 'exists', path: { kind: 'path', segments: ['body', 'role'] } },
    action: 'bloquer',
    severite: 'high',
    raw: 'params.id not in user.ownedResourceIds.orders',
  };
}

describe('DevoxGuard internal dashboard API (e2e)', () => {
  let app: INestApplication;
  let repository: jest.Mocked<
    Pick<MongoFindingRepository, 'findPage' | 'findById' | 'countBlockedSince' | 'topRulesTriggered' | 'ping'>
  >;
  let indexer: jest.Mocked<Pick<ElasticsearchFindingIndexer, 'ping'>>;

  beforeEach(async () => {
    repository = {
      findPage: jest.fn(),
      findById: jest.fn(),
      countBlockedSince: jest.fn(),
      topRulesTriggered: jest.fn(),
      ping: jest.fn().mockResolvedValue(true),
    };
    indexer = { ping: jest.fn().mockResolvedValue(true) };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [FindingsController, RulesController, StatsController, HealthController, MetricsController],
      providers: [
        { provide: DEVOXGUARD_CONFIG, useValue: { apiKey: API_KEY } },
        { provide: DEVOXGUARD_AUTH_RATE_LIMITER, useValue: new TokenBucket(10, 0.2) },
        InternalApiKeyGuard,
        { provide: MongoFindingRepository, useValue: repository },
        { provide: ELASTICSEARCH_INDEXER, useValue: indexer },
        { provide: RuleRegistry, useValue: new RuleRegistry([sampleRule()]) },
        { provide: AnomalyScoreTrendTracker, useValue: new AnomalyScoreTrendTracker() },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects requests missing the API key with 401', async () => {
    await request(app.getHttpServer()).get('/devoxguard/api/rules').expect(401);
  });

  it('rejects requests with a wrong API key with 401', async () => {
    await request(app.getHttpServer())
      .get('/devoxguard/api/rules')
      .set('x-devoxguard-api-key', 'wrong-key')
      .expect(401);
  });

  it('GET /devoxguard/api/findings paginates and forwards filters to the repository', async () => {
    const findings = [sampleFinding()];
    repository.findPage.mockResolvedValue({ items: findings, total: 1, page: 1, pageSize: 20 });

    const res = await request(app.getHttpServer())
      .get('/devoxguard/api/findings?type=idor&severity=high&page=1&pageSize=20')
      .set('x-devoxguard-api-key', API_KEY)
      .expect(200);

    expect(repository.findPage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'idor', severity: 'high', page: 1, pageSize: 20 }),
    );
    expect(res.body).toEqual({ items: findings, total: 1, page: 1, pageSize: 20 });
  });

  it('GET /devoxguard/api/findings/:id returns the full finding detail', async () => {
    const finding = sampleFinding({
      id: 'f-42',
      requestContext: {
        requestId: 'req-1',
        timestamp: Date.now(),
        route: '/orders/:id',
        method: 'GET',
        params: { id: '99' },
        query: {},
        body: null,
        headers: {},
        authenticatedUser: { id: 'user-1' },
        originIp: '10.0.0.1',
      },
    });
    repository.findById.mockResolvedValue(finding);

    const res = await request(app.getHttpServer())
      .get('/devoxguard/api/findings/f-42')
      .set('x-devoxguard-api-key', API_KEY)
      .expect(200);

    expect(res.body.requestContext).toBeDefined();
  });

  it('GET /devoxguard/api/findings/:id returns 404 for an unknown id', async () => {
    repository.findById.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/devoxguard/api/findings/does-not-exist')
      .set('x-devoxguard-api-key', API_KEY)
      .expect(404);
  });

  it('GET /devoxguard/api/rules reflects the currently loaded rules, including raw', async () => {
    const res = await request(app.getHttpServer())
      .get('/devoxguard/api/rules')
      .set('x-devoxguard-api-key', API_KEY)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ nom: 'idor-orders', raw: 'params.id not in user.ownedResourceIds.orders' });
  });

  it('GET /devoxguard/api/stats/overview returns the documented shape', async () => {
    repository.countBlockedSince.mockResolvedValue(3);
    repository.topRulesTriggered.mockResolvedValue([{ ruleName: 'idor-orders', count: 3 }]);

    const res = await request(app.getHttpServer())
      .get('/devoxguard/api/stats/overview')
      .set('x-devoxguard-api-key', API_KEY)
      .expect(200);

    expect(res.body).toEqual({
      blockedLast24h: 3,
      topRulesTriggered: [{ ruleName: 'idor-orders', count: 3 }],
      averageAnomalyScoreTrend: [],
    });
  });

  it('GET /devoxguard/health requires no API key and reports ok when both stores are reachable', async () => {
    const res = await request(app.getHttpServer()).get('/devoxguard/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', checks: { mongo: true, elasticsearch: true } });
  });

  it('GET /devoxguard/health is fail-open on Elasticsearch: still 200 when only ES is down', async () => {
    indexer.ping.mockResolvedValue(false);

    const res = await request(app.getHttpServer()).get('/devoxguard/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', checks: { mongo: true, elasticsearch: false } });
  });

  it('GET /devoxguard/health is fail-closed on Mongo: 503 when Mongo is unreachable', async () => {
    repository.ping.mockResolvedValue(false);

    const res = await request(app.getHttpServer()).get('/devoxguard/health').expect(503);

    expect(res.body).toMatchObject({ checks: { mongo: false } });
  });

  it('GET /devoxguard/metrics rejects requests without an API key with 401', async () => {
    await request(app.getHttpServer()).get('/devoxguard/metrics').expect(401);
  });

  it('GET /devoxguard/metrics returns Prometheus text format including default Node process metrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/devoxguard/metrics')
      .set('x-devoxguard-api-key', API_KEY)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/plain/);
    // collectDefaultMetrics() wiring — proves the real DI graph exposes
    // it end-to-end, not just that the controller in isolation returns text.
    expect(res.text).toMatch(/process_cpu_user_seconds_total/);
  });
});
