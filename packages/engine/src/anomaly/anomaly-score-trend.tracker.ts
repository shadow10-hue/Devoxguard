export interface AnomalyScoreSample {
  timestamp: number;
  score: number;
}

/**
 * In-memory rolling buffer of composite anomaly scores, sampled by the
 * guard on every request that has an authenticated user. Backs the
 * `averageAnomalyScoreTrend` field of GET /devoxguard/api/stats/overview.
 * Not persisted — see docs/architecture.md known limitations, same
 * rationale as the anomaly analyzers' own in-memory state.
 */
export class AnomalyScoreTrendTracker {
  private readonly samples: AnomalyScoreSample[] = [];

  constructor(private readonly maxSamples = 500) {}

  record(timestamp: number, score: number): void {
    this.samples.push({ timestamp, score });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  getTrend(): AnomalyScoreSample[] {
    return [...this.samples];
  }
}
