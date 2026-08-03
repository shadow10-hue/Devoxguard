import { EwmaFrequencyAnalyzer } from './ewma-frequency.analyzer';
import { BehaviorLogEntry } from './behavior-log.schema';

function entry(index: number, timestamp: number, overrides: Partial<BehaviorLogEntry> = {}): BehaviorLogEntry {
  return {
    requestId: `req-${index}`,
    userId: 'user-1',
    route: '/orders/:id',
    method: 'GET',
    timestamp,
    originIp: '10.0.0.1',
    ...overrides,
  };
}

describe('EwmaFrequencyAnalyzer', () => {
  it('case 1: regular traffic (20 requests, ~5s +/- 0.5s apart) emits no findings', () => {
    const analyzer = new EwmaFrequencyAnalyzer();
    let t = 0;
    let findings = [] as ReturnType<EwmaFrequencyAnalyzer['analyze']>;

    for (let i = 0; i < 20; i += 1) {
      t += 5000 + (i % 2 === 0 ? 500 : -500);
      findings = findings.concat(analyzer.analyze(entry(i, t)));
    }

    expect(findings).toHaveLength(0);
  });

  it('case 2: a sudden burst after regular traffic emits an anomaly-frequency finding', () => {
    const analyzer = new EwmaFrequencyAnalyzer();
    let t = 0;
    const allFindings: ReturnType<EwmaFrequencyAnalyzer['analyze']> = [];

    for (let i = 0; i < 20; i += 1) {
      t += 5000 + (i % 2 === 0 ? 500 : -500);
      allFindings.push(...analyzer.analyze(entry(i, t)));
    }
    expect(allFindings).toHaveLength(0);

    // 10 requests crammed into ~1s right after 20 requests at ~5s intervals.
    for (let i = 0; i < 10; i += 1) {
      t += 111;
      allFindings.push(...analyzer.analyze(entry(20 + i, t)));
    }

    expect(allFindings.length).toBeGreaterThan(0);
    expect(allFindings[0].type).toBe('anomaly-frequency');
  });

  it('case 3: a single request for a new user has no history to compare against, so no finding', () => {
    const analyzer = new EwmaFrequencyAnalyzer();
    const findings = analyzer.analyze(entry(0, Date.now()));
    expect(findings).toHaveLength(0);
  });
});
