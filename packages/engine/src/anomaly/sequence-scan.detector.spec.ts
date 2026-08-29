import { SequenceScanDetector } from './sequence-scan.detector';
import { AnomalyRedisClient } from './anomaly-redis-client';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

function entry(index: number, requestedId: string, timestamp: number): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: 'user-1',
    route: '/orders/:id',
    method: 'GET',
    timestamp,
    originIp: '10.0.0.1',
    requestedId,
  };
}

async function run(detector: SequenceScanDetector, ids: string[], totalDurationMs: number): Promise<Finding[]> {
  const stepMs = ids.length > 1 ? totalDurationMs / (ids.length - 1) : 0;
  const findings: Finding[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    findings.push(...(await detector.analyze(entry(i, ids[i], i * stepMs))));
  }
  return findings;
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

describe('SequenceScanDetector', () => {
  it('case 1: ids 1,2,3,4,5 requested over 3s emits an anomaly-sequence finding', async () => {
    const detector = new SequenceScanDetector();
    const findings = await run(detector, ['1', '2', '3', '4', '5'], 3_000);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ type: 'anomaly-sequence', severity: 'high' });
  });

  it('case 2: ids 1,5,12,3,8 requested over 3s emit no finding (not consecutive)', async () => {
    const detector = new SequenceScanDetector();
    const findings = await run(detector, ['1', '5', '12', '3', '8'], 3_000);
    expect(findings).toHaveLength(0);
  });

  it('case 3: ids 1,2,3,4,5 requested over 45s emit no finding (beyond maxWindowDurationMs)', async () => {
    const detector = new SequenceScanDetector();
    const findings = await run(detector, ['1', '2', '3', '4', '5'], 45_000);
    expect(findings).toHaveLength(0);
  });

  it('regression: duplicate ids interleaved in the window do not break the consecutive run', async () => {
    // Discovered via load testing: concurrent traffic re-requesting the
    // same ids means the window often contains repeats. A naive
    // sorted-delta check treats a repeat (delta 0) as breaking the run,
    // so 5 distinct consecutive ids buried among duplicates never fired.
    const detector = new SequenceScanDetector();
    const findings = await run(
      detector,
      ['10', '11', '10', '12', '11', '13', '12', '14', '13', '14'],
      3_000,
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ type: 'anomaly-sequence', severity: 'high' });
  });

  describe('with a Redis client configured', () => {
    it('produces the same result as the in-memory path for the same sequence of requests', async () => {
      const memoryDetector = new SequenceScanDetector();
      const redisDetector = new SequenceScanDetector(undefined, fakeRedis());
      const ids = ['1', '2', '3', '4', '5'];

      const memoryFindings = await run(memoryDetector, ids, 3_000);
      const redisFindings = await run(redisDetector, ids, 3_000);

      expect(redisFindings.map((f) => f.type)).toEqual(memoryFindings.map((f) => f.type));
      expect(redisFindings.length).toBeGreaterThan(0);
    });

    it('shares state across two detector instances pointed at the same Redis client', async () => {
      const redis = fakeRedis();
      const first = new SequenceScanDetector(undefined, redis);
      const second = new SequenceScanDetector(undefined, redis);
      const ids = ['1', '2', '3', '4', '5'];
      const stepMs = 3_000 / (ids.length - 1);

      // Alternate instances per request — if state weren't shared via
      // Redis, neither would ever see more than 2-3 of the ids and the
      // consecutive run would never be long enough to fire.
      const findings: Finding[] = [];
      for (let i = 0; i < ids.length; i += 1) {
        const detector = i % 2 === 0 ? first : second;
        findings.push(...(await detector.analyze(entry(i, ids[i], i * stepMs))));
      }

      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].type).toBe('anomaly-sequence');
    });

    it('fails open (returns no findings) instead of throwing when Redis errors', async () => {
      const redis = fakeRedis();
      redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
      const detector = new SequenceScanDetector(undefined, redis);

      await expect(detector.analyze(entry(0, '1', 0))).resolves.toEqual([]);
    });
  });
});
