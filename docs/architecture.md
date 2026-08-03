# DevoxGuard — Architecture

## 1. Pipeline overview

```
                        ┌──────────────────────────────────────────────┐
                        │              Host NestJS app                 │
                        │            (e.g. packages/api-demo)          │
                        └──────────────────────────────────────────────┘
 Incoming HTTP request
        │
        ▼
┌────────────────────────────┐   builds RequestContext (route pattern,
│ RequestAnalysisInterceptor │   params, query, body, headers,
│  (global, registered 1st)  │   authenticatedUser, originIp) and
└────────────────────────────┘   attaches it to req.devoxGuardContext
        │
        ▼
┌────────────────────────────┐   1. evaluate request-phase DSL rules
│    DevoxGuardInterceptor   │      (rules not referencing response.*)
│  (global, registered 2nd)  │   2. run EWMA frequency + sequence-scan +
│                             │      origin-shift analyzers, compute
│                             │      composite anomaly score
│                             │   3. DecisionEngine.decide() → block /
│                             │      rate-limit / allow (see §4)
└────────────────────────────┘
        │
        ├─ decision = block ─────────────► persist findings, throw
        │                                   ForbiddenException (403)
        │
        ├─ decision = rate-limit,
        │  token bucket exhausted ───────► persist findings, throw
        │                                   HttpException 429
        │
        └─ decision = allow, or
           rate-limit with capacity ─┐
                                      ▼
                        ┌────────────────────────────┐
                        │        Route handler        │  (controller)
                        └────────────────────────────┘
                                      │  response body
                                      ▼
                        ┌────────────────────────────┐   populates
                        │ ResponseAnalysisInterceptor │   ctx.responseBody
                        │ (global, registered 3rd)    │
                        └────────────────────────────┘
                                      │
                                      ▼
                        DevoxGuardInterceptor's tap():
                        evaluate response-phase DSL rules
                        (response.* conditions), normalize
                        actionTaken on all findings to match
                        the verdict, persist to Mongo + ES
                                      │
                                      ▼
                              Response sent to client
```

Findings are always persisted regardless of verdict — a `block` normalizes every finding of the request to `actionTaken: 'blocked'`, `rate-limit` to `'rate-limited'`, `allow` to `'logged'` (see `DecisionEngine.applyDecision`).

## 2. Interceptor registration order (why this isn't a literal `CanActivate` guard)

The spec names this component a "guard" and the folder is `guard/devoxguard.guard.ts`, but it is implemented as a `NestInterceptor` (`DevoxGuardInterceptor`), not a `CanActivate`. NestJS runs guards before any interceptor gets to build the `RequestContext`, and this component needs both request-phase access (to decide) and response-phase access (to run `response.*` rules and persist) — only an interceptor can see both ends of the pipeline via `next.handle()`.

`DevoxGuardModule.forRoot()` registers three `APP_INTERCEPTOR` providers, and their **array order matters**: NestJS runs global interceptors' pre-handler code in registration order and unwinds their post-handler code in reverse order (each interceptor's `next.handle()` wraps everything registered after it). Registering `[RequestAnalysisInterceptor, DevoxGuardInterceptor, ResponseAnalysisInterceptor]` in that exact order means:

