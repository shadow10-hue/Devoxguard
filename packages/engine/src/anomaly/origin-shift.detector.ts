import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ANOMALY_CONFIG } from './anomaly.config';
import { AnomalyRedisClient, ANOMALY_REDIS_STATE_TTL_SECONDS, originShiftRedisKey } from './anomaly-redis-client';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

interface OriginState {
  lastIp: string;
  /** Timestamp of the last time the IP actually changed (undefined until the first change happens). */
  lastChangeTimestamp: number | undefined;
}

interface OriginShiftStepResult {
  nextState: OriginState;
  finding: Finding | null;
}

/**
 * Pure state-transition function shared by the in-memory and
 * Redis-backed code paths, so the two can never drift apart — only the
 * storage of `previous`/`nextState` differs between them. Always
 * returns a nextState to write, even when the IP is unchanged (a no-op
 * for the in-memory Map, but a deliberate TTL refresh in Redis mode —
 * an actively-hit user with a stable IP shouldn't have their state
 * expire just because it never changes).
 */
function computeOriginShiftStep(
  previous: OriginState | null,
  entry: BehaviorLogEntry,
  config: { minTimeBetweenShiftsMs: number },
): OriginShiftStepResult {
  if (!previous) {
    return { nextState: { lastIp: entry.originIp, lastChangeTimestamp: undefined }, finding: null };
  }

  if (entry.originIp === previous.lastIp) {
    return { nextState: previous, finding: null };
  }

  const isRapidShift =
    previous.lastChangeTimestamp !== undefined &&
    entry.timestamp - previous.lastChangeTimestamp < config.minTimeBetweenShiftsMs;

  const nextState: OriginState = { lastIp: entry.originIp, lastChangeTimestamp: entry.timestamp };

  if (!isRapidShift) {
    return { nextState, finding: null };
  }

  return {
    nextState,
    finding: {
      id: uuidv4(),
      requestId: entry.requestId,
      type: 'anomaly-origin',
      severity: 'medium',
      route: entry.route,
      method: entry.method,
      userId: entry.userId,
      detail: `Origin IP changed to '${entry.originIp}' within ${config.minTimeBetweenShiftsMs}ms of a previous change`,
      actionTaken: 'logged',
      timestamp: entry.timestamp,
    },
  };
}

function deserializeState(raw: Record<string, string>): OriginState | null {
  if (Object.keys(raw).length === 0) return null;
  return {
    lastIp: raw.lastIp,
    lastChangeTimestamp: raw.lastChangeTimestamp === '' ? undefined : Number(raw.lastChangeTimestamp),
  };
}

function serializeState(state: OriginState): Record<string, string> {
  return {
    lastIp: state.lastIp,
    lastChangeTimestamp: state.lastChangeTimestamp === undefined ? '' : String(state.lastChangeTimestamp),
  };
}

/**
 * Flags rapid, repeated origin IP changes for the same user (e.g.
 * session/credential sharing): a shift is only suspicious if another
 * shift already happened recently. The very first IP seen for a user,
 * and the very first time it changes, are never flagged — there's
 * nothing yet to call "rapid" against.
 *
 * State is in-memory (per analyzer instance, per process) by default —
 * see docs/architecture.md known limitations. Passing a redis client
 * moves the state into Redis instead, shared across every instance
 * pointed at the same client. Redis errors at request time fail open
 * (logged, no anomaly signal for that request).
 */
export class OriginShiftDetector {
  private readonly state = new Map<string, OriginState>();
  private readonly logger = new Logger(OriginShiftDetector.name);

  constructor(
    private readonly config = ANOMALY_CONFIG.originShift,
    private readonly redis?: AnomalyRedisClient,
  ) {}

  async analyze(entry: BehaviorLogEntry): Promise<Finding[]> {
    const result = this.redis ? await this.stepWithRedis(entry) : this.stepInMemory(entry);
    if (result === null) return []; // Redis unreachable — fail open, no signal this request.

    return result.finding ? [result.finding] : [];
  }

  private stepInMemory(entry: BehaviorLogEntry): OriginShiftStepResult {
    const result = computeOriginShiftStep(this.state.get(entry.userId) ?? null, entry, this.config);
    this.state.set(entry.userId, result.nextState);
    return result;
  }

  private async stepWithRedis(entry: BehaviorLogEntry): Promise<OriginShiftStepResult | null> {
    const redisKey = originShiftRedisKey(entry.userId);
    try {
      const raw = await this.redis!.hgetall(redisKey);
      const result = computeOriginShiftStep(deserializeState(raw), entry, this.config);
      await this.redis!.hset(redisKey, serializeState(result.nextState));
      await this.redis!.expire(redisKey, ANOMALY_REDIS_STATE_TTL_SECONDS);
      return result;
    } catch (err) {
      this.logger.warn(
        `Redis unreachable for origin-shift analysis (${redisKey}) — failing open, no anomaly signal this request`,
        err as Error,
      );
      return null;
    }
  }
}
