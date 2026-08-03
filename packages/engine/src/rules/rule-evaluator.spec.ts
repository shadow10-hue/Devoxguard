import { parse } from './dsl/parser';
import { tokenize } from './dsl/tokenizer';
import { evaluateRules } from './rule-evaluator';
import { CompiledRule } from './rule.types';
import { RequestContext } from '../analysis/request-context';

function compiledRule(overrides: Partial<CompiledRule> & { condition: string }): CompiledRule {
  const { condition, ...rest } = overrides;
  return {
    nom: 'test-rule',
    route: '/orders/:id',
    methode: 'GET',
    conditionAst: parse(tokenize(condition)),
    action: 'bloquer',
    severite: 'high',
    raw: condition,
    ...rest,
  };
}

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

describe('evaluateRules', () => {
  it('emits a rule-triggered finding when a rule matches route, method, and condition', () => {
    const rule = compiledRule({ condition: 'params.id not in user.ownedResourceIds.orders' });
    const findings = evaluateRules([rule], baseContext());

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'rule-triggered',
      ruleName: 'test-rule',
      severity: 'high',
      actionTaken: 'blocked',
    });
  });

  it('emits nothing when the route does not match', () => {
    const rule = compiledRule({ route: '/reviews', condition: 'params.id not in user.ownedResourceIds.orders' });
    expect(evaluateRules([rule], baseContext())).toHaveLength(0);
  });

  it('emits nothing when the condition does not hold', () => {
    const rule = compiledRule({ condition: 'params.id not in user.ownedResourceIds.orders' });
    expect(evaluateRules([rule], baseContext({ params: { id: '1' } }))).toHaveLength(0);
  });

  it('maps action "journaliser" to actionTaken "logged"', () => {
    const rule = compiledRule({
      action: 'journaliser',
      condition: 'params.id not in user.ownedResourceIds.orders',
    });
    const findings = evaluateRules([rule], baseContext());
    expect(findings[0].actionTaken).toBe('logged');
  });
});
