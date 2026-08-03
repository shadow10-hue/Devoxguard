# DevoxGuard — Anomaly Engine

Three independent behavioral detectors, combined into a single composite score. All state is in-memory only, per analyzer instance (see architecture.md §7 for the scaling implications).

## 1. EWMA frequency analyzer (`ewma-frequency.analyzer.ts`)

Tracks request inter-arrival times per `(userId, route)` key with an exponentially weighted moving average and variance, flagging intervals whose z-score exceeds `ANOMALY_CONFIG.ewma.zScoreThreshold` (default `3`).

**Deliberate deviation from the spec's literal pseudocode**: the pseudocode computes the z-score from the model *after* folding in the current interval (reusing the `ewma`/`variance` variable names post-update). This is mathematically self-limiting — the same deviation that produces the z-score's numerator also inflates the variance normalizing it, capping z-score at `sqrt((1-alpha)/alpha) ≈ 1.53` for `alpha=0.3`, for *any* single-step anomaly regardless of magnitude (verified by direct simulation, not just informally reasoned). That would make the detector permanently unable to cross a threshold of 3, contradicting the spec's own "sudden burst should be flagged" test case.

The implementation instead computes each z-score against the model's **pre-update** state (as it was before absorbing the current interval), then updates the model afterward. A short warm-up — the first two observed intervals only seed the model, no z-check — avoids dividing by a near-zero variance immediately after a key's first request.

| Scenario | Expected result |
|---|---|
| Regular traffic (20 requests, ~5s ± 0.5s apart) | No findings |
| Sudden burst after regular traffic (10 requests in ~1s) | `anomaly-frequency` finding(s) emitted |
| First request for a new user | No finding (not enough history) |

Severity: `high` if `zScore >= zScoreThreshold * 2`, else `medium`.

## 2. Sequence-scan detector (`sequence-scan.detector.ts`)

Flags IDOR-style enumeration: 5+ consecutive numeric resource ids (`ANOMALY_CONFIG.sequenceScan.minConsecutiveIds`) requested by the same user within 10 seconds (`maxWindowDurationMs`). The window is **per-user** (across whatever parameterized routes they hit, per the spec's pseudocode), holds the last 20 entries (`windowSize`), purged past 60 seconds regardless of window size.

Consecutive runs are found on the window's ids **sorted and deduplicated**, not on raw arrival order:

- *Sorted, not ascending-request-order*: a scanner that shuffles request order to evade naive sequential detection is still caught, since the check is "do 5 consecutive integers appear in the window," not "were they requested in order."
- *Deduplicated*: discovered via load testing — concurrent traffic naturally produces repeated ids in the window (e.g. 20 concurrent connections each re-requesting the same 5 ids). A naive sorted-delta check treats a repeat as breaking the run (delta `0`, not the required `+1`), which meant 5 genuinely-consecutive-but-duplicated ids in the window never registered as a run. The window is deduplicated by id (keeping the latest timestamp per id) before the consecutive-run check.

| Scenario | Expected result |
|---|---|
| Ids `1,2,3,4,5` requested over 3s | `anomaly-sequence` finding |
| Ids `1,5,12,3,8` requested over 3s | No finding (not consecutive) |
| Ids `1,2,3,4,5` requested over 45s | No finding (exceeds `maxWindowDurationMs`) |
| Ids `10,11,10,12,11,13,12,14,13,14` (duplicates interleaved) over 3s | `anomaly-sequence` finding (regression test for the dedup bug above) |

## 3. Origin-shift detector (`origin-shift.detector.ts`)

Flags rapid, repeated origin IP changes per user (a signal for session/credential sharing or hijacking): a shift is only suspicious if **another shift already happened** within `ANOMALY_CONFIG.originShift.minTimeBetweenShiftsMs` (120s) of it. The very first IP seen for a user, and the very first time it changes, are never flagged — there is nothing yet to call "rapid" against.

| Scenario | Expected result |
|---|---|
| Same IP on every request | No finding |
| A single IP change | No finding (first change, no prior baseline) |
| A second IP change within 120s of the first | `anomaly-origin` finding |
| A second IP change more than 120s after the first | No finding |

## 4. Composite scorer (`composite-scorer.ts`)

```
score = w_frequency * normalize(zScoreFrequency)
      + w_sequence  * (1 if sequenceDetected else 0)
      + w_origin    * (1 if originShiftDetected else 0)
```

Default weights (`ANOMALY_CONFIG.composite.weights`): `frequency=0.4, sequence=0.4, origin=0.2`. `normalizeZScore` maps a z-score to `[0, 1]` against the EWMA analyzer's own threshold: a z-score at or above the threshold maps to `1.0` (the frequency signal is already binary-anomalous at that point; further severity beyond the threshold doesn't inflate the composite score further).

`isCompositeAnomalyBlocking(score)` uses a **strict `>`** comparison against `blockThreshold` (default `0.7`) — a score exactly at the threshold does not trigger `rate-limit`.

**Calibration note**: `frequency` alone caps the composite score at `0.4`, always below `0.7`. Reaching the rate-limit threshold requires at least two corroborating signals (`frequency + sequence = 0.8`, or all three `= 1.0`; `frequency + origin = 0.6` alone is insufficient). This was confirmed empirically during load testing (`packages/api-demo/scripts/load-test.ts`): a pure high-frequency burst against a single fixed resource id never triggered rate-limiting, while the same burst spread across 5 consecutive owned ids (frequency + sequence-scan) did. This is treated as intentional calibration, not a bug — a single anomalous signal is inconclusive by design.

## 5. Synthetic data generator (`scripts/generate-logs.ts`)

A standalone script (no dependency on `@devox/engine`, runnable via `npm run generate-logs` from the repo root) producing synthetic traffic in four patterns used to validate the above thresholds during development: regular (steady rate with jitter), burst (regular baseline followed by a rapid cluster), sequential-id-scan, and origin-shift. It is intentionally decoupled from the engine package so it can run standalone for calibration/load-testing purposes without crossing the package's build boundary; the analyzers' own unit tests build small local fixtures using the same patterns rather than importing this script directly.
