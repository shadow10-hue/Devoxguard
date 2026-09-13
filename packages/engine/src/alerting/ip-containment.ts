import { Logger } from '@nestjs/common';

export interface IpContainmentConfig {
  /** Off by default — stateful IP banning is opt-in to avoid accidental lockouts. */
  enabled?: boolean;
  /** Injection blocks from one IP within `windowMs` needed to trigger a ban. Default 5. */
  threshold?: number;
  /** Sliding-ish counting window in ms. Default 60_000. */
  windowMs?: number;
  /** How long a triggered ban lasts, in ms. Default 300_000 (5 min). */
  banMs?: number;
}

export const DEFAULT_IP_CONTAINMENT: Required<Omit<IpContainmentConfig, 'enabled'>> = {
  threshold: 5,
  windowMs: 60_000,
  banMs: 300_000,
};

/**
 * Structural subset of ioredis used here — kept minimal (like
 * AnomalyRedisClient) so unit tests pass a plain mock and the real client
 * assigns cleanly despite ioredis's heavily-overloaded signatures.
 */
export interface ContainmentRedisClient {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  set(key: string, value: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

const BAN_KEY = (ip: string) => `devoxguard:contain:ban:${ip}`;
const OFFENSE_KEY = (ip: string) => `devoxguard:contain:offense:${ip}`;

/**
 * Automated containment: an IP that trips the injection detector `threshold`
 * times within `windowMs` is temporarily banned, and the guard rejects every
 * subsequent request from it (with an `auto-contained` finding) for `banMs` —
 * before any handler runs. This is the automated containment step of the
 * incident-response playbook (docs/incident-response.md).
 *
 * State is in-memory per process by default; passing a Redis client shares it
 * across instances (required for multi-process/horizontal deployments — an
 * attacker must not be able to dodge a ban by landing on another worker).
 * Redis errors fail *open* — a Redis outage must not start blocking legitimate
 * traffic — so isBanned() returns false and recordOffense() is a no-op on error.
 */
export class IpContainment {
  private readonly logger = new Logger(IpContainment.name);
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly banMs: number;

  private readonly bans = new Map<string, number>(); // ip -> ban-expiry epoch ms
  private readonly offenses = new Map<string, number[]>(); // ip -> offense timestamps

  constructor(
    config: IpContainmentConfig = {},
    private readonly redis?: ContainmentRedisClient,
  ) {
    this.threshold = config.threshold ?? DEFAULT_IP_CONTAINMENT.threshold;
    this.windowMs = config.windowMs ?? DEFAULT_IP_CONTAINMENT.windowMs;
    this.banMs = config.banMs ?? DEFAULT_IP_CONTAINMENT.banMs;
  }

  async isBanned(ip: string, now: number = Date.now()): Promise<boolean> {
    if (this.redis) {
      try {
        return (await this.redis.exists(BAN_KEY(ip))) > 0;
      } catch (err) {
        this.logger.warn(`Redis unreachable checking ban for ${ip} — failing open (allowing)`, err as Error);
        return false;
      }
    }
    const expiry = this.bans.get(ip);
    if (expiry === undefined) return false;
    if (expiry <= now) {
      this.bans.delete(ip);
      return false;
    }
    return true;
  }

  /** Records one injection block from `ip`; returns true if this offense triggered a ban. */
  async recordOffense(ip: string, now: number = Date.now()): Promise<boolean> {
    if (this.redis) return this.recordOffenseRedis(ip);
    return this.recordOffenseInMemory(ip, now);
  }

  private recordOffenseInMemory(ip: string, now: number): boolean {
    const recent = (this.offenses.get(ip) ?? []).filter((ts) => now - ts < this.windowMs);
    recent.push(now);
    if (recent.length >= this.threshold) {
      this.bans.set(ip, now + this.banMs);
      this.offenses.delete(ip);
      this.logger.warn(`IP ${ip} auto-contained after ${recent.length} injection blocks in ${this.windowMs}ms`);
      return true;
    }
    this.offenses.set(ip, recent);
    return false;
  }

  private async recordOffenseRedis(ip: string): Promise<boolean> {
    try {
      const key = OFFENSE_KEY(ip);
      const count = await this.redis!.incr(key);
      if (count === 1) await this.redis!.pexpire(key, this.windowMs); // fixed-window counter
      if (count >= this.threshold) {
        await this.redis!.set(BAN_KEY(ip), '1');
        await this.redis!.pexpire(BAN_KEY(ip), this.banMs);
        await this.redis!.del(key);
        this.logger.warn(`IP ${ip} auto-contained after ${count} injection blocks (Redis-backed)`);
        return true;
      }
      return false;
    } catch (err) {
      this.logger.warn(`Redis unreachable recording offense for ${ip} — containment skipped this request`, err as Error);
      return false;
    }
  }
}
