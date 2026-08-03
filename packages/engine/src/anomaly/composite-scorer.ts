import { ANOMALY_CONFIG } from './anomaly.config';

export interface CompositeScoreInput {
  zScoreFrequency: number;
  sequenceDetected: boolean;
  originShiftDetected: boolean;
}

/**
 * Normalizes an EWMA z-score into [0, 1] against the EWMA analyzer's own
 * threshold: a z-score at the threshold maps to 1.0 (fully anomalous
 * for composite-scoring purposes), values below scale linearly, and
 * values above the threshold clamp at 1.0 — extra severity beyond the
 * threshold doesn't further inflate the composite score, since the
 * frequency signal is already binary-anomalous at that point.
 */
export function normalizeZScore(zScore: number, config = ANOMALY_CONFIG.ewma): number {
  return Math.min(Math.max(zScore / config.zScoreThreshold, 0), 1);
}

export function computeCompositeScore(
  input: CompositeScoreInput,
  config = ANOMALY_CONFIG.composite,
): number {
  const { weights } = config;
  const normalizedFrequency = normalizeZScore(input.zScoreFrequency);

  return (
    weights.frequency * normalizedFrequency +
    weights.sequence * (input.sequenceDetected ? 1 : 0) +
    weights.origin * (input.originShiftDetected ? 1 : 0)
  );
}

/** score > blockThreshold, strictly — a score exactly at the threshold does not block. */
export function isCompositeAnomalyBlocking(score: number, config = ANOMALY_CONFIG.composite): boolean {
  return score > config.blockThreshold;
}
