import { SequenceScanDetector } from './sequence-scan.detector';
import { BehaviorLogEntry } from './behavior-log.schema';

function entry(index: number, requestedId: string, timestamp: number): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: 'user-1',
    route: '/orders/:id',
    method: 'GET',
    timestamp,
    originIp: '10.0.0.1',
    requestedId,
  };
}

function run(detector: SequenceScanDetector, ids: string[], totalDurationMs: number) {
  const stepMs = ids.length > 1 ? totalDurationMs / (ids.length - 1) : 0;
  const findings: ReturnType<SequenceScanDetector['analyze']> = [];
  ids.forEach((id, i) => {
    findings.push(...detector.analyze(entry(i, id, i * stepMs)));
  });
  return findings;
}

describe('SequenceScanDetector', () => {
  it('case 1: ids 1,2,3,4,5 requested over 3s emits an anomaly-sequence finding', () => {
    const detector = new SequenceScanDetector();
    const findings = run(detector, ['1', '2', '3', '4', '5'], 3_000);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ type: 'anomaly-sequence', severity: 'high' });
  });

  it('case 2: ids 1,5,12,3,8 requested over 3s emit no finding (not consecutive)', () => {
    const detector = new SequenceScanDetector();
    const findings = run(detector, ['1', '5', '12', '3', '8'], 3_000);
    expect(findings).toHaveLength(0);
  });

  it('case 3: ids 1,2,3,4,5 requested over 45s emit no finding (beyond maxWindowDurationMs)', () => {
    const detector = new SequenceScanDetector();
    const findings = run(detector, ['1', '2', '3', '4', '5'], 45_000);
    expect(findings).toHaveLength(0);
  });

  it('regression: duplicate ids interleaved in the window do not break the consecutive run', () => {
    // Discovered via load testing: concurrent traffic re-requesting the
    // same ids means the window often contains repeats. A naive
    // sorted-delta check treats a repeat (delta 0) as breaking the run,
    // so 5 distinct consecutive ids buried among duplicates never fired.
    const detector = new SequenceScanDetector();
    const findings = run(
      detector,
      ['10', '11', '10', '12', '11', '13', '12', '14', '13', '14'],
      3_000,
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).toMatchObject({ type: 'anomaly-sequence', severity: 'high' });
  });
});
