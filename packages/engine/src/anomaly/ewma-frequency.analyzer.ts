import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ANOMALY_CONFIG } from './anomaly.config';
import { AnomalyRedisClient, ANOMALY_REDIS_STATE_TTL_SECONDS, ewmaRedisKey } from './anomaly-redis-client';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

interface EwmaState {
  ewma: number;
  variance: number;
  lastTimestamp: number;
  /** Number of intervals folded into ewma/variance so far. */
  intervalsObserved: number;
}

interface EwmaStepResult {
  nextState: EwmaState;
  finding: Finding | null;
  zScore: number | null;
}

const EPSILON = 1e-6;
/** Below this many observed intervals, variance hasn't absorbed a real deviation yet — skip the z-check to avoid dividing by a near-zero variance. */
const MIN_INTERVALS_FOR_ZSCORE = 2;

/**
 * Pure state-transition function shared by the in-memory and
 * Redis-backed code paths, so the two can never drift apart — only the
 * storage of `previous`/`nextState` differs between them.
 *
 * Deviates from the spec's pseudocode in one deliberate way: z-score is
 * computed against the *pre-update* ewma/variance (the model as it was
 * before absorbing the current interval), not the post-update values.
 * Computing it post-update is mathematically self-limiting — the same
 * deviation that produces the numerator also inflates the variance
 * that normalizes it, capping z-score at sqrt((1-alpha)/alpha) ≈ 1.53
 * for alpha=0.3, which is always below the spec's own threshold of 3.
 * That would make the detector permanently unable to fire, contradicting
 * the spec's own "sudden burst" test case. A short warm-up (the first
 * two observed intervals only seed the model, no z-check) avoids
 * dividing by a near-zero variance right after a key's first request.
 */
function computeEwmaStep(
  previous: EwmaState | null,
  entry: BehaviorLogEntry,
  config: { alpha: number; zScoreThreshold: number },
): EwmaStepResult {
  if (!previous) {
    // First request for this key: no interval can be computed yet.
    return {
      nextState: { ewma: 0, variance: 0, lastTimestamp: entry.timestamp, intervalsObserved: 0 },
      finding: null,
      zScore: null,
    };
  }

  const interval = entry.timestamp - previous.lastTimestamp;

  if (previous.intervalsObserved === 0) {
    // First computed interval for this key: seed ewma directly, no
    // meaningful variance estimate exists yet.
    return {
      nextState: { ewma: interval, variance: 0, lastTimestamp: entry.timestamp, intervalsObserved: 1 },
      finding: null,
      zScore: null,
    };
  }

  const deviation = interval - previous.ewma;
  const zScore =
    previous.intervalsObserved >= MIN_INTERVALS_FOR_ZSCORE
      ? Math.abs(deviation) / Math.sqrt(previous.variance + EPSILON)
      : null;

  const ewma = previous.ewma + config.alpha * deviation;
  const variance = (1 - config.alpha) * (previous.variance + config.alpha * deviation * deviation);
  const nextState: EwmaState = {
    ewma,
    variance,
    lastTimestamp: entry.timestamp,
    intervalsObserved: previous.intervalsObserved + 1,
  };

  if (zScore === null || zScore <= config.zScoreThreshold) {
    return { nextState, finding: null, zScore };
  }

  return {
    nextState,
    zScore,
    finding: {
      id: uuidv4(),
      requestId: entry.requestId,
      type: 'anomaly-frequency',
      severity: zScore >= config.zScoreThreshold * 2 ? 'high' : 'medium',
      route: entry.route,
      method: entry.method,
      userId: entry.userId,
      detail: `Request interval z-score ${zScore.toFixed(2)} exceeds threshold ${config.zScoreThreshold}`,
      actionTaken: 'logged',
      timestamp: entry.timestamp,
    },
  };
}

function deserializeState(raw: Record<string, string>): EwmaState | null {
  if (Object.keys(raw).length === 0) return null;
  return {
    ewma: Number(raw.ewma),
    variance: Number(raw.variance),
    lastTimestamp: Number(raw.lastTimestamp),
    intervalsObserved: Number(raw.intervalsObserved),
  };
}

function serializeState(state: EwmaState): Record<string, string> {
  return {
    ewma: String(state.ewma),
    variance: String(state.variance),
    lastTimestamp: String(state.lastTimestamp),
    intervalsObserved: String(state.intervalsObserved),
  };
}

/**
 * Tracks request inter-arrival times per (userId + route) with an
 * exponentially weighted moving average and variance, flagging
 * intervals whose z-score exceeds the configured threshold.
 *
 * State is in-memory (per analyzer instance, per process) by default —
 * see docs/architecture.md known limitations. Passing a redis client
 * moves the state into Redis instead, shared across every instance
 * pointed at the same client, at the cost of a network round-trip per
 * request. Redis errors at request time fail open (logged, no anomaly
 * signal for that request) rather than breaking the request pipeline —
 * consistent with docs/architecture.md §5's fail-open policy for engine
 * logic errors.
 */
export class EwmaFrequencyAnalyzer {
  private readonly state = new Map<string, EwmaState>();
  private readonly lastZScores = new Map<string, number>();
  private readonly logger = new Logger(EwmaFrequencyAnalyzer.name);

  constructor(
    private readonly config = ANOMALY_CONFIG.ewma,
    private readonly redis?: AnomalyRedisClient,
  ) {}

  /**
   * Most recently computed z-score for a (userId, route) key, or 0 if
   * none is available yet (used by composite-scorer.ts). Kept as a
   * synchronous local cache even in Redis mode — it's only ever read
   * immediately after analyze() within the same request/process, so
   * there's no need to pay for a distributed round-trip for it.
   */
  getLastZScore(userId: string, route: string): number {
    return this.lastZScores.get(`${userId}:${route}`) ?? 0;
  }

  async analyze(entry: BehaviorLogEntry): Promise<Finding[]> {
    const key = `${entry.userId}:${entry.route}`;
    const result = this.redis ? await this.stepWithRedis(key, entry) : this.stepInMemory(key, entry);
    if (result === null) return []; // Redis unreachable — fail open, no signal this request.

    if (result.zScore !== null) this.lastZScores.set(key, result.zScore);
    return result.finding ? [result.finding] : [];
  }

  private stepInMemory(key: string, entry: BehaviorLogEntry): EwmaStepResult {
    const result = computeEwmaStep(this.state.get(key) ?? null, entry, this.config);
    this.state.set(key, result.nextState);
    return result;
  }

  private async stepWithRedis(key: string, entry: BehaviorLogEntry): Promise<EwmaStepResult | null> {
    const redisKey = ewmaRedisKey(entry.userId, entry.route);
    try {
      const raw = await this.redis!.hgetall(redisKey);
      const result = computeEwmaStep(deserializeState(raw), entry, this.config);
      await this.redis!.hset(redisKey, serializeState(result.nextState));
      await this.redis!.expire(redisKey, ANOMALY_REDIS_STATE_TTL_SECONDS);
      return result;
    } catch (err) {
      this.logger.warn(
        `Redis unreachable for EWMA frequency analysis (${redisKey}) — failing open, no anomaly signal this request`,
        err as Error,
      );
      return null;
    }
  }
}
