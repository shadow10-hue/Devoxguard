import { OriginShiftDetector } from './origin-shift.detector';
import { BehaviorLogEntry } from './behavior-log.schema';

function entry(index: number, originIp: string, timestamp: number): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: 'user-1',
    route: '/orders/:id',
    method: 'GET',
    timestamp,
    originIp,
  };
}

describe('OriginShiftDetector', () => {
  it('nominal: same IP on every request never emits a finding', () => {
    const detector = new OriginShiftDetector();
    const findings = [0, 1000, 2000, 3000].flatMap((ts, i) => detector.analyze(entry(i, '10.0.0.1', ts)));
    expect(findings).toHaveLength(0);
  });

  it('a single IP change is not flagged (nothing to compare "rapid" against yet)', () => {
    const detector = new OriginShiftDetector();
    const findings = [
      ...detector.analyze(entry(0, '10.0.0.1', 0)),
      ...detector.analyze(entry(1, '10.0.0.1', 1_000)),
      ...detector.analyze(entry(2, '203.0.113.7', 5_000)),
    ];
    expect(findings).toHaveLength(0);
  });

  it('rapid shift: a second IP change within the window after the first is flagged', () => {
    const detector = new OriginShiftDetector();
    const findings = [
      ...detector.analyze(entry(0, '10.0.0.1', 0)),
      ...detector.analyze(entry(1, '203.0.113.7', 5_000)), // first change: not flagged
      ...detector.analyze(entry(2, '10.0.0.1', 15_000)), // second change, 10s later (< 120s): flagged
    ];

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'anomaly-origin', severity: 'medium' });
  });

  it('shift outside the window: a second change long after the first is not flagged', () => {
    const detector = new OriginShiftDetector();
    const findings = [
      ...detector.analyze(entry(0, '10.0.0.1', 0)),
      ...detector.analyze(entry(1, '203.0.113.7', 5_000)), // first change: not flagged
      ...detector.analyze(entry(2, '10.0.0.1', 200_000)), // second change, 195s later (> 120s): not flagged
    ];

    expect(findings).toHaveLength(0);
  });
});
