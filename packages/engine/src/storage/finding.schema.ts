export type FindingType =
  | 'idor'
  | 'mass-assignment'
  | 'excessive-exposure'
  | 'anomaly-frequency'
  | 'anomaly-sequence'
  | 'anomaly-origin'
  | 'rule-triggered'
  | 'sql-injection'
  | 'nosql-injection'
  | 'scan-truncated'
  | 'auto-contained';

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
   * Injection detectors (analysis/detectors/{sql,nosql}-injection.detector.ts)
   * set these. `matchedPattern` identifies what fired — a fixed signature id
   * for SQLi (e.g. `union-select`), or the offending MongoDB operator key for
   * NoSQLi (e.g. `$ne`); `detail` may also name the field path (e.g.
   * `body.email.$ne`). Neither ever carries the raw attacker *value*, so an
   * attack string is not echoed into logs/ES — though the NoSQLi operator/path
   * is by nature request-derived. `cwe` tags the weakness class (CWE-89 for
   * SQLi, CWE-943 for NoSQLi). Absent on every other finding type.
   */
  matchedPattern?: string;
  cwe?: string;
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
          'sql-injection',
          'nosql-injection',
          'scan-truncated',
          'auto-contained',
        ],
      },
      severity: { enum: ['low', 'medium', 'high'] },
      route: { bsonType: 'string' },
      method: { bsonType: 'string' },
      userId: { bsonType: ['string', 'null'] },
      detail: { bsonType: 'string' },
      ruleName: { bsonType: ['string', 'null'] },
      matchedPattern: { bsonType: ['string', 'null'] },
      cwe: { bsonType: ['string', 'null'] },
      actionTaken: { enum: ['blocked', 'logged', 'rate-limited'] },
      timestamp: { bsonType: 'long' },
      /**
       * Retention-only field, set at insert time (mongo.repository.ts's
       * insertMany) to `now + retentionMs`, paired with a TTL index on
       * this same field. Not in `required` above: it doesn't exist on
       * documents written before this field was introduced, and Mongo's
       * TTL monitor simply never expires a document lacking it — the
       * safe default (no silent mass-deletion of pre-existing data).
       * Deliberately separate from `timestamp` (BSON long, needed for
       * the range queries in findPage/countBlockedSince) since Mongo's
       * TTL index requires an actual BSON date field, not an epoch-ms
       * long.
       */
      expiresAt: { bsonType: 'date' },
    },
  },
} as const;
