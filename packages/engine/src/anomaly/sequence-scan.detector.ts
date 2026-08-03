import { v4 as uuidv4 } from 'uuid';
import { ANOMALY_CONFIG } from './anomaly.config';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

interface WindowEntry {
  id: number;
  timestamp: number;
}

/**
 * Entries older than this are purged from the sliding window regardless
 * of windowSize. Not part of anomaly.config.ts since it's a window
 * maintenance detail, not a detection threshold (spec section 4.2).
 */
const PURGE_AGE_MS = 60_000;

/**
 * Flags IDOR-style enumeration: a user requesting many consecutive
 * numeric resource ids in a short window. The window is per-user
 * (across whatever parameterized routes they hit), per the spec's
 * pseudocode. Consecutive runs are found on the *sorted* ids in the
 * window rather than requiring ascending request order — a scanner
 * that shuffles request order to evade naive sequential detection
 * still gets caught.
 */
export class SequenceScanDetector {
  private readonly windows = new Map<string, WindowEntry[]>();

  constructor(private readonly config = ANOMALY_CONFIG.sequenceScan) {}

  analyze(entry: BehaviorLogEntry): Finding[] {
    if (entry.requestedId === undefined) return [];

    const numericId = Number(entry.requestedId);
    if (!Number.isFinite(numericId)) return [];

    let window = this.windows.get(entry.userId) ?? [];
    window = window.filter((w) => entry.timestamp - w.timestamp <= PURGE_AGE_MS);
    window.push({ id: numericId, timestamp: entry.timestamp });
    if (window.length > this.config.windowSize) {
      window = window.slice(window.length - this.config.windowSize);
    }
    this.windows.set(entry.userId, window);

    if (!this.hasConsecutiveRunWithinWindow(window)) return [];

    return [
      {
        id: uuidv4(),
        requestId: entry.requestId,
        type: 'anomaly-sequence',
        severity: 'high',
        route: entry.route,
        method: entry.method,
        userId: entry.userId,
        detail: `Detected ${this.config.minConsecutiveIds}+ consecutive resource ids requested within ${this.config.maxWindowDurationMs}ms`,
        actionTaken: 'logged',
        timestamp: entry.timestamp,
      },
    ];
  }

  private hasConsecutiveRunWithinWindow(window: WindowEntry[]): boolean {
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
      if (runLength >= this.config.minConsecutiveIds) {
        const runTimestamps = sorted.slice(runStart, i).map((e) => e.timestamp);
        const duration = Math.max(...runTimestamps) - Math.min(...runTimestamps);
        if (duration < this.config.maxWindowDurationMs) return true;
      }
      runStart = i;
    }
    return false;
  }
}
