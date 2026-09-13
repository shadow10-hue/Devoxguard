import { AlertNotifierConfig } from './alerting/alert-notifier';
import { IpContainmentConfig } from './alerting/ip-containment';

export interface DevoxGuardConfig {
  mongoUri: string;
  mongoDbName: string;
  elasticsearchNode: string;
  /** Checked against the x-devoxguard-api-key header on internal dashboard endpoints. */
  apiKey: string;
  rulesDirectory: string;
  tokenBucket: {
    capacity: number;
    refillRatePerSec: number;
  };
  /** Dedicated brute-force limiter for InternalApiKeyGuard — separate bucket from `tokenBucket` above, which guards the anomaly-detection decision pipeline instead. */
  authRateLimiter: {
    capacity: number;
    refillRatePerSec: number;
  };
  /** How long a finding stays in Mongo before its TTL index expires it. Optional, defaults to 90 days (see mongo.repository.ts's DEFAULT_RETENTION_DAYS) — a policy decision the host app should be able to override, like tokenBucket/authRateLimiter above. */
  findingsRetentionDays?: number;
  /**
   * Moves the anomaly-detection engine's state (EWMA frequency,
   * sequence-scan, origin-shift) from in-memory Maps into Redis, shared
   * across every instance pointed at the same URL — required for
   * horizontal scaling / safe multi-process clustering (see
   * docs/architecture.md known limitations). Optional: when unset, the
   * analyzers fall back to their original in-memory behavior unchanged,
   * matching this project's fail-open philosophy (no Redis configured
   * isn't a broken state, just a degraded/single-instance one).
   */
  redisUrl?: string;
  /**
   * Content-based injection detection (SQLi via signature patterns, NoSQLi via
   * MongoDB-operator structural checks — see analysis/detectors/). Enabled by
   * default; set `enabled: false` to disable, e.g. to characterize the
   * unprotected app in a test. Route-agnostic: runs on every request's input.
   */
  injectionDetection?: {
    enabled?: boolean;
  };
  /**
   * Automated incident response (see docs/incident-response.md). Both parts are
   * optional and opt-in: `alerting` fires an outbound webhook on blocked
   * high-severity findings; `autoContainment` temporarily bans IPs that
   * repeatedly trip the injection detectors. Absent/disabled → the engine
   * behaves exactly as before.
   */
  alerting?: AlertNotifierConfig;
  autoContainment?: IpContainmentConfig;
}

export const DEVOXGUARD_CONFIG = 'DEVOXGUARD_CONFIG';

export const DEFAULT_DEVOXGUARD_CONFIG: Omit<DevoxGuardConfig, 'rulesDirectory' | 'apiKey'> = {
  mongoUri: 'mongodb://localhost:27017',
  mongoDbName: 'devoxguard',
  elasticsearchNode: 'http://localhost:9200',
  tokenBucket: { capacity: 20, refillRatePerSec: 2 },
  authRateLimiter: { capacity: 10, refillRatePerSec: 0.2 },
};
