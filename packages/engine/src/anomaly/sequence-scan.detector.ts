import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ANOMALY_CONFIG } from './anomaly.config';
import { AnomalyRedisClient, ANOMALY_REDIS_STATE_TTL_SECONDS, sequenceScanRedisKey } from './anomaly-redis-client';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

interface WindowEntry {
  id: number;
  timestamp: number;
}

interface SequenceScanStepResult {
  nextWindow: WindowEntry[];
  finding: Finding | null;
}

/**
 * Entries older than this are purged from the sliding window regardless
 * of windowSize. Not part of anomaly.config.ts since it's a window
 * maintenance detail, not a detection threshold (spec section 4.2).
 */
const PURGE_AGE_MS = 60_000;

/**
 * Pure state-transition function shared by the in-memory and
 * Redis-backed code paths, so the two can never drift apart — only the
 * storage of `previousWindow`/`nextWindow` differs between them.
 */
function computeSequenceScanStep(
  previousWindow: WindowEntry[],
  numericId: number,
  entry: BehaviorLogEntry,
  config: { windowSize: number; minConsecutiveIds: number; maxWindowDurationMs: number },
): SequenceScanStepResult {
  let window = previousWindow.filter((w) => entry.timestamp - w.timestamp <= PURGE_AGE_MS);
  window.push({ id: numericId, timestamp: entry.timestamp });
  if (window.length > config.windowSize) {
    window = window.slice(window.length - config.windowSize);
  }

  if (!hasConsecutiveRunWithinWindow(window, config)) {
    return { nextWindow: window, finding: null };
  }

  return {
    nextWindow: window,
    finding: {
      id: uuidv4(),
      requestId: entry.requestId,
      type: 'anomaly-sequence',
      severity: 'high',
      route: entry.route,
      method: entry.method,
      userId: entry.userId,
      detail: `Detected ${config.minConsecutiveIds}+ consecutive resource ids requested within ${config.maxWindowDurationMs}ms`,
      actionTaken: 'logged',
      timestamp: entry.timestamp,
    },
  };
}

function hasConsecutiveRunWithinWindow(
  window: WindowEntry[],
  config: { minConsecutiveIds: number; maxWindowDurationMs: number },
): boolean {
  // Dedupe by id first (keeping the latest timestamp seen for each):
  // re-requesting the same id multiple times (common under concurrent
  // load) must not break the consecutive chain — a repeated id has
  // delta 0 from its neighbor, not the +1 a real run requires.
  const latestById = new Map<number, number>();
  for (const entry of window) {
    const existing = latestById.get(entry.id);
    if (existing === undefined || entry.timestamp > existing) {
      latestById.set(entry.id, entry.timestamp);
    }
  }
  const deduped: WindowEntry[] = Array.from(latestById, ([id, timestamp]) => ({ id, timestamp }));
  const sorted = deduped.sort((a, b) => a.id - b.id);

  let runStart = 0;
  for (let i = 1; i <= sorted.length; i += 1) {
    const brokeRun = i === sorted.length || sorted[i].id !== sorted[i - 1].id + 1;
    if (!brokeRun) continue;

    const runLength = i - runStart;
    if (runLength >= config.minConsecutiveIds) {
      const runTimestamps = sorted.slice(runStart, i).map((e) => e.timestamp);
      const duration = Math.max(...runTimestamps) - Math.min(...runTimestamps);
      if (duration < config.maxWindowDurationMs) return true;
    }
    runStart = i;
  }
  return false;
}

/**
 * Flags IDOR-style enumeration: a user requesting many consecutive
 * numeric resource ids in a short window. The window is per-user
 * (across whatever parameterized routes they hit), per the spec's
 * pseudocode. Consecutive runs are found on the *sorted* ids in the
 * window rather than requiring ascending request order — a scanner
 * that shuffles request order to evade naive sequential detection
 * still gets caught.
 *
 * State is in-memory (per analyzer instance, per process) by default —
 * see docs/architecture.md known limitations. Passing a redis client
 * moves the state into Redis instead (JSON-encoded window, since it's a
 * small ordered list rather than a flat set of scalars), shared across
 * every instance pointed at the same client. Redis errors at request
 * time fail open (logged, no anomaly signal for that request).
 */
export class SequenceScanDetector {
  private readonly windows = new Map<string, WindowEntry[]>();
  private readonly logger = new Logger(SequenceScanDetector.name);

  constructor(
    private readonly config = ANOMALY_CONFIG.sequenceScan,
    private readonly redis?: AnomalyRedisClient,
  ) {}

  async analyze(entry: BehaviorLogEntry): Promise<Finding[]> {
    if (entry.requestedId === undefined) return [];

    const numericId = Number(entry.requestedId);
    if (!Number.isFinite(numericId)) return [];

    const result = this.redis ? await this.stepWithRedis(numericId, entry) : this.stepInMemory(numericId, entry);
    if (result === null) return []; // Redis unreachable — fail open, no signal this request.

    return result.finding ? [result.finding] : [];
  }

  private stepInMemory(numericId: number, entry: BehaviorLogEntry): SequenceScanStepResult {
    const previous = this.windows.get(entry.userId) ?? [];
    const result = computeSequenceScanStep(previous, numericId, entry, this.config);
    this.windows.set(entry.userId, result.nextWindow);
    return result;
  }

  private async stepWithRedis(numericId: number, entry: BehaviorLogEntry): Promise<SequenceScanStepResult | null> {
    const redisKey = sequenceScanRedisKey(entry.userId);
    try {
      const raw = await this.redis!.get(redisKey);
      const previous: WindowEntry[] = raw ? JSON.parse(raw) : [];
      const result = computeSequenceScanStep(previous, numericId, entry, this.config);
      await this.redis!.set(redisKey, JSON.stringify(result.nextWindow));
      await this.redis!.expire(redisKey, ANOMALY_REDIS_STATE_TTL_SECONDS);
      return result;
    } catch (err) {
      this.logger.warn(
        `Redis unreachable for sequence-scan analysis (${redisKey}) — failing open, no anomaly signal this request`,
        err as Error,
      );
      return null;
    }
  }
}
