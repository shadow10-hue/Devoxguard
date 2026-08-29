import { referencesResponse } from './rule-loader';
import { CompiledRule } from './rule.types';

export interface RulesForRoute {
  requestPhase: CompiledRule[];
  responsePhase: CompiledRule[];
}

const EMPTY_RULES_FOR_ROUTE: RulesForRoute = { requestPhase: [], responsePhase: [] };

function indexKey(methode: string, route: string): string {
  return `${methode.toUpperCase()} ${route}`;
}

/**
 * Holds the currently-loaded CompiledRule[] as a mutable, injectable
 * singleton — RuleLoader.watch() calls setRules() on hot-reload, and
 * both the guard and RulesController read the live reference via
 * getRules() rather than a snapshot taken at startup.
 *
 * setRules() also builds a route+method index (getRulesFor), computing
 * each rule's request-phase/response-phase split once here instead of
 * on every request — the guard used to linearly scan every rule and
 * recompute referencesResponse() per rule per request regardless of
 * how many rules actually apply to the route being hit.
 */
export class RuleRegistry {
  private rules: CompiledRule[];
  private index: Map<string, RulesForRoute>;

  constructor(initialRules: CompiledRule[] = []) {
    this.rules = [];
    this.index = new Map();
    this.setRules(initialRules);
  }

  getRules(): CompiledRule[] {
    return this.rules;
  }

  getRulesFor(methode: string, route: string): RulesForRoute {
    return this.index.get(indexKey(methode, route)) ?? EMPTY_RULES_FOR_ROUTE;
  }

  setRules(rules: CompiledRule[]): void {
    this.rules = rules;

    const index = new Map<string, RulesForRoute>();
    for (const rule of rules) {
      const key = indexKey(rule.methode, rule.route);
      let entry = index.get(key);
      if (!entry) {
        entry = { requestPhase: [], responsePhase: [] };
        index.set(key, entry);
      }
      (referencesResponse(rule.conditionAst) ? entry.responsePhase : entry.requestPhase).push(rule);
    }
    this.index = index;
  }
}
