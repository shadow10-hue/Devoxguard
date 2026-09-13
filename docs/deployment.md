# Deployment — single VM

This is the runbook for running the full stack (Mongo, Elasticsearch,
api-demo, dashboard, Caddy) on one server via `docker-compose.prod.yml`.
It's a single-instance deployment — see [Known limitations](#known-limitations-not-addressed-here)
for what this intentionally doesn't cover.

## Prerequisites

- A VM with Docker Engine + the Compose plugin installed (`docker compose version`).
- A domain name with a DNS **A record already pointing at the VM's public
  IP**. Caddy uses this to obtain a Let's Encrypt certificate automatically —
  there's no manual cert step, but the DNS has to resolve *before* you start
  the stack, or certificate issuance will fail.
- Inbound TCP 80 and 443 open in whatever firewall/security group sits in
  front of the VM. Port 80 is required even though everything is served over
  HTTPS — Caddy uses it for the ACME HTTP-01 challenge and to redirect
  plain-HTTP requests to HTTPS.

Nothing else needs to be publicly reachable: Mongo, Elasticsearch, and
api-demo are only reachable from other containers on the compose network
(api-demo also binds to `127.0.0.1:3000` for local debugging from the VM
itself — never exposed externally).

## First deploy

```bash
git clone <this-repo> devoxguard && cd devoxguard
cp .env.example .env
```

Edit `.env`:

| Variable | Required value |
|---|---|
| `DEVOXGUARD_API_KEY` | Random, ≥16 chars — e.g. `openssl rand -hex 32`. The app refuses to boot in production without this set to something other than the documented dev default (`packages/api-demo/src/config/env.ts`). |
| `DOMAIN` | The domain from the prerequisites above. |
| `ACME_EMAIL` | An address Let's Encrypt can send expiry/problem notices to. |
| `DASHBOARD_AUTH_USER` / `DASHBOARD_AUTH_HASH` | Basic-auth credentials for the TLS edge — **required**. The dashboard and the internal API are only reachable after this login (the API key is injected server-side, so an unauthenticated edge would expose the internal API to the internet). Caddy refuses to start without a hash. Generate: `docker run --rm caddy:2-alpine caddy hash-password --plaintext '…'`. |
| everything else | Leave as the `.env.example` defaults — they're the service DNS names `docker-compose.prod.yml` already expects. |

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First run also builds the `api-demo` and `dashboard` images (a few minutes).
Compose brings services up in dependency order — Mongo and Elasticsearch
first, then `api-demo` (gated on both being healthy), then `dashboard`
(gated on `api-demo`), then Caddy.

## Verifying it worked

```bash
docker compose -f docker-compose.prod.yml ps          # everything should say "healthy"
curl -i https://$DOMAIN/devoxguard/health              # {"status":"ok","checks":{"mongo":true,"elasticsearch":true}}
docker compose -f docker-compose.prod.yml logs caddy | grep "certificate obtained"
```

Open `https://<your-domain>/` in a browser — you should see the dashboard,
and the Findings/Rules/Overview tabs should load real data (this exercises
the full chain: Caddy terminates TLS, nginx serves the SPA and reverse-proxies
`/devoxguard/api/*` to `api-demo` with the API key injected server-side —
the key is never sent to the browser).

If `checks.elasticsearch` is `false` but `status` is still `"ok"`, that's
the documented fail-open policy for ES (`docs/architecture.md` §5) — search
indexing is degraded but the app is otherwise fine. If the health check
returns `503`, Mongo is unreachable — that's fail-closed by design and
needs fixing before anything else works.

## Rotating the API key

```bash
# edit DEVOXGUARD_API_KEY in .env, then:
docker compose -f docker-compose.prod.yml up -d --force-recreate api-demo dashboard
```

Both services must be recreated together — `api-demo` validates the new key,
`dashboard`'s nginx needs the matching value to keep proxying successfully.

## Updating

Two options.

**Build from source (simplest, no registry):**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Compose only recreates containers whose image or config actually changed.

**Pull the signed release images (recommended for production):**

