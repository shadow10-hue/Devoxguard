import { ContainmentRedisClient, IpContainment } from './ip-containment';

describe('IpContainment (in-memory)', () => {
  const cfg = { enabled: true, threshold: 3, windowMs: 1000, banMs: 5000 };

  it('does not ban before the threshold is reached', async () => {
    const c = new IpContainment(cfg);
    const now = 10_000;
    expect(await c.recordOffense('1.1.1.1', now)).toBe(false);
    expect(await c.recordOffense('1.1.1.1', now + 100)).toBe(false);
    expect(await c.isBanned('1.1.1.1', now + 200)).toBe(false);
  });

  it('bans on the threshold-th offense within the window', async () => {
    const c = new IpContainment(cfg);
    const now = 10_000;
    await c.recordOffense('1.1.1.1', now);
    await c.recordOffense('1.1.1.1', now + 100);
    expect(await c.recordOffense('1.1.1.1', now + 200)).toBe(true);
    expect(await c.isBanned('1.1.1.1', now + 300)).toBe(true);
  });

  it('does not count offenses that fall outside the window', async () => {
    const c = new IpContainment(cfg);
    await c.recordOffense('1.1.1.1', 0);
    await c.recordOffense('1.1.1.1', 500);
    // This one is > windowMs after the first, which has aged out.
    expect(await c.recordOffense('1.1.1.1', 1600)).toBe(false);
  });

  it('lifts the ban after banMs elapses', async () => {
    const c = new IpContainment(cfg);
    const now = 10_000;
    await c.recordOffense('1.1.1.1', now);
    await c.recordOffense('1.1.1.1', now + 10);
    await c.recordOffense('1.1.1.1', now + 20);
    expect(await c.isBanned('1.1.1.1', now + 30)).toBe(true);
    expect(await c.isBanned('1.1.1.1', now + 20 + 5000 + 1)).toBe(false);
  });

  it('tracks IPs independently', async () => {
    const c = new IpContainment(cfg);
    const now = 10_000;
    await c.recordOffense('1.1.1.1', now);
    await c.recordOffense('1.1.1.1', now + 1);
    await c.recordOffense('1.1.1.1', now + 2);
    expect(await c.isBanned('1.1.1.1', now + 3)).toBe(true);
    expect(await c.isBanned('2.2.2.2', now + 3)).toBe(false);
  });
});

describe('IpContainment (Redis-backed)', () => {
  const cfg = { enabled: true, threshold: 3, windowMs: 1000, banMs: 5000 };

  function mockRedis(): ContainmentRedisClient & { store: Map<string, number> } {
    const store = new Map<string, number>();
    const banned = new Set<string>();
    return {
      store,
      incr: jest.fn(async (key: string) => {
        const v = (store.get(key) ?? 0) + 1;
        store.set(key, v);
        return v;
      }),
      pexpire: jest.fn(async () => 1),
      set: jest.fn(async (key: string) => {
        banned.add(key);
        return 'OK';
      }),
      exists: jest.fn(async (key: string) => (banned.has(key) ? 1 : 0)),
      del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    };
  }

  it('bans via Redis on the threshold-th offense', async () => {
    const redis = mockRedis();
    const c = new IpContainment(cfg, redis);
    expect(await c.recordOffense('1.1.1.1')).toBe(false);
    expect(await c.recordOffense('1.1.1.1')).toBe(false);
    expect(await c.recordOffense('1.1.1.1')).toBe(true);
    expect(await c.isBanned('1.1.1.1')).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('devoxguard:contain:ban:1.1.1.1', '1');
  });

  it('fails open when Redis errors (allows, does not ban)', async () => {
    const redis = mockRedis();
    (redis.exists as jest.Mock).mockRejectedValue(new Error('redis down'));
    (redis.incr as jest.Mock).mockRejectedValue(new Error('redis down'));
    const c = new IpContainment(cfg, redis);
    expect(await c.isBanned('1.1.1.1')).toBe(false);
    expect(await c.recordOffense('1.1.1.1')).toBe(false);
  });
});
