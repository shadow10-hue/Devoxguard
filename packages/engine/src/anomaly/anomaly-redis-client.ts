/**
 * Structural subset of ioredis's Redis client actually used by the
 * anomaly analyzers — kept decoupled (like RateLimiter in
 * guard/devoxguard.guard.ts) so analyzer unit tests can pass a plain
 * mock instead of standing up a real ioredis instance.
 */
export interface AnomalyRedisClient {
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, data: Record<string, string | number>): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
}

/**
 * TTL applied (and refreshed on every write) to every analyzer's Redis
 * keys, so abandoned user/route pairs don't accumulate in Redis forever
 * — unlike the in-memory Map they replace, Redis has no process
 * lifetime to naturally bound it. 24h comfortably exceeds every
 * analyzer's own purge/lookback window (sequence-scan's 60s, EWMA's and
 * origin-shift's unbounded-but-typically-short-lived windows).
 */
export const ANOMALY_REDIS_STATE_TTL_SECONDS = 24 * 60 * 60;

const KEY_PREFIX = 'devoxguard';

export function ewmaRedisKey(userId: string, route: string): string {
  return `${KEY_PREFIX}:ewma:${userId}:${route}`;
}

export function sequenceScanRedisKey(userId: string): string {
  return `${KEY_PREFIX}:seqscan:${userId}`;
}

export function originShiftRedisKey(userId: string): string {
  return `${KEY_PREFIX}:originshift:${userId}`;
}
