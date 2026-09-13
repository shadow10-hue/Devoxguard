import { v4 as uuidv4 } from 'uuid';
import { Detector } from './detector.interface';
import { RequestContext } from '../request-context';
import { Finding } from '../../storage/finding.schema';
import { collectStrings } from './injection-scan.util';

/**
 * Curated SQL-injection signatures. Every pattern is anchored/bounded (no
 * unbounded `.*` before a required token, no nested quantifiers) so a rule
 * author can't accidentally introduce ReDoS and an attacker can't craft input
 * that stalls the match — the patterns are fixed here, never supplied at
 * runtime. Chosen to catch the classic payload families while staying quiet on
 * ordinary text: each requires a SQL keyword or metacharacter in a
 * syntactically suspicious position, not merely the presence of the word "or".
 */
const SQL_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  // ' OR 1=1 / or '1'='1 / OR 1 = 1 — boolean tautology used to bypass filters.
  { id: 'boolean-tautology', re: /\b(or|and)\b\s+['"]?\d{1,6}['"]?\s*=\s*['"]?\d{1,6}/i },
  // or 'a'='a — string-literal tautology.
  { id: 'string-tautology', re: /\b(or|and)\b\s+['"][^'"]{0,32}['"]\s*=\s*['"]/i },
  // UNION SELECT (optionally UNION ALL SELECT) — column exfiltration.
  { id: 'union-select', re: /\bunion\b(\s+all)?\s+\bselect\b/i },
  // ; DROP TABLE / ; DELETE / stacked DDL/DML.
  { id: 'stacked-query', re: /;\s*(drop|delete|update|insert|alter|create|truncate|grant|exec)\b/i },
  // admin'-- / 1')# — quote breakout immediately followed by an inline comment.
  { id: 'comment-breakout', re: /['")]\s*(--|#)/ },
  // Time-based blind: SLEEP(5), BENCHMARK(...), PG_SLEEP(...), WAITFOR DELAY.
  { id: 'time-based', re: /\b(sleep|benchmark|pg_sleep)\s*\(|\bwaitfor\s+delay\b/i },
  // Schema/OS-command probing common to SQLi.
  { id: 'system-probe', re: /\b(xp_cmdshell|information_schema|sysobjects|load_file|into\s+outfile)\b/i },
];

/**
 * Flags SQL-injection payloads in request input (query, route params, body).
 *
 * Unlike the IDOR/mass-assignment example detectors, this one is wired live
 * into the guard (see devoxguard.guard.ts / devoxguard.module.ts): the DSL's
 * grammar (`== != in exists`, no regex) can't express pattern matching, so
 * injection detection lives here rather than in a YAML rule. Route-agnostic by
 * design — an injection attempt is malicious on any endpoint.
 *
 * Emits at most one finding per request (the first pattern that fires), tagged
 * CWE-89 and `blocked`, so the decision engine turns it into a 403 before the
 * vulnerable handler runs.
 */
export class SqlInjectionDetector implements Detector {
  readonly name = 'sql-injection';

  constructor(private readonly enabled: boolean = true) {}

  detect(context: RequestContext): Finding[] {
    if (!this.enabled) return [];

    const scans = [
      collectStrings(context.query, 'query'),
      collectStrings(context.params, 'params'),
      collectStrings(context.body, 'body'),
    ];

    // Fail closed: if the bounded scan couldn't examine the whole input
    // (abusive padding / deep nesting), block rather than pass — an
    // unexamined subtree could hide the payload.
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
          detail: 'Request input too large/deep to scan fully for SQL injection — blocked (fail-closed)',
          matchedPattern: 'scan-truncated',
          cwe: 'CWE-89',
          actionTaken: 'blocked',
          timestamp: context.timestamp,
        },
      ];
    }

    const candidates = scans.flatMap((scan) => scan.results);

    for (const { path, value } of candidates) {
      for (const pattern of SQL_PATTERNS) {
        if (pattern.re.test(value)) {
          return [
            {
              id: uuidv4(),
              requestId: context.requestId,
              type: 'sql-injection',
              severity: 'high',
              route: context.route,
              method: context.method,
              userId: context.authenticatedUser?.id ?? null,
              detail: `Possible SQL injection in '${path}' (signature: ${pattern.id})`,
              matchedPattern: pattern.id,
              cwe: 'CWE-89',
              actionTaken: 'blocked',
              timestamp: context.timestamp,
            },
          ];
        }
      }
    }

    return [];
  }
}
