# Working on DevoxGuard — setup guide

This walks through everything needed to get the full stack (engine + demo API + dashboard) running locally from a fresh clone, in order, with a checkpoint after each step so you know it worked before moving on.

## 1. Prerequisites

Install these before you start:

| Tool | Why | Verify with |
|---|---|---|
| [Node.js](https://nodejs.org/) 20+ (this project was built against 24) | runs everything | `node --version` |
| npm 10+ (ships with Node) | installs dependencies, drives the npm workspaces | `npm --version` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | runs MongoDB + Elasticsearch locally | `docker --version` and `docker compose version` |
| Git | obviously | `git --version` |

You do **not** need MongoDB or Elasticsearch installed natively — they run in Docker containers.

## 2. Clone and install

```bash
git clone https://github.com/shadow10-hue/Devoxguard.git
cd Devoxguard
npm install
```

This is an **npm workspaces monorepo** — one `npm install` at the root installs dependencies for all three packages (`packages/engine`, `packages/api-demo`, `packages/dashboard`) and symlinks `@devox/engine` into `api-demo`'s `node_modules` automatically.

**Checkpoint:** `npm ls @devox/engine -w packages/api-demo` should print something like:

```
api-demo@0.0.1 -> .\packages\api-demo
`-- @devox/engine@0.1.0 -> .\packages\engine
```

The `->` means it's a workspace symlink, not a real download.

## 3. Start the backing services

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts MongoDB (port 27017) and Elasticsearch (port 9200) with no auth, for local dev only.

**Checkpoint:** `docker compose -f docker-compose.dev.yml ps` should show both `devoxguard-mongo` and `devoxguard-elasticsearch` as `Up (healthy)`. The first run pulls the images, which can take a few minutes — subsequent runs are fast.

> Why this matters: `packages/api-demo`'s `AppModule` wires in the full `DevoxGuardModule`, which connects to MongoDB **at startup and fails closed** — if Mongo isn't reachable, `api-demo` won't boot at all. This is deliberate (see `docs/architecture.md` §5), not a bug. Elasticsearch is fail-*open* at startup by contrast, so a missing ES won't block booting, but findings won't be indexed there.

## 4. Build the engine

```bash
npm run build -w packages/engine
```

`packages/api-demo` imports `@devox/engine`'s **compiled** output (`dist/index.js`), not its TypeScript source — so this build step has to happen before `api-demo` can start, and again after any change to `packages/engine/src`.

**Checkpoint:** `packages/engine/dist/index.js` and `packages/engine/dist/rules/default-rules/*.yml` should both exist (the YAML rule files are copied by a post-build script, not compiled — if they're missing, `RuleLoader` will have nothing to load).

## 5. Run the demo API

```bash
npm run start:dev -w packages/api-demo
```

**Checkpoint:** the console should show NestJS mapping routes, ending in `Nest application successfully started`, and:

```bash
curl -H "Authorization: Bearer 2" http://localhost:3000/orders/1
```

should return `{"message":"Request blocked by DevoxGuard",...}` with HTTP 403 — that's the IDOR rule catching user 2 trying to read an order that belongs to user 1. If you instead get the order back unprotected, the engine isn't wired in correctly (check step 4).

The demo app seeds two fake users you can act as via `Authorization: Bearer <userId>`:

| User | Owns orders |
|---|---|
| `1` | `1, 2, 10, 11, 12, 13, 14` |
| `2` | `3` |

No real auth — this header is deliberately trivial, see `packages/api-demo/src/auth/fake-auth.middleware.ts`.

## 6. Run the dashboard

In a second terminal:

```bash
npm run dev -w packages/dashboard
```

By default it points at `http://localhost:3000` with API key `dev-api-key` (matching `api-demo`'s default). To point it elsewhere, set env vars before starting it:

```bash
# bash
VITE_API_BASE=http://localhost:3000 VITE_DEVOXGUARD_API_KEY=dev-api-key npm run dev -w packages/dashboard

# PowerShell
$env:VITE_API_BASE="http://localhost:3000"; $env:VITE_DEVOXGUARD_API_KEY="dev-api-key"; npm run dev -w packages/dashboard
```

**Checkpoint:** open `http://localhost:5173` — you should see the DevoxGuard header, and the Overview/Findings/Rules pages should load real data (not "Failed to load..."). If every page shows a load error, open the browser devtools Network tab — a `CORS` failure there usually means `api-demo` isn't running or is on a different port than `VITE_API_BASE` expects.

## 7. Verify everything end-to-end

```bash
curl -s -H "x-devoxguard-api-key: dev-api-key" http://localhost:3000/devoxguard/api/rules
```

should list the 4 default rules. Trigger a couple more findings and watch them show up live in the dashboard:

```bash
curl -H "Authorization: Bearer 1" http://localhost:3000/users/1/profile      # excessive-exposure (logged, still 200)
curl -X PATCH -H "Authorization: Bearer 1" -H "Content-Type: application/json" \
  -d '{"role":"admin"}' http://localhost:3000/users/1                        # mass-assignment (blocked, 403)
```

Refresh the dashboard's Findings page — both should appear.

## 8. Run the tests

```bash
npm test                                    # every workspace's unit tests + root scripts/ tests
npm run test:e2e -w packages/api-demo       # e2e tests for the demo API
npm run load-test -w packages/api-demo      # autocannon load test — needs Docker services running
```

`npm test` never needs Docker — the handful of tests that do exercise a real database (`packages/engine/test/integration/storage.integration.spec.ts`, `packages/api-demo/test/cors.e2e-spec.ts`) check reachability first and skip gracefully (pass with a logged warning) if Mongo/ES aren't up.

## Day-to-day dev loop

- **Changing `packages/engine` source**: run `npx tsc --watch` inside `packages/engine` in one terminal (keeps `dist/` rebuilt on every save), and restart `npm run start:dev -w packages/api-demo` in another whenever you want the running API to pick up the change (Nest's own `--watch` only watches `api-demo`'s own source, not the linked engine package).
- **Changing DSL rules** (`packages/engine/src/rules/default-rules/*.yml`): these hot-reload into a *running* `api-demo` without a restart — `RuleLoader` watches the directory. But if you change a rule after building, edit the file under `packages/engine/dist/rules/default-rules/` too (or rebuild), since that's what a running instance actually reads from.
- **Changing the dashboard**: Vite's dev server hot-reloads automatically — no rebuild step needed while `npm run dev` is running.
- **Changing anything under `packages/api-demo/src`**: `start:dev` already watches and restarts automatically.

## Troubleshooting

These are real issues hit while building this project — check here before spending time debugging from scratch.

**`api-demo` won't boot / hangs on startup.** Almost always MongoDB isn't reachable — check `docker compose -f docker-compose.dev.yml ps` shows it `healthy`, and that nothing else on your machine is using port 27017.

**Dashboard shows "Failed to load..." on every page.** Check the browser console/network tab first. Most likely causes: `api-demo` isn't running, `VITE_API_BASE` points at the wrong port, or the API key doesn't match (`DEVOXGUARD_API_KEY` env var on the API side vs `VITE_DEVOXGUARD_API_KEY` on the dashboard side — they must be equal; both default to `dev-api-key` if unset).

**A vulnerable request that should be blocked returns 200 unprotected.** Check `packages/engine/dist/` actually exists and is current (`npm run build -w packages/engine`) — `api-demo` imports the *compiled* engine, so a source-only change does nothing until rebuilt.

**Rules aren't loading / `RuleLoader` finds nothing.** The default rule YAML files live in `packages/engine/src/rules/default-rules/` but get *copied* (not compiled) into `dist/rules/default-rules/` by a post-build script (`scripts/copy-assets.js`) — if you only ran `tsc` directly instead of `npm run build`, that copy step was skipped.

**`npm test` fails in `packages/api-demo` with a TypeScript `rootDir`/`baseUrl` error.** This bit us once already — a root-level `typescript` devDependency version can get hoisted into `api-demo`'s `ts-jest` resolution and trip newer strict-mode errors against its Nest-CLI-generated `tsconfig.json`. `packages/api-demo/tsconfig.jest.json` exists specifically to isolate `ts-jest`'s needs from `tsconfig.build.json` (which `nest build` uses) — if you see this error, check nothing removed that file or the `"tsconfig"` override in `packages/api-demo/package.json`'s Jest config / `test/jest-e2e.json`.

**Windows-specific:** the project was built and tested on Windows (PowerShell + Git Bash). If a `npm run <script>` fails only in PowerShell with an env-var-related error, try the Git Bash equivalent (`VAR=value command` syntax) — some scripts assume a POSIX shell for inline env vars.

## Where to go next

- `docs/architecture.md` — full request pipeline, the interceptor-vs-guard design decision, fail-open/fail-closed policy, threshold calibration.
- `docs/dsl-spec.md` — the rule grammar and how to write new rules.
- `docs/anomaly-engine.md` — how the three behavioral detectors and the composite score work.
- `docs/semaine{1..5}.md` / `docs/rapport-de-stage.md` — a week-by-week build history (French), including every real bug found along the way and how it was fixed.
