import { RuleRegistry } from './rule-registry';
import { CompiledRule } from './rule.types';

function rule(nom: string): CompiledRule {
  return {
    nom,
    route: '/orders/:id',
    methode: 'GET',
    conditionAst: { kind: 'exists', path: { kind: 'path', segments: ['body', 'role'] } },
    action: 'bloquer',
    severite: 'high',
    raw: 'body.role exists',
  };
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
});
