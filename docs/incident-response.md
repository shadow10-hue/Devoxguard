# Incident-response playbook

What to do when DevoxGuard reports an attack — and what it does automatically
before a human is in the loop. Scope: the DevoxGuard-protected api-demo stack
(`docs/deployment.md`). Companion to `docs/injection-detection.md` (how
detection works) and `docs/devsecops.md` (the pipeline).

## What runs automatically

Two automated responses fire without human involvement; both are opt-in via
`DevoxGuardModule.forRoot` config and off by default.

| Response | Trigger | Effect | Config |
|---|---|---|---|
| **Alerting** (`src/alerting/alert-notifier.ts`) | Any **blocked**, high-severity finding | Fire-and-forget POST to a webhook (Slack-compatible JSON) summarizing the finding — type, severity, CWE, route, origin IP, request id. Never includes the raw attack payload. | `alerting: { webhookUrl, minSeverity? }` |
| **IP auto-containment** (`src/alerting/ip-containment.ts`) | An origin IP trips the injection detectors `threshold` times within `windowMs` | The IP is banned for `banMs`; every subsequent request from it is rejected with a `403` and an `auto-contained` finding, before any rule or handler runs. Redis-backed when configured, so the ban is shared across all workers/instances. | `autoContainment: { enabled: true, threshold?, windowMs?, banMs? }` |

Both fail **safe** for availability: an alerting failure never affects the
request path, and a Redis outage makes containment fail *open* (it stops
banning rather than start blocking legitimate traffic).

Example wiring (api-demo `app.module.ts`):

```ts
DevoxGuardModule.forRoot({
  // …existing config…
  alerting: { webhookUrl: process.env.DEVOXGUARD_ALERT_WEBHOOK },
  autoContainment: { enabled: true, threshold: 5, windowMs: 60_000, banMs: 300_000 },
});
```

Metric-based alerting is also available: `security/prometheus/rules.yml` alerts
on sustained/spiking block rates and on the metrics endpoint going dark, using
`devoxguard_findings_total` from `GET /devoxguard/metrics`.

## When an alert fires — the runbook

### 1. Triage (is it real?)

- Open the dashboard **Findings** tab, or query Mongo/Elasticsearch directly:
  ```bash
  # Blocked injection findings in the last hour, newest first
  docker compose -f docker-compose.prod.yml exec mongo mongosh devoxguard --quiet --eval '
    db.findings.find(
      { type: { $in: ["sql-injection","nosql-injection"] }, actionTaken: "blocked",
        timestamp: { $gte: Date.now() - 3600e3 } }
    ).sort({ timestamp: -1 }).limit(50).forEach(f => printjson({t:f.type, ip:f.requestContext?.originIp, route:f.route, pat:f.matchedPattern, ts:f.timestamp}))'
  ```
- Distinguish the two common cases:
  - **Real attack** — many findings from one or few IPs, varied payloads, often
    scanning multiple routes. Auto-containment should already be banning them.
  - **False positive / bad deploy** — findings from legitimate client IPs on a
    normal route right after a release. If so, jump to §4.

### 2. Contain

- Confirm auto-containment is active (`autoContainment.enabled`) and catching
  the offenders (`auto-contained` findings appear for the IP).
- For an IP not yet auto-banned, or to block at the edge, add a deny rule at
  Caddy (edge) — see `caddy/Caddyfile` — and reload:
  ```bash
  docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```
- If a specific vulnerable endpoint is under active exploitation and non-
  essential, disable its module in api-demo and redeploy.

### 3. Eradicate & recover

- The engine blocks the exploit, but confirm no earlier request **succeeded**
  before detection was enabled/tuned (check for `actionTaken: "logged"` or
  pre-deploy timestamps on the same route/IP).
- Rotate any secret that a successful pre-block request could have exposed
  (e.g. an `apiToken` from the demo accounts) — see "Rotating the API key" in
  `docs/deployment.md` for the pattern.
- Once the source is contained and traffic normal, bans lapse automatically
  after `banMs`; no manual unban is needed.

### 4. If it's a false positive

- Verify against the detector docs (`docs/injection-detection.md`) — is the
  blocked input actually a legitimate value that resembles a signature?
- Tune rather than disable: prefer narrowing the specific pattern. Disabling all
  injection detection (`injectionDetection: { enabled: false }`) is a last
  resort and must be tracked as an accepted risk in `.github/SECURITY.md`.
- Add a regression test (an e2e like `test/injection-blocked.e2e-spec.ts`) that
  asserts the legitimate input is allowed, so the fix can't regress.

### 5. Post-incident

- Record timeline, blast radius, and root cause.
- If detection missed something, add a signature/structural check plus a test.
- If containment thresholds were wrong (too slow, or false-positive bans),
  adjust `threshold`/`windowMs`/`banMs`.
