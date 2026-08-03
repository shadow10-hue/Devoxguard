export const ANOMALY_CONFIG = {
  ewma: {
    alpha: 0.3,
    zScoreThreshold: 3,
  },
  sequenceScan: {
    windowSize: 20,
    minConsecutiveIds: 5,
    maxWindowDurationMs: 10_000,
  },
  originShift: {
    minTimeBetweenShiftsMs: 120_000,
  },
  composite: {
    weights: { frequency: 0.4, sequence: 0.4, origin: 0.2 },
    blockThreshold: 0.7,
  },
};
