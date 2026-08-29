import { v4 as uuidv4 } from 'uuid';
import { Detector } from './detector.interface';
import { RequestContext } from '../request-context';
import { Finding } from '../../storage/finding.schema';
import { findMongoOperatorKeys, JS_EXECUTION_OPERATORS } from './injection-scan.util';

/**
 * Flags MongoDB operator injection in request input (query, body).
 *
 * This is a *structural* check, not a pattern match: a field that should hold a
 * scalar but arrives as `{ $ne: null }`, `{ $gt: '' }`, `{ $regex: '.*' }`, or
 * `{ $where: '...' }` is operator injection. The DSL's `exists` operator takes
 * a fixed path and can't iterate keys, so this can't be a YAML rule — it's
 * wired live into the guard alongside the SQLi detector.
 *
 * Emits at most one finding per request. `$where`/`$function`/`$accumulator`/
 * `$expr` (server-side JS execution) are the highest-risk class; any other
 * `$`-prefixed key is still flagged. Tagged CWE-943 and `blocked`.
 */
export class NoSqlInjectionDetector implements Detector {
  readonly name = 'nosql-injection';

  constructor(private readonly enabled: boolean = true) {}

  detect(context: RequestContext): Finding[] {
    if (!this.enabled) return [];

    const scans = [
      findMongoOperatorKeys(context.query, 'query'),
      findMongoOperatorKeys(context.body, 'body'),
    ];

    // Fail closed: an input the bounded scan couldn't fully traverse could
    // hide an operator key in the unexamined part, so block instead of pass.
    if (scans.some((scan) => scan.truncated)) {
      return [
        {
          id: uuidv4(),
          requestId: context.requestId,
          type: 'scan-truncated',
          severity: 'high',
          route: context.route,
          method: context.method,
          userId: context.authenticatedUser?.id ?? null,
          detail: 'Request input too large/deep to scan fully for NoSQL operator injection — blocked (fail-closed)',
          matchedPattern: 'scan-truncated',
          cwe: 'CWE-943',
          actionTaken: 'blocked',
          timestamp: context.timestamp,
        },
      ];
    }

    const hits = scans.flatMap((scan) => scan.results);
    if (hits.length === 0) return [];

    // Prefer reporting a JS-execution operator if one is present — it's the
    // most severe and the most useful signal for the responder.
    const jsHit = hits.find((h) => JS_EXECUTION_OPERATORS.has(h.operator));
    const hit = jsHit ?? hits[0];

    return [
      {
        id: uuidv4(),
        requestId: context.requestId,
        type: 'nosql-injection',
        severity: 'high',
        route: context.route,
        method: context.method,
        userId: context.authenticatedUser?.id ?? null,
        detail: `Possible NoSQL operator injection: '${hit.operator}' in '${hit.path}'`,
        matchedPattern: hit.operator,
        cwe: 'CWE-943',
        actionTaken: 'blocked',
        timestamp: context.timestamp,
      },
    ];
  }
}
