import Redis from 'ioredis';
import { EwmaFrequencyAnalyzer } from '../../src/anomaly/ewma-frequency.analyzer';
import { SequenceScanDetector } from '../../src/anomaly/sequence-scan.detector';
import { OriginShiftDetector } from '../../src/anomaly/origin-shift.detector';
import { BehaviorLogEntry } from '../../src/anomaly/behavior-log.schema';

/**
 * Requires `docker compose -f docker-compose.dev.yml up -d` running
 * locally (Redis on 6379). Skips gracefully (passes trivially, logging
 * a warning) when Redis isn't reachable — same pattern as
 * storage.integration.spec.ts. Unit tests already cover this logic
 * against a mocked Redis client (see the analyzer .spec.ts files); this
 * suite exists specifically to prove the real ioredis client's method
 * signatures (hgetall/hset/expire/get/set) are actually compatible with
 * what the analyzers call, which a mock can't guarantee.
 */
const REDIS_URL = 'redis://localhost:6379';

function entry(index: number, overrides: Partial<BehaviorLogEntry> = {}): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: `redis-integration-user-${Date.now()}`,
    route: '/orders/:id',
    method: 'GET',
    timestamp: Date.now(),
    originIp: '10.0.0.1',
    ...overrides,
  };
}

async function isRedisAvailable(): Promise<boolean> {
  const client = new Redis(REDIS_URL, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

describe('Redis-backed anomaly state (integration)', () => {
  jest.setTimeout(15_000);
  let redisAvailable = false;
  let client: Redis;

  beforeAll(async () => {
    redisAvailable = await isRedisAvailable();
    if (!redisAvailable && process.env.DEVOX_REQUIRE_SERVICES === '1') {
      throw new Error('[redis-anomaly.integration.spec] DEVOX_REQUIRE_SERVICES=1 but Redis is unreachable.');
    }
    if (!redisAvailable) {
      console.warn(
        '[redis-anomaly.integration.spec] Redis not reachable on localhost — skipping. ' +
          'Run `docker compose -f docker-compose.dev.yml up -d` to exercise this test.',
      );
      return;
    }
    client = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    await client?.quit();
  });

  it('EwmaFrequencyAnalyzer shares state across two instances via a real Redis client', async () => {
    if (!redisAvailable) return;

    const first = new EwmaFrequencyAnalyzer(undefined, client);
    const second = new EwmaFrequencyAnalyzer(undefined, client);
    const userId = `redis-integration-ewma-${Date.now()}`;
    let t = 0;

    for (let i = 0; i < 20; i += 1) {
      t += 5000 + (i % 2 === 0 ? 500 : -500);
      const analyzer = i % 2 === 0 ? first : second;
      await analyzer.analyze(entry(i, { userId, timestamp: t }));
    }

    const burstFindings = [];
    for (let i = 0; i < 10; i += 1) {
      t += 111;
      burstFindings.push(...(await second.analyze(entry(20 + i, { userId, timestamp: t }))));
    }

    expect(burstFindings.length).toBeGreaterThan(0);
    expect(burstFindings[0].type).toBe('anomaly-frequency');
  });

  it('SequenceScanDetector shares state across two instances via a real Redis client', async () => {
    if (!redisAvailable) return;

    const first = new SequenceScanDetector(undefined, client);
    const second = new SequenceScanDetector(undefined, client);
    const userId = `redis-integration-seq-${Date.now()}`;
    const ids = ['1', '2', '3', '4', '5'];
    const stepMs = 3_000 / (ids.length - 1);

    const findings = [];
    for (let i = 0; i < ids.length; i += 1) {
      const detector = i % 2 === 0 ? first : second;
      findings.push(...(await detector.analyze(entry(i, { userId, requestedId: ids[i], timestamp: i * stepMs }))));
    }

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].type).toBe('anomaly-sequence');
  });

  it('OriginShiftDetector shares state across two instances via a real Redis client', async () => {
    if (!redisAvailable) return;

    const first = new OriginShiftDetector(undefined, client);
    const second = new OriginShiftDetector(undefined, client);
    const userId = `redis-integration-origin-${Date.now()}`;

    await first.analyze(entry(0, { userId, originIp: '10.0.0.1', timestamp: 0 }));
    await first.analyze(entry(1, { userId, originIp: '203.0.113.7', timestamp: 5_000 }));
    const findings = await second.analyze(entry(2, { userId, originIp: '10.0.0.1', timestamp: 15_000 }));

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('anomaly-origin');
  });
});
