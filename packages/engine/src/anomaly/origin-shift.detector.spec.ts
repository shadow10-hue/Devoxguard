import { OriginShiftDetector } from './origin-shift.detector';
import { AnomalyRedisClient } from './anomaly-redis-client';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

function entry(index: number, originIp: string, timestamp: number): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: 'user-1',
    route: '/orders/:id',
    method: 'GET',
    timestamp,
    originIp,
  };
}

async function runAll(detector: OriginShiftDetector, entries: BehaviorLogEntry[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const e of entries) {
    findings.push(...(await detector.analyze(e)));
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

describe('OriginShiftDetector', () => {
  it('nominal: same IP on every request never emits a finding', async () => {
    const detector = new OriginShiftDetector();
    const findings = await runAll(
      detector,
      [0, 1000, 2000, 3000].map((ts, i) => entry(i, '10.0.0.1', ts)),
    );
    expect(findings).toHaveLength(0);
  });

  it('a single IP change is not flagged (nothing to compare "rapid" against yet)', async () => {
    const detector = new OriginShiftDetector();
    const findings = await runAll(detector, [
      entry(0, '10.0.0.1', 0),
      entry(1, '10.0.0.1', 1_000),
      entry(2, '203.0.113.7', 5_000),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('rapid shift: a second IP change within the window after the first is flagged', async () => {
    const detector = new OriginShiftDetector();
    const findings = await runAll(detector, [
      entry(0, '10.0.0.1', 0),
      entry(1, '203.0.113.7', 5_000), // first change: not flagged
      entry(2, '10.0.0.1', 15_000), // second change, 10s later (< 120s): flagged
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'anomaly-origin', severity: 'medium' });
  });

  it('shift outside the window: a second change long after the first is not flagged', async () => {
    const detector = new OriginShiftDetector();
    const findings = await runAll(detector, [
      entry(0, '10.0.0.1', 0),
      entry(1, '203.0.113.7', 5_000), // first change: not flagged
      entry(2, '10.0.0.1', 200_000), // second change, 195s later (> 120s): not flagged
    ]);

    expect(findings).toHaveLength(0);
  });

  describe('with a Redis client configured', () => {
    it('produces the same result as the in-memory path for the same sequence of requests', async () => {
      const entries = [entry(0, '10.0.0.1', 0), entry(1, '203.0.113.7', 5_000), entry(2, '10.0.0.1', 15_000)];
      const memoryFindings = await runAll(new OriginShiftDetector(), entries);
      const redisFindings = await runAll(new OriginShiftDetector(undefined, fakeRedis()), entries);

      expect(redisFindings.map((f) => f.type)).toEqual(memoryFindings.map((f) => f.type));
      expect(redisFindings).toHaveLength(1);
    });

    it('shares state across two detector instances pointed at the same Redis client', async () => {
      const redis = fakeRedis();
      const first = new OriginShiftDetector(undefined, redis);
      const second = new OriginShiftDetector(undefined, redis);

      // First request lands on `first`, the rapid-shift-triggering
      // request lands on `second` — only fires if state is actually
      // shared via Redis, not held independently per instance.
      await first.analyze(entry(0, '10.0.0.1', 0));
      await first.analyze(entry(1, '203.0.113.7', 5_000));
      const findings = await second.analyze(entry(2, '10.0.0.1', 15_000));

      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe('anomaly-origin');
    });

    it('fails open (returns no findings) instead of throwing when Redis errors', async () => {
      const redis = fakeRedis();
      redis.hgetall.mockRejectedValue(new Error('ECONNREFUSED'));
      const detector = new OriginShiftDetector(undefined, redis);

      await expect(detector.analyze(entry(0, '10.0.0.1', 0))).resolves.toEqual([]);
    });
  });
});
