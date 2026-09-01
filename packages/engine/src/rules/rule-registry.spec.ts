import { RuleRegistry } from './rule-registry';
import { CompiledRule } from './rule.types';

function rule(nom: string, overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    nom,
    route: '/orders/:id',
    methode: 'GET',
    conditionAst: { kind: 'exists', path: { kind: 'path', segments: ['body', 'role'] } },
    action: 'bloquer',
    severite: 'high',
    raw: 'body.role exists',
    ...overrides,
  };
}

/** References response.* so it partitions into responsePhase. */
function responseRule(nom: string, overrides: Partial<CompiledRule> = {}): CompiledRule {
  return rule(nom, {
    action: 'journaliser',
    conditionAst: { kind: 'exists', path: { kind: 'path', segments: ['response', 'passwordHash'] } },
    raw: 'response.passwordHash exists',
    ...overrides,
  });
}

describe('RuleRegistry', () => {
  it('starts with the initial rules given at construction', () => {
    const registry = new RuleRegistry([rule('a')]);
    expect(registry.getRules().map((r) => r.nom)).toEqual(['a']);
  });

  it('setRules replaces the live rule set', () => {
    const registry = new RuleRegistry([rule('a')]);
    registry.setRules([rule('b'), rule('c')]);
    expect(registry.getRules().map((r) => r.nom)).toEqual(['b', 'c']);
  });

  it('defaults to an empty array when constructed with no rules', () => {
    const registry = new RuleRegistry();
    expect(registry.getRules()).toEqual([]);
  });

  describe('getRulesFor', () => {
    it('partitions rules for a route into request-phase and response-phase buckets', () => {
      const reqRule = rule('req-phase');
      const resRule = responseRule('res-phase');
      const registry = new RuleRegistry([reqRule, resRule]);

      const { requestPhase, responsePhase } = registry.getRulesFor('GET', '/orders/:id');

      expect(requestPhase.map((r) => r.nom)).toEqual(['req-phase']);
      expect(responsePhase.map((r) => r.nom)).toEqual(['res-phase']);
    });

    it('indexes a mixed request/response condition into the response-phase bucket', () => {
      const mixedRule = rule('mixed', {
        action: 'journaliser',
        conditionAst: {
          kind: 'and',
          left: { kind: 'exists', path: { kind: 'path', segments: ['body', 'role'] } },
          right: { kind: 'exists', path: { kind: 'path', segments: ['response', 'passwordHash'] } },
        },
        raw: 'body.role exists and response.passwordHash exists',
      });
      const registry = new RuleRegistry([mixedRule]);

      const { requestPhase, responsePhase } = registry.getRulesFor('GET', '/orders/:id');

      expect(requestPhase).toHaveLength(0);
      expect(responsePhase.map((r) => r.nom)).toEqual(['mixed']);
    });

    it('is case-insensitive on method', () => {
      const registry = new RuleRegistry([rule('a')]);
      expect(registry.getRulesFor('get', '/orders/:id').requestPhase).toHaveLength(1);
    });

    it('returns empty request/response buckets for an unmatched method+route pair', () => {
      const registry = new RuleRegistry([rule('a')]);
      expect(registry.getRulesFor('POST', '/orders/:id')).toEqual({ requestPhase: [], responsePhase: [] });
      expect(registry.getRulesFor('GET', '/users/:id')).toEqual({ requestPhase: [], responsePhase: [] });
    });

    it('only returns rules matching the given route, not the full rule set (proves indexing, not a full scan)', () => {
      const ordersRule = rule('orders-rule', { route: '/orders/:id' });
      const usersRule = rule('users-rule', { route: '/users/:id', methode: 'GET' });
      const reviewsRule = rule('reviews-rule', { route: '/reviews/:id', methode: 'POST' });
      const registry = new RuleRegistry([ordersRule, usersRule, reviewsRule]);

      const { requestPhase } = registry.getRulesFor('GET', '/orders/:id');

      expect(requestPhase).toHaveLength(1);
      expect(requestPhase[0].nom).toBe('orders-rule');
    });

    it('rebuilds the index when setRules is called, dropping stale entries', () => {
      const registry = new RuleRegistry([rule('old', { route: '/orders/:id' })]);
      expect(registry.getRulesFor('GET', '/orders/:id').requestPhase).toHaveLength(1);

      registry.setRules([rule('new', { route: '/users/:id' })]);

      expect(registry.getRulesFor('GET', '/orders/:id')).toEqual({ requestPhase: [], responsePhase: [] });
      expect(registry.getRulesFor('GET', '/users/:id').requestPhase.map((r) => r.nom)).toEqual(['new']);
    });
  });
});
