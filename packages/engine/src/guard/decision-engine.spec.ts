import { DecisionEngine } from './decision-engine';
import { Finding } from '../storage/finding.schema';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    requestId: 'req-1',
    type: 'rule-triggered',
    severity: 'high',
    route: '/orders/:id',
    method: 'GET',
    userId: 'user-1',
    detail: 'test finding',
    actionTaken: 'logged',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('DecisionEngine.decide (truth table)', () => {
  const engine = new DecisionEngine();

  it('row 1: a blocking DSL rule finding decides "block" regardless of composite score', () => {
    const decision = engine.decide({
      findings: [finding({ actionTaken: 'blocked' })],
      compositeScore: 0,
    });
    expect(decision).toBe('block');
  });

  it('row 2: no blocking rule, composite score above threshold decides "rate-limit"', () => {
    const decision = engine.decide({
      findings: [finding({ actionTaken: 'logged' })],
      compositeScore: 0.8,
    });
    expect(decision).toBe('rate-limit');
  });

  it('row 3: no blocking rule, composite score at or below threshold decides "allow"', () => {
    const decision = engine.decide({
      findings: [finding({ actionTaken: 'logged' })],
      compositeScore: 0.7,
    });
    expect(decision).toBe('allow');
  });
});

describe('DecisionEngine.applyDecision', () => {
  const engine = new DecisionEngine();

  it('normalizes actionTaken to "blocked" for a block decision', () => {
    const [result] = engine.applyDecision([finding({ actionTaken: 'logged' })], 'block');
    expect(result.actionTaken).toBe('blocked');
  });

  it('normalizes actionTaken to "rate-limited" for a rate-limit decision', () => {
    const [result] = engine.applyDecision([finding({ actionTaken: 'blocked' })], 'rate-limit');
    expect(result.actionTaken).toBe('rate-limited');
  });

  it('normalizes actionTaken to "logged" for an allow decision', () => {
    const [result] = engine.applyDecision([finding({ actionTaken: 'blocked' })], 'allow');
    expect(result.actionTaken).toBe('logged');
  });
});
