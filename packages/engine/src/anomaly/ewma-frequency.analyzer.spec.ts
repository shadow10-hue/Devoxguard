import { EwmaFrequencyAnalyzer } from './ewma-frequency.analyzer';
import { AnomalyRedisClient } from './anomaly-redis-client';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

function entry(index: number, timestamp: number, overrides: Partial<BehaviorLogEntry> = {}): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: 'user-1',
    route: '/orders/:id',
    method: 'GET',
    timestamp,
    originIp: '10.0.0.1',
    ...overrides,
  };
}

/** In-memory stand-in for ioredis, matching the structural subset AnomalyRedisClient needs — lets tests exercise the Redis code path without a real Redis instance. */
function fakeRedis(): jest.Mocked<AnomalyRedisClient> {
  const hashes = new Map<string, Record<string, string>>();
  const strings = new Map<string, string>();
  return {
    hgetall: jest.fn(async (key: string) => hashes.get(key) ?? {}),
    hset: jest.fn(async (key: string, data: Record<string, string | number>) => {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) normalized[k] = String(v);
      hashes.set(key, normalized);
      return 1;
    }),
    expire: jest.fn(async (_key: string, _seconds: number) => 1),
    get: jest.fn(async (key: string) => strings.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return 'OK';
    }),
  };
}

describe('EwmaFrequencyAnalyzer', () => {
  it('case 1: regular traffic (20 requests, ~5s +/- 0.5s apart) emits no findings', async () => {
    const analyzer = new EwmaFrequencyAnalyzer();
    let t = 0;
    let findings: Finding[] = [];

    for (let i = 0; i < 20; i += 1) {
      t += 5000 + (i % 2 === 0 ? 500 : -500);
      findings = findings.concat(await analyzer.analyze(entry(i, t)));
    }

    expect(findings).toHaveLength(0);
  });

  it('case 2: a sudden burst after regular traffic emits an anomaly-frequency finding', async () => {
    const analyzer = new EwmaFrequencyAnalyzer();
    let t = 0;
    const allFindings: Finding[] = [];

    for (let i = 0; i < 20; i += 1) {
      t += 5000 + (i % 2 === 0 ? 500 : -500);
      allFindings.push(...(await analyzer.analyze(entry(i, t))));
    }
    expect(allFindings).toHaveLength(0);

    // 10 requests crammed into ~1s right after 20 requests at ~5s intervals.
    for (let i = 0; i < 10; i += 1) {
      t += 111;
      allFindings.push(...(await analyzer.analyze(entry(20 + i, t))));
    }

    expect(allFindings.length).toBeGreaterThan(0);
    expect(allFindings[0].type).toBe('anomaly-frequency');
  });

  it('case 3: a single request for a new user has no history to compare against, so no finding', async () => {
    const analyzer = new EwmaFrequencyAnalyzer();
    const findings = await analyzer.analyze(entry(0, Date.now()));
    expect(findings).toHaveLength(0);
  });

  describe('with a Redis client configured', () => {
    it('produces the same result as the in-memory path for the same sequence of requests', async () => {
      const memoryAnalyzer = new EwmaFrequencyAnalyzer();
      const redisAnalyzer = new EwmaFrequencyAnalyzer(undefined, fakeRedis());
      let t = 0;
      const memoryFindings: Finding[] = [];
      const redisFindings: Finding[] = [];

      for (let i = 0; i < 20; i += 1) {
        t += 5000 + (i % 2 === 0 ? 500 : -500);
        memoryFindings.push(...(await memoryAnalyzer.analyze(entry(i, t))));
        redisFindings.push(...(await redisAnalyzer.analyze(entry(i, t))));
      }
      for (let i = 0; i < 10; i += 1) {
        t += 111;
        memoryFindings.push(...(await memoryAnalyzer.analyze(entry(20 + i, t))));
        redisFindings.push(...(await redisAnalyzer.analyze(entry(20 + i, t))));
      }

      expect(redisFindings.map((f) => f.type)).toEqual(memoryFindings.map((f) => f.type));
      expect(redisFindings.length).toBeGreaterThan(0);
    });

    it('shares state across two analyzer instances pointed at the same Redis client', async () => {
      const redis = fakeRedis();
      const first = new EwmaFrequencyAnalyzer(undefined, redis);
      const second = new EwmaFrequencyAnalyzer(undefined, redis);
      let t = 0;

      // Warm up the model on `first`, alternating instances thereafter —
      // if state weren't shared via Redis, `second` would see every
      // request as a fresh key and never accumulate enough history to
      // flag the burst below.
      for (let i = 0; i < 20; i += 1) {
        t += 5000 + (i % 2 === 0 ? 500 : -500);
        const analyzer = i % 2 === 0 ? first : second;
        await analyzer.analyze(entry(i, t));
      }

      const burstFindings: Finding[] = [];
      for (let i = 0; i < 10; i += 1) {
        t += 111;
        burstFindings.push(...(await second.analyze(entry(20 + i, t))));
      }

      expect(burstFindings.length).toBeGreaterThan(0);
      expect(burstFindings[0].type).toBe('anomaly-frequency');
    });

    it('fails open (returns no findings) instead of throwing when Redis errors', async () => {
      const redis = fakeRedis();
      redis.hgetall.mockRejectedValue(new Error('ECONNREFUSED'));
      const analyzer = new EwmaFrequencyAnalyzer(undefined, redis);

      await expect(analyzer.analyze(entry(0, Date.now()))).resolves.toEqual([]);
    });
  });
});
