import * as path from 'path';
import { IdorDetector } from '../../src/analysis/detectors/idor.detector';
import { MassAssignmentDetector } from '../../src/analysis/detectors/mass-assignment.detector';
import { ExcessiveExposureDetector } from '../../src/analysis/detectors/excessive-exposure.detector';
import { RequestContext } from '../../src/analysis/request-context';
import { RuleLoader } from '../../src/rules/rule-loader';
import { evaluateRules } from '../../src/rules/rule-evaluator';

const DEFAULT_RULES_DIR = path.join(__dirname, '../../src/rules/default-rules');

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/orders/:id',
    method: 'GET',
    params: { id: '3' },
    query: {},
    body: null,
    headers: {},
    authenticatedUser: { id: 'user-1', ownedResourceIds: { orders: ['1', '2'] } },
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('pipeline parity: hardcoded detectors vs default YAML rules', () => {
  const rules = new RuleLoader().loadFromDirectory(DEFAULT_RULES_DIR);

  it('idor: both paths agree on severity and actionTaken for an unowned order', () => {
    const ctx = baseContext();

    const detectorFindings = new IdorDetector().detect(ctx);
    const ruleFindings = evaluateRules(rules, ctx);

    expect(detectorFindings).toHaveLength(1);
    expect(ruleFindings.filter((f) => f.ruleName === 'idor-orders')).toHaveLength(1);
    expect(detectorFindings[0].severity).toBe(ruleFindings[0].severity);
    expect(detectorFindings[0].actionTaken).toBe(ruleFindings[0].actionTaken);
  });

  it('idor: both paths agree there is no finding for an owned order', () => {
    const ctx = baseContext({ params: { id: '1' } });

    expect(new IdorDetector().detect(ctx)).toHaveLength(0);
    expect(evaluateRules(rules, ctx).filter((f) => f.ruleName === 'idor-orders')).toHaveLength(0);
  });

  it('mass-assignment: both paths agree on severity and actionTaken for an injected role', () => {
    const ctx = baseContext({ route: '/users/:id', method: 'PATCH', params: { id: '1' }, body: { role: 'admin' } });

    const detectorFindings = new MassAssignmentDetector().detect(ctx);
    const ruleFindings = evaluateRules(rules, ctx).filter((f) => f.ruleName === 'mass-assignment-users-role');

    expect(detectorFindings).toHaveLength(1);
    expect(ruleFindings).toHaveLength(1);
    expect(detectorFindings[0].severity).toBe(ruleFindings[0].severity);
    expect(detectorFindings[0].actionTaken).toBe(ruleFindings[0].actionTaken);
  });

  it('excessive-exposure: both paths agree on severity and actionTaken when passwordHash leaks', () => {
    const ctx = baseContext({
      route: '/users/:id/profile',
      method: 'GET',
      params: { id: '1' },
      responseBody: { id: '1', passwordHash: 'hash-abc' },
    });

    const detectorFindings = new ExcessiveExposureDetector().detect(ctx, ctx.responseBody);
    const ruleFindings = evaluateRules(rules, ctx).filter((f) => f.ruleName === 'excessive-exposure-passwordHash');

    expect(detectorFindings).toHaveLength(1);
    expect(ruleFindings).toHaveLength(1);
    expect(detectorFindings[0].severity).toBe(ruleFindings[0].severity);
    expect(detectorFindings[0].actionTaken).toBe(ruleFindings[0].actionTaken);
    expect(detectorFindings[0].actionTaken).toBe('logged');
  });
});
