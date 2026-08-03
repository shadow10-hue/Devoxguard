export type FindingType =
  | 'idor'
  | 'mass-assignment'
  | 'excessive-exposure'
  | 'anomaly-frequency'
  | 'anomaly-sequence'
  | 'anomaly-origin'
  | 'rule-triggered';

export type Severity = 'low' | 'medium' | 'high';

export interface Finding {
  id: string;
  requestId: string;
  type: FindingType;
  severity: Severity;
  route: string;
  method: string;
  userId: string | null;
  detail: string;
  ruleName?: string;
  /**
   * The detector/rule that produced this finding sets an initial value
   * reflecting what would happen if this finding alone decided the
   * outcome. DecisionEngine (guard/decision-engine.ts) recomputes the
   * final value for every finding of a request based on the actual
   * verdict before persistence.
   */
  actionTaken: 'blocked' | 'logged' | 'rate-limited';
  timestamp: number;
}