Tagging `v*` runs `release.yml`, which Trivy-gates, pushes, and Cosign-signs
the `api-demo`/`dashboard` images to GHCR. Deploy those instead of building on
the VM by layering `docker-compose.deploy.yml` (which swaps each `build:` for an
`image:`) over the base file:

```bash
# Verify the signature first (proves the image came from our release pipeline),
# then pin the exact digest you verified:
cosign verify \
  --certificate-identity-regexp '^https://github.com/<owner>/<repo>/.github/workflows/release.yml@refs/tags/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/<owner>/devoxguard-api-demo:<version>

export API_IMAGE=ghcr.io/<owner>/devoxguard-api-demo@sha256:<digest>
export DASH_IMAGE=ghcr.io/<owner>/devoxguard-dashboard@sha256:<digest>
docker compose -f docker-compose.prod.yml -f docker-compose.deploy.yml pull
docker compose -f docker-compose.prod.yml -f docker-compose.deploy.yml up -d
```

The `cd.yml` workflow automates exactly this (verify → Trivy re-scan → smoke
test → deploy) and can drive it over SSH once a target is configured — see the
`deploy` job and `ansible/` for provisioning. `mongo`, `elasticsearch`, `redis`,
and `caddy` are unaffected; only the two application images switch to pull-based.

## Troubleshooting

- **Caddy never gets a certificate** — almost always DNS: confirm `dig
  $DOMAIN` resolves to the VM's public IP, and that port 80 is actually
  reachable from the internet (not just open in `iptables` but also any
  cloud-provider security group in front of it).
- **`docker compose ps` shows `mongo`/`elasticsearch` unhealthy** — check
  `docker compose logs mongo` / `logs elasticsearch`; usually a resource
  constraint (Elasticsearch's `ES_JAVA_OPTS=-Xms512m -Xmx512m` needs that
  much RAM headroom free).
- **`api-demo` restarts in a loop** — check `docker compose logs api-demo`
  first for an env-validation failure (missing/insecure
  `DEVOXGUARD_API_KEY` prints a clear `[env] ...` message and exits before
  anything else starts); if it's connecting-to-Mongo errors instead, the
  app retries a few times before giving up (see
  `packages/engine/src/storage/mongo.repository.ts`) — repeated failures
  past that point mean Mongo itself isn't healthy.
- **Dashboard loads but shows no data / requests fail** — check
  `DEVOXGUARD_API_KEY` matches between the `dashboard` and `api-demo`
  containers' environments (`docker compose config` prints the resolved
  values); a mismatch here 401s every dashboard request.

## Known limitations (not addressed here)

Intentionally out of scope for this single-VM setup — tracked, not
forgotten:

- **No horizontal scaling in this compose file.** `docker-compose.prod.yml`
  still runs a single `api-demo` replica. `DEVOXGUARD_REDIS_URI` (set by
  default in `.env.example`, backed by the `redis` service in this file)
  removes the underlying blocker — the anomaly engine's EWMA/sequence/
  origin-shift state is shared via Redis instead of held in-process — but
  actually running multiple `api-demo` replicas behind a load balancer
  isn't wired into this compose file. The trend tracker
  (`AnomalyScoreTrendTracker`) is a separate, still in-memory-only,
  smaller limitation — see `docs/architecture.md` §7.
- **Single static API key**, not per-user auth, for the internal dashboard
  API. Hardened (constant-time comparison, brute-force throttling — see
  `.github/SECURITY.md` AR-7) but still one shared secret. Public exposure is
  gated by basic auth at the Caddy edge (`DASHBOARD_AUTH_*`), so the
  key-injecting proxy is never reachable unauthenticated; for a real
  deployment, front it with SSO/OIDC instead of shared basic-auth creds.
- **No structured/JSON logging or tracing.** NestJS's default console
  logger only; nothing ships logs anywhere. A Prometheus-format
  `/devoxguard/metrics` endpoint does exist (API-key protected, same as
  the findings/rules/stats endpoints) — nothing scrapes it by default in
  this compose file.
- **DSL rules have no `and`/`or` composition** and the sequence-scan
  detector assumes numeric resource IDs — see `docs/architecture.md` §7
  for the full list of engine-level known limitations.
