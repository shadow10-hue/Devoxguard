import { v4 as uuidv4 } from 'uuid';
import { ANOMALY_CONFIG } from './anomaly.config';
import { BehaviorLogEntry } from './behavior-log.schema';
import { Finding } from '../storage/finding.schema';

interface OriginState {
  lastIp: string;
  /** Timestamp of the last time the IP actually changed (undefined until the first change happens). */
  lastChangeTimestamp: number | undefined;
}

/**
 * Flags rapid, repeated origin IP changes for the same user (e.g.
 * session/credential sharing): a shift is only suspicious if another
 * shift already happened recently. The very first IP seen for a user,
 * and the very first time it changes, are never flagged — there's
 * nothing yet to call "rapid" against.
 */
export class OriginShiftDetector {
  private readonly state = new Map<string, OriginState>();

  constructor(private readonly config = ANOMALY_CONFIG.originShift) {}

  analyze(entry: BehaviorLogEntry): Finding[] {
    const previous = this.state.get(entry.userId);

    if (!previous) {
      this.state.set(entry.userId, { lastIp: entry.originIp, lastChangeTimestamp: undefined });
      return [];
    }

    if (entry.originIp === previous.lastIp) return [];

    const isRapidShift =
      previous.lastChangeTimestamp !== undefined &&
      entry.timestamp - previous.lastChangeTimestamp < this.config.minTimeBetweenShiftsMs;

    this.state.set(entry.userId, { lastIp: entry.originIp, lastChangeTimestamp: entry.timestamp });

    if (!isRapidShift) return [];

    return [
      {
        id: uuidv4(),
        requestId: entry.requestId,
        type: 'anomaly-origin',
        severity: 'medium',
        route: entry.route,
        method: entry.method,
        userId: entry.userId,
        detail: `Origin IP changed to '${entry.originIp}' within ${this.config.minTimeBetweenShiftsMs}ms of a previous change`,
        actionTaken: 'logged',
        timestamp: entry.timestamp,
      },
    ];
  }
}
