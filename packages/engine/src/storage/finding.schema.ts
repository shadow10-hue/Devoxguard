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

/**
 * MongoDB $jsonSchema validator for the `findings` collection (spec
 * section 6.1). Deliberately does NOT set `additionalProperties: false`
 * — this is the minimum required shape, not an exhaustive one, which is
 * what lets mongo.repository.ts store the associated RequestContext as
 * an extra `requestContext` field alongside these validated fields.
 */
export const FINDING_COLLECTION_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['id', 'requestId', 'type', 'severity', 'route', 'method', 'actionTaken', 'timestamp'],
    properties: {
      id: { bsonType: 'string' },
      requestId: { bsonType: 'string' },
      type: {
        enum: [
          'idor',
          'mass-assignment',
          'excessive-exposure',
          'anomaly-frequency',
          'anomaly-sequence',
          'anomaly-origin',
          'rule-triggered',
        ],
      },
      severity: { enum: ['low', 'medium', 'high'] },
      route: { bsonType: 'string' },
      method: { bsonType: 'string' },
      userId: { bsonType: ['string', 'null'] },
      detail: { bsonType: 'string' },
      ruleName: { bsonType: ['string', 'null'] },
      actionTaken: { enum: ['blocked', 'logged', 'rate-limited'] },
      timestamp: { bsonType: 'long' },
    },
  },
} as const;
