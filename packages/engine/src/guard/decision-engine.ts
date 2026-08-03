import { ANOMALY_CONFIG } from '../anomaly/anomaly.config';
import { Finding } from '../storage/finding.schema';

export type Decision = 'allow' | 'block' | 'rate-limit';

export interface DecisionInput {
  findings: Finding[];
  compositeScore: number;
}

/**
 * Truth table (spec section 8):
 *   DSL rule with action:bloquer triggered -> block, regardless of anomaly score
 *   no blocking rule, composite score > threshold -> rate-limit
 *   no blocking rule, composite score <= threshold -> allow
 *
 * A finding has actionTaken === 'blocked' only when a DSL rule with
 * action:bloquer matched (see rule-evaluator.ts) — anomaly detectors
 * never set 'blocked' on their own findings, only 'logged'.
 */
export class DecisionEngine {
  decide(input: DecisionInput): Decision {
    const hasBlockingRule = input.findings.some((f) => f.actionTaken === 'blocked');
    if (hasBlockingRule) return 'block';

    if (input.compositeScore > ANOMALY_CONFIG.composite.blockThreshold) return 'rate-limit';

    return 'allow';
  }

  /**
   * Normalizes actionTaken across every finding of a request to match
   * the final verdict, overriding whatever each detector/rule set
   * initially (see Finding.actionTaken doc comment in finding.schema.ts).
   */
  applyDecision(findings: Finding[], decision: Decision): Finding[] {
    const actionTaken = decision === 'block' ? 'blocked' : decision === 'rate-limit' ? 'rate-limited' : 'logged';
    return findings.map((f) => ({ ...f, actionTaken }));
  }
}
