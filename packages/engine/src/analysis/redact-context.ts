import { RequestContext } from './request-context';

/**
 * Redacts credential-bearing material out of a RequestContext before it is
 * persisted with a finding (mongo.repository.ts / elasticsearch.indexer.ts)
 * and later served through the dashboard API.
 *
 * Findings need the *shape* of an offending request (which fields, which
 * paths, which headers were present) to be useful for triage — not the raw
 * secrets. Previously the whole context was stored verbatim, so a stored
 * finding for e.g. `POST /account/login` carried the plaintext password, and
 * any finding carried the caller's `Authorization`/`Cookie` headers. Anyone
 * able to read findings then harvested those. This scrubs them at the single
 * persistence choke point, so both the list and detail endpoints only ever
 * return redacted context.
 */

const REDACTED = '[REDACTED]';

/** Headers whose values are credentials/session material — never persisted. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-devoxguard-api-key',
  'x-api-key',
]);

/** Object keys whose values are treated as secrets wherever they appear in query/params/body. */
const SENSITIVE_KEY = /pass|pwd|secret|token|apikey|api[-_]?key|authorization|credential|session/i;

function redactHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Recursively masks the values of sensitive-looking keys. Bounded the same
 * way the injection scanners are so a hostile shape can't turn redaction into
 * unbounded work.
 */
function redactValue(node: unknown, depth: number): unknown {
  if (depth > 12) return node;
  if (Array.isArray(node)) return node.map((item) => redactValue(item, depth + 1));
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(value, depth + 1);
    }
    return out;
  }
  return node;
}

function redactStringMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : value;
  }
  return out;
}

export function redactRequestContext(ctx: RequestContext): RequestContext {
  return {
    ...ctx,
    headers: redactHeaders(ctx.headers),
    query: redactStringMap(ctx.query),
    params: redactStringMap(ctx.params),
    body: (ctx.body === null ? null : (redactValue(ctx.body, 0) as Record<string, unknown>)),
  };
}
