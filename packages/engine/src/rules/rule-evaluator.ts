import { v4 as uuidv4 } from 'uuid';
import { evaluate } from './dsl/evaluator';
import { CompiledRule } from './rule.types';
import { RequestContext } from '../analysis/request-context';
import { Finding } from '../storage/finding.schema';

/**
 * Matches a request against every compiled DSL rule and returns one
 * Finding per triggered rule. Request-phase rules (idor, mass-assignment)
 * and response-phase rules (excessive-exposure) both go through this
 * same path — a response-phase rule simply won't match until
 * context.responseBody has been populated by ResponseAnalysisInterceptor.
 */
export function evaluateRules(rules: CompiledRule[], context: RequestContext): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (rule.route !== context.route) continue;
    if (rule.methode.toUpperCase() !== context.method) continue;
    if (!evaluate(rule.conditionAst, context)) continue;

    findings.push({
      id: uuidv4(),
      requestId: context.requestId,
      type: 'rule-triggered',
      severity: rule.severite,
      route: context.route,
      method: context.method,
      userId: context.authenticatedUser?.id ?? null,
      detail: `Rule '${rule.nom}' matched: ${rule.raw}`,
      ruleName: rule.nom,
      actionTaken: rule.action === 'bloquer' ? 'blocked' : 'logged',
      timestamp: context.timestamp,
    });
  }

  return findings;
}
