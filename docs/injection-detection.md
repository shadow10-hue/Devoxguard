# Injection detection (SQLi / NoSQLi)

DevoxGuard detects SQL- and NoSQL-injection attempts in request input and
**blocks** them before the protected handler runs. This document explains why
these detectors live outside the DSL rule engine, how they work, and how to
tune or disable them.

## Why not a DSL rule?

The rule DSL (`docs/dsl-spec.md`) is deliberately minimal: the only operators
are `==`, `!=`, `in`, `not in`, and `exists`, values are literals, and each rule
is a single comparison against a fixed path (`body|params|query|user|response`).
It has no regex, no substring match, no boolean composition, and no way to
iterate the keys of an object. Injection detection needs exactly those things —
pattern matching for SQLi and key-shape inspection for NoSQLi — so it can't be
expressed as YAML rules without expanding the grammar (and handing rule authors
a regex engine, i.e. a ReDoS surface).

Instead the detectors implement the existing `Detector` interface
(`packages/engine/src/analysis/detectors/detector.interface.ts`):

```ts
interface Detector {
  readonly name: string;
  detect(context: RequestContext, responseBody?: unknown): Finding[];
}
```

They are wired live into the guard's request phase
(`guard/devoxguard.guard.ts`), running after rule evaluation and before the
decision. Because a detector can emit a finding with `actionTaken: 'blocked'`,
an injection attempt becomes a `403` via the normal decision path
(`guard/decision-engine.ts`). Unlike the DSL rules, the detectors are
**route-agnostic** — an injection payload is malicious on any endpoint.

## SQL injection — `SqlInjectionDetector`

Signature-based. It collects every string leaf from `query`, `params`, and
`body` (traversal bounded by depth, node count, and string length — see
`injection-scan.util.ts`) and matches each against a fixed set of anchored,
linear-time patterns:

| Signature id | Catches |
|---|---|
| `boolean-tautology` | `OR 1=1`, `or '1'='1` |
| `string-tautology` | `or 'a'='a` |
| `union-select` | `UNION SELECT`, `UNION ALL SELECT` |
| `stacked-query` | `; DROP TABLE`, `; DELETE …` |
| `comment-breakout` | `admin'--`, `1')#` |
| `time-based` | `SLEEP(…)`, `BENCHMARK(…)`, `WAITFOR DELAY` |
| `system-probe` | `information_schema`, `xp_cmdshell`, `INTO OUTFILE` |

Patterns are fixed in code, never supplied at runtime, and use bounded
quantifiers only — an attacker cannot craft input that stalls the match.
Findings are tagged **CWE-89**; the raw payload is never stored (only the
signature id and the field path, in `matchedPattern` / `detail`).

## NoSQL injection — `NoSqlInjectionDetector`

Structural, not pattern-based. MongoDB operator injection happens when a field
that should hold a scalar instead arrives as an object with operator keys —
`{ "$ne": null }` to bypass an equality check, `{ "$gt": "" }`, `{ "$regex":
".*" }`, or `{ "$where": "…" }` / `{ "$function": … }` for server-side JS
execution. Express' extended query parser produces the same shape from
`?email[$ne]=` query strings.

The detector walks `query` and `body` and flags any key beginning with `$` (the
same signal `express-mongo-sanitize` uses). `$where`, `$function`,
`$accumulator`, and `$expr` — the JS-execution class — are preferred in the
report when present. Findings are tagged **CWE-943**.

## Configuration

Both detectors are on by default. Disable them via `DevoxGuardModule.forRoot`:

```ts
DevoxGuardModule.forRoot({
  // …
  injectionDetection: { enabled: false },
});
```

Disabling is useful for characterizing the unprotected app in a test — see the
`api-demo` injection e2e specs, which prove the demo endpoints are genuinely
exploitable when the engine is absent and blocked when it isn't.

## Finding storage

`sql-injection` and `nosql-injection` are added to the `FindingType` union and
the Mongo `$jsonSchema` validator enum (`storage/finding.schema.ts` — both must
change together or inserts fail validation silently). The extra
`matchedPattern` and `cwe` fields are indexed in Elasticsearch
(`storage/elasticsearch.indexer.ts`) so findings can be filtered by weakness
class.