- Pre-handler: `RequestAnalysisInterceptor` builds the context first, then `DevoxGuardInterceptor` reads it.
- Post-handler: `ResponseAnalysisInterceptor` (the most deeply nested, since it's registered last) populates `ctx.responseBody` first as the chain unwinds, so `DevoxGuardInterceptor`'s own `tap()` — which evaluates `response.*` rules — sees it already populated.

This was a real bug during integration (see §6): the module initially only registered `DevoxGuardInterceptor`, so `RequestAnalysisInterceptor` never ran and the pipeline always fell back to fail-open.

## 3. `response.*` condition mechanism

`RequestContext` has an optional `responseBody?: unknown` field, `undefined` until the route handler resolves. `ResponseAnalysisInterceptor` sets it from the handler's return value. The DSL evaluator's `resolvePath()` has a `root === 'response'` branch reading from `context.responseBody ?? {}`, so a rule like `response.passwordHash exists` naturally evaluates to `false` during the request phase (no response body yet) and correctly picks up the real value once the handler has run.

Response-phase rules can only use `action: journaliser` — `RuleLoader` rejects at load time any rule referencing `response.*` with `action: bloquer`, since blocking after the response has already been produced is architecturally meaningless (the client would need to receive a response to be told the response was blocked).

## 4. Decision truth table

| DSL rule with `action: bloquer` triggered | Composite anomaly score | Decision | `actionTaken` |
|---|---|---|---|
| Yes | (irrelevant) | `block` | `blocked` |
| No | `> 0.7` | `rate-limit` | `rate-limited` |
| No | `≤ 0.7` | `allow` | `logged` |

A finding has `actionTaken === 'blocked'` only when a triggered DSL rule's `action` was `bloquer` — anomaly detectors (EWMA frequency, sequence-scan, origin-shift) never set `blocked` on their own findings, only `logged`, so `DecisionEngine.decide()` can identify a blocking rule match with a simple predicate over the collected findings.

## 5. Fail-open vs fail-closed policy

Two different failure modes are handled differently, deliberately:

- **Engine logic errors during request processing** (rule evaluation, anomaly analysis, decision-making): **fail-open**. `DevoxGuardInterceptor.intercept()` wraps the whole pre-handler pipeline in a `catchError` that logs the error and calls `next.handle()` unmodified. Rationale: DevoxGuard is a bolt-on security layer; a bug in it must not turn into a self-inflicted denial-of-service on the host application. An attacker exploiting an engine bug to bypass detection is a real risk, but is judged less severe than DevoxGuard itself becoming the outage vector for the app it's supposed to protect. Mitigation: every fail-open path logs via `Logger.error`, which should be wired to alerting in a real deployment.
- **MongoDB connection at startup** (`DevoxGuardModule.forRoot()`'s `connectMongoFindings`): **fail-closed**. If Mongo is unreachable when the host app boots, the whole application fails to start. Rationale: unlike a transient per-request engine error, a broken persistence layer at startup means the security module would silently run "blind" (no findings ever recorded) for the app's entire lifetime — a real production deployment should fail loudly and be fixed, not run silently degraded.
- **Elasticsearch connection at startup**: **fail-open** (logged, host app still boots). Rationale: Elasticsearch is a secondary index for search/analytics on top of the MongoDB source of truth; its unavailability shouldn't block the app from starting when Mongo (the durable store) is fine.
- **Persistence at request time** (`insertMany`/`indexMany` failing for an individual request, e.g. a schema validation error): logged and swallowed, never surfaced to the client. The decision has already been made and the response already sent by the time persistence runs in `DevoxGuardInterceptor`'s `tap()`; a storage hiccup must not retroactively change the response the client already received.

## 6. Threshold calibration

All thresholds live in `packages/engine/src/anomaly/anomaly.config.ts`, set to the exact example values from the spec:

- `ewma.alpha = 0.3`, `ewma.zScoreThreshold = 3`
- `sequenceScan.windowSize = 20`, `minConsecutiveIds = 5`, `maxWindowDurationMs = 10_000`
- `originShift.minTimeBetweenShiftsMs = 120_000`
- `composite.weights = { frequency: 0.4, sequence: 0.4, origin: 0.2 }`, `blockThreshold = 0.7`

These were validated against `scripts/generate-logs.ts`'s synthetic patterns (regular/burst/sequential/origin-shift) during unit testing, and against a real `autocannon` load test (`packages/api-demo/scripts/load-test.ts`) against the full stack with Docker-hosted MongoDB + Elasticsearch. Two calibration findings from that process:

- **Composite weights require multi-signal correlation to reach the block threshold.** `frequency` alone caps the composite score at `0.4 * 1.0 = 0.4`, always below `0.7` — a pure rate spike, with no sequence-scan or origin-shift corroborating it, can never trigger `rate-limit` on its own. Only `frequency + sequence` (`0.8`), `frequency + origin` is insufficient at `0.6`, or all three (`1.0`) cross the threshold. This is a deliberate consequence of the given weights, not a bug — a single anomalous signal is treated as inconclusive; the composite score is calibrated to require corroboration.
- **The EWMA z-score formula from the spec's literal pseudocode is mathematically incapable of ever exceeding a threshold of 3.** Computing the z-score from the *post-update* ewma/variance (as the pseudocode's variable-reuse literally implies) is self-limiting: the same deviation that produces the z-score's numerator also inflates the variance normalizing it, capping z-score at `sqrt((1-alpha)/alpha) ≈ 1.53` for `alpha=0.3`, for any single-step anomaly, regardless of magnitude (proven by direct simulation before implementing). `ewma-frequency.analyzer.ts` instead computes each z-score against the *pre-update* model (the state as it was before absorbing the current interval), with a short warm-up (first two intervals only seed the model, no z-check) to avoid dividing by a near-zero variance right after a key's first request. This satisfies the spec's own test table (a sudden burst after regular traffic should be flagged) where the literal formula cannot.

## 7. Known limitations

- **Anomaly engine state is in-memory only**, keyed per analyzer-instance (a single Node process). It is not persisted or shared across horizontally-scaled instances of the host app, and resets on restart. A multi-instance deployment would need a shared store (e.g. Redis) for the EWMA/sequence/origin-shift state to remain consistent across instances — out of scope for this implementation.
- **The stats/overview anomaly score trend (`AnomalyScoreTrendTracker`) is also in-memory only**, a rolling buffer capped at 500 samples per process, for the same reason.
- **IDOR detection assumes numeric resource ids.** Both the `idor-orders` rule's `not in` check and the sequence-scan detector's consecutive-run logic work on arrays/numeric deltas; a UUID-keyed resource would need a different rule (an ownership-list `in`/`not in` check still works for the DSL rule, but the sequence-scan detector specifically would need reconfiguration or a different detector for non-numeric enumeration patterns).
- **The DSL grammar is intentionally minimal**: single comparisons/exists/in checks per rule, no boolean composition (`and`/`or`) between multiple conditions in one rule. Multi-condition policies require multiple separate rules.
- **The internal dashboard API's auth is a single static API key**, proportionate to a demo/stage project — not a general-purpose auth system (no per-user permissions, no key rotation, no rate limiting on the key itself).
- **`RuleLoader.watch()`'s hot-reload is debounced but not atomic**: a rule file mid-write (e.g. a large multi-rule YAML file being saved in chunks by an editor) could theoretically be read in a partially-written state, causing a transient reload failure that's logged and ignored (the previous rule set stays active until the next successful reload) rather than causing a crash.
