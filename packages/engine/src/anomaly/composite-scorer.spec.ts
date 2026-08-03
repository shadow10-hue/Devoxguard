import { computeCompositeScore, isCompositeAnomalyBlocking, normalizeZScore } from './composite-scorer';

describe('normalizeZScore', () => {
  it('maps a z-score at the EWMA threshold to 1.0', () => {
    expect(normalizeZScore(3)).toBe(1);
  });

  it('maps zero to 0', () => {
    expect(normalizeZScore(0)).toBe(0);
  });

  it('clamps values above the threshold at 1.0', () => {
    expect(normalizeZScore(10)).toBe(1);
  });

  it('scales linearly below the threshold', () => {
    expect(normalizeZScore(1.5)).toBeCloseTo(0.5, 5);
  });
});

describe('computeCompositeScore', () => {
  it('is 0 when no signal fired', () => {
    const score = computeCompositeScore({ zScoreFrequency: 0, sequenceDetected: false, originShiftDetected: false });
    expect(score).toBe(0);
  });

  it('weighted-sum correctness: only sequenceDetected contributes its weight', () => {
    const score = computeCompositeScore({ zScoreFrequency: 0, sequenceDetected: true, originShiftDetected: false });
    expect(score).toBeCloseTo(0.4, 5);
  });

  it('weighted-sum correctness: all three signals maxed sum to 1.0', () => {
    const score = computeCompositeScore({ zScoreFrequency: 3, sequenceDetected: true, originShiftDetected: true });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('threshold boundary: a score of exactly 0.7 does not block', () => {
    const score = computeCompositeScore({ zScoreFrequency: 0.75, sequenceDetected: true, originShiftDetected: true });
    expect(score).toBeCloseTo(0.7, 5);
    expect(isCompositeAnomalyBlocking(score)).toBe(false);
  });

  it('threshold boundary: a score just above 0.7 blocks', () => {
    const score = computeCompositeScore({ zScoreFrequency: 0.78, sequenceDetected: true, originShiftDetected: true });
    expect(score).toBeGreaterThan(0.7);
    expect(isCompositeAnomalyBlocking(score)).toBe(true);
  });
});
