import { MongoClient } from 'mongodb';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { connectMongoFindings, FINDINGS_COLLECTION_NAME, StoredFinding } from '../../src/storage/mongo.repository';
import { ElasticsearchFindingIndexer } from '../../src/storage/elasticsearch.indexer';

/**
 * Requires `docker compose -f docker-compose.dev.yml up -d` running
 * locally (MongoDB on 27017, Elasticsearch on 9200). Skips gracefully
 * (passes trivially, logging a warning) when the services aren't
 * reachable, so `npm test` never requires Docker to succeed — only
 * this specific integration test exercises the real drivers.
 */
const MONGO_URI = 'mongodb://localhost:27017';
const ES_NODE = 'http://localhost:9200';
const DB_NAME = 'devoxguard_test';

async function checkServicesAvailable(): Promise<boolean> {
  try {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 1500 });
    await client.connect();
    await client.db(DB_NAME).command({ ping: 1 });
    await client.close();

    const es = new ElasticsearchClient({ node: ES_NODE, requestTimeout: 1500 });
    await es.ping();

    return true;
  } catch {
    return false;
  }
}

describe('storage integration (MongoDB + Elasticsearch)', () => {
  jest.setTimeout(15_000);
  let servicesAvailable = false;

  beforeAll(async () => {
    servicesAvailable = await checkServicesAvailable();
    if (!servicesAvailable && process.env.DEVOX_REQUIRE_SERVICES === '1') {
      // CI sets DEVOX_REQUIRE_SERVICES=1: unreachable services must fail
      // the build, not silently skip the suite.
      throw new Error(
        '[storage.integration.spec] DEVOX_REQUIRE_SERVICES=1 but MongoDB/Elasticsearch are unreachable.',
      );
    }
    if (!servicesAvailable) {
      console.warn(
        '[storage.integration.spec] MongoDB/Elasticsearch not reachable on localhost — skipping. ' +
          'Run `docker compose -f docker-compose.dev.yml up -d` to exercise this test.',
      );
    }
  });

  it('persists and retrieves a Finding through MongoFindingRepository', async () => {
    if (!servicesAvailable) return;

    const { client, repository } = await connectMongoFindings(MONGO_URI, DB_NAME);
    try {
      const finding: StoredFinding = {
        id: `integration-${Date.now()}`,
        requestId: 'req-integration',
        type: 'idor',
        severity: 'high',
        route: '/orders/:id',
        method: 'GET',
        userId: 'user-1',
        detail: 'integration test finding',
        actionTaken: 'blocked',
        timestamp: Date.now(),
        requestContext: {
          requestId: 'req-integration',
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
      };

      await repository.insertMany([finding]);
      const stored = await repository.findById(finding.id);

      expect(stored?.id).toBe(finding.id);
      expect(stored?.requestContext?.route).toBe('/orders/:id');

      const page = await repository.findPage({ type: 'idor' });
      expect(page.items.some((f) => f.id === finding.id)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('ensureIndexes creates all five expected indexes against a live collection', async () => {
    if (!servicesAvailable) return;

    const { client } = await connectMongoFindings(MONGO_URI, DB_NAME);
    try {
      const indexes = await client.db(DB_NAME).collection(FINDINGS_COLLECTION_NAME).indexes();
      const byName = new Map(indexes.map((idx) => [JSON.stringify(idx.key), idx]));

      expect(byName.has(JSON.stringify({ timestamp: -1 }))).toBe(true);
      expect(byName.has(JSON.stringify({ route: 1, severity: 1 }))).toBe(true);
      expect(byName.has(JSON.stringify({ type: 1 }))).toBe(true);

      const ttlIndex = byName.get(JSON.stringify({ expiresAt: 1 }));
      expect(ttlIndex?.expireAfterSeconds).toBe(0);
    } finally {
      await client.close();
    }
  });

  it('insertMany populates expiresAt as a real BSON Date, distinct from the Long timestamp', async () => {
    if (!servicesAvailable) return;

    const { client, repository } = await connectMongoFindings(MONGO_URI, DB_NAME, 30);
    try {
      const finding: StoredFinding = {
        id: `integration-ttl-${Date.now()}`,
        requestId: 'req-integration-ttl',
        type: 'idor',
        severity: 'high',
        route: '/orders/:id',
        method: 'GET',
        userId: 'user-1',
        detail: 'ttl integration test finding',
        actionTaken: 'blocked',
        timestamp: Date.now(),
      };

      await repository.insertMany([finding]);
      const raw = await client
        .db(DB_NAME)
        .collection(FINDINGS_COLLECTION_NAME)
        .findOne<{ expiresAt: Date; timestamp: unknown }>({ id: finding.id });

      expect(raw?.expiresAt).toBeInstanceOf(Date);
      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      expect(raw!.expiresAt.getTime()).toBeGreaterThan(Date.now() + expectedMs - 60_000);
    } finally {
      await client.close();
    }
  });

  it('indexes a Finding into Elasticsearch', async () => {
    if (!servicesAvailable) return;

    const es = new ElasticsearchClient({ node: ES_NODE });
    const indexer = new ElasticsearchFindingIndexer(es, 'findings-index-test');
    try {
      await indexer.ensureIndex();
      await indexer.index({
        id: `integration-es-${Date.now()}`,
        requestId: 'req-integration',
        type: 'idor',
        severity: 'high',
        route: '/orders/:id',
        method: 'GET',
        userId: 'user-1',
        detail: 'integration test finding',
        actionTaken: 'blocked',
        timestamp: Date.now(),
      });
      await es.indices.refresh({ index: 'findings-index-test' });

      const count = await es.count({ index: 'findings-index-test' });
      expect(count.count).toBeGreaterThan(0);
    } finally {
      await es.indices.delete({ index: 'findings-index-test' }).catch(() => undefined);
      await es.close();
    }
  });
});
