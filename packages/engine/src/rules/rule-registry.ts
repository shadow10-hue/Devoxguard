import { CompiledRule } from './rule.types';

/**
 * Holds the currently-loaded CompiledRule[] as a mutable, injectable
 * singleton — RuleLoader.watch() calls setRules() on hot-reload, and
 * both the guard and RulesController read the live reference via
 * getRules() rather than a snapshot taken at startup.
 */
export class RuleRegistry {
  private rules: CompiledRule[];

  constructor(initialRules: CompiledRule[] = []) {
    this.rules = initialRules;
  }

  getRules(): CompiledRule[] {
    return this.rules;
  }

  setRules(rules: CompiledRule[]): void {
    this.rules = rules;
  }
}
