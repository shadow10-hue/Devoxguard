import { v4 as uuidv4 } from 'uuid';
import { ANOMALY_CONFIG } from './anomaly.config';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

interface EwmaState {
  ewma: number;
  variance: number;
  lastTimestamp: number;
  /** Number of intervals folded into ewma/variance so far. */
  intervalsObserved: number;
}

const EPSILON = 1e-6;
/** Below this many observed intervals, variance hasn't absorbed a real deviation yet — skip the z-check to avoid dividing by a near-zero variance. */
const MIN_INTERVALS_FOR_ZSCORE = 2;

/**
 * Tracks request inter-arrival times per (userId + route) with an
 * exponentially weighted moving average and variance, flagging
 * intervals whose z-score exceeds the configured threshold. State is
 * in-memory only (see docs/architecture.md known limitations) and
 * keyed per analyzer instance.
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
export class EwmaFrequencyAnalyzer {
  private readonly state = new Map<string, EwmaState>();

  constructor(private readonly config = ANOMALY_CONFIG.ewma) {}

  analyze(entry: BehaviorLogEntry): Finding[] {
    const key = `${entry.userId}:${entry.route}`;
    const previous = this.state.get(key);

    if (!previous) {
      // First request for this key: no interval can be computed yet.
      this.state.set(key, { ewma: 0, variance: 0, lastTimestamp: entry.timestamp, intervalsObserved: 0 });
      return [];
    }

    const interval = entry.timestamp - previous.lastTimestamp;

    if (previous.intervalsObserved === 0) {
      // First computed interval for this key: seed ewma directly, no
      // meaningful variance estimate exists yet.
      this.state.set(key, { ewma: interval, variance: 0, lastTimestamp: entry.timestamp, intervalsObserved: 1 });
      return [];
    }

    const deviation = interval - previous.ewma;
    const zScore =
      previous.intervalsObserved >= MIN_INTERVALS_FOR_ZSCORE
        ? Math.abs(deviation) / Math.sqrt(previous.variance + EPSILON)
        : null;

    const ewma = previous.ewma + this.config.alpha * deviation;
    const variance = (1 - this.config.alpha) * (previous.variance + this.config.alpha * deviation * deviation);
    this.state.set(key, {
      ewma,
      variance,
      lastTimestamp: entry.timestamp,
      intervalsObserved: previous.intervalsObserved + 1,
    });

    if (zScore === null || zScore <= this.config.zScoreThreshold) return [];

    return [
      {
        id: uuidv4(),
        requestId: entry.requestId,
        type: 'anomaly-frequency',
        severity: zScore >= this.config.zScoreThreshold * 2 ? 'high' : 'medium',
        route: entry.route,
        method: entry.method,
        userId: entry.userId,
        detail: `Request interval z-score ${zScore.toFixed(2)} exceeds threshold ${this.config.zScoreThreshold}`,
        actionTaken: 'logged',
        timestamp: entry.timestamp,
      },
    ];
  }
}
