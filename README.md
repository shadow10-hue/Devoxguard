# DevoxGuard

A proprietary application-security engine (REST request analysis, a hand-rolled DSL rule engine, behavioral anomaly detection) packaged as a reusable NestJS module, with a Vue dashboard for operations.

See `docs/architecture.md`, `docs/dsl-spec.md`, and `docs/anomaly-engine.md` for technical documentation, and `docs/rapport-de-stage.md` / `docs/semaine{1..5}.md` for the internship report.

## Packages

- `packages/engine` — the installable `@devox/engine` NestJS package (rules, anomaly detection, guard, storage, internal dashboard API).
- `packages/api-demo` — a deliberately vulnerable demo API protected by the engine.
- `packages/dashboard` — the Vue 3 operator dashboard.

## Getting started

New to this project? **[CONTRIBUTING.md](./CONTRIBUTING.md)** walks through setup step by step with a checkpoint after each one, plus a troubleshooting section for the issues actually hit while building this. Quick version:

```bash
npm install                                    # installs all workspaces
docker compose -f docker-compose.dev.yml up -d # MongoDB (27017) + Elasticsearch (9200)

npm run build -w packages/engine               # required before api-demo can import it
npm run start:dev -w packages/api-demo         # boots the protected demo API on :3000
npm run dev -w packages/dashboard              # dashboard dev server
```

Set `DEVOXGUARD_API_KEY` (defaults to `dev-api-key` in `api-demo`'s `AppModule`) and point the dashboard's `VITE_DEVOXGUARD_API_KEY` / `VITE_API_BASE` env vars at it to authenticate against the internal `/devoxguard/api/*` endpoints.

## Testing

```bash
npm test                          # every workspace + the root scripts/ tests
npm run test:e2e -w packages/api-demo
npm run load-test -w packages/api-demo   # autocannon load test; requires Docker services running
```

Unit tests never require Docker. Integration tests that do (`packages/engine/test/integration/storage.integration.spec.ts`, the dashboard-wiring test) check reachability first and skip gracefully (pass, with a logged warning) when MongoDB/Elasticsearch aren't reachable on localhost.

## Engine dev workflow

`api-demo` imports `@devox/engine`'s **compiled** output (`dist/index.js`), so an engine source change requires `npm run build -w packages/engine` before restarting `api-demo`. For active development, run `npx tsc --watch` in `packages/engine` in one terminal and `npm run start:dev -w packages/api-demo` in another.
