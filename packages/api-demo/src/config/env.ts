import { z } from 'zod';

const INSECURE_DEV_API_KEY = 'dev-api-key';

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DEVOXGUARD_MONGO_URI: z
      .string()
      .min(1)
      .default('mongodb://localhost:27017'),
    DEVOXGUARD_MONGO_DB: z.string().min(1).default('devoxguard'),
    DEVOXGUARD_ES_NODE: z.string().min(1).default('http://localhost:9200'),
    // Optional, deliberately no default: unset means the engine falls
    // back to in-memory anomaly-detector state unchanged (see
    // DevoxGuardConfig.redisUrl in packages/engine).
    DEVOXGUARD_REDIS_URI: z.string().min(1).optional(),
    DEVOXGUARD_API_KEY: z.string().default(INSECURE_DEV_API_KEY),
    // Incident-response (docs/incident-response.md). Both optional/off by
    // default: a webhook URL enables outbound alerting; the flag enables IP
    // auto-containment. Left off in dev/CI so repeated test payloads from
    // localhost don't self-ban.
    DEVOXGUARD_ALERT_WEBHOOK: z.string().url().optional(),
    DEVOXGUARD_AUTO_CONTAIN: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // The demo app's OWN datastore (separate database from the engine's
    // findings store, though it may point at the same MongoDB instance).
    // Backs the deliberately NoSQLi-vulnerable /account/login endpoint.
    APP_MONGO_URI: z.string().min(1).default('mongodb://localhost:27017'),
    APP_MONGO_DB: z.string().min(1).default('api-demo'),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV !== 'production') return;

    // Checked against the raw env var, not `val` — zod's .default() has
    // already backfilled val.DEVOXGUARD_API_KEY by this point, so the raw
    // value is the only way to tell "unset" apart from "set to the same
    // string the default happens to use".
    if (!process.env.DEVOXGUARD_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEVOXGUARD_API_KEY'],
        message:
          'must be set explicitly in production (unset — refusing to boot with the dev fallback)',
      });
      return;
    }
    if (
      val.DEVOXGUARD_API_KEY === INSECURE_DEV_API_KEY ||
      val.DEVOXGUARD_API_KEY.length < 16
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEVOXGUARD_API_KEY'],
        message:
          'must be a random value of at least 16 characters, not the documented dev default (openssl rand -hex 32)',
      });
    }
  });

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`[env] ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
