import { AnomalyScoreTrendTracker } from './anomaly-score-trend.tracker';

describe('AnomalyScoreTrendTracker', () => {
  it('records samples in order', () => {
    const tracker = new AnomalyScoreTrendTracker();
    tracker.record(1000, 0.2);
    tracker.record(2000, 0.5);

    expect(tracker.getTrend()).toEqual([
      { timestamp: 1000, score: 0.2 },
      { timestamp: 2000, score: 0.5 },
    ]);
  });

  it('drops the oldest sample once maxSamples is exceeded', () => {
    const tracker = new AnomalyScoreTrendTracker(2);
    tracker.record(1000, 0.1);
    tracker.record(2000, 0.2);
    tracker.record(3000, 0.3);

    expect(tracker.getTrend()).toEqual([
      { timestamp: 2000, score: 0.2 },
      { timestamp: 3000, score: 0.3 },
    ]);
  });
});
