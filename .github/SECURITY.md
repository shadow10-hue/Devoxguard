# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead:

1. Use GitHub's [private vulnerability reporting](https://github.com/shadow10-hue/Devoxguard/security/advisories/new) on this repository, or
2. Email the maintainer listed in [CODEOWNERS](./CODEOWNERS).

You can expect an acknowledgement within 7 days. Please include reproduction
steps and the affected package (`engine`, `api-demo`, or `dashboard`).

## Scope

| Package | In scope? | Notes |
|---|---|---|
| `packages/engine` | **Yes** | The product. Any bypass of the guard, DSL evaluator, or anomaly engine is a valid finding. |
| `packages/dashboard` | **Yes** | Operator UI. |
| `packages/api-demo` | **No (mostly)** | Intentionally vulnerable demo target — see the risk register below. Findings *about the intentional vulnerabilities* are not accepted; findings that let api-demo compromise the host or the engine are. |

## Accepted-risk register

These weaknesses are **known, intentional or accepted**, and are suppressed in
the security pipeline with per-finding justifications. Removing an entry here
requires removing the matching suppression (`nosemgrep` comment,
`security/gitleaks/gitleaks.toml` rule, or `security/zap/rules.tsv` line) in
the same PR.

| # | Weakness | Location | Rationale |
|---|---|---|---|
| AR-1 | Fake bearer auth (`Authorization: Bearer <userId>`, no signature) | `packages/api-demo/src/auth/fake-auth.middleware.ts` | Demo-only: gives the engine identity context without a real IdP. |
| AR-2 | Mass assignment via `Object.assign` with no allow-list | `packages/api-demo/src/users/users.service.ts` | Intentional vulnerability the engine's mass-assignment detector must catch at runtime. |
| AR-3 | `passwordHash` returned by the profile endpoint | `packages/api-demo/src/users/users.service.ts` | Intentional vulnerability for the excessive-exposure detector. |
| AR-4 | Permissive CORS (`origin: true`) | `packages/api-demo/src/main.ts` | Required so the local dashboard (any dev port) can call the API; regression-tested in `cors.e2e-spec.ts`. Not for production. |
| AR-5 | Default API key literal `dev-api-key` | `packages/api-demo/src/app.module.ts`, `scripts/load-test.ts`, `test/cors.e2e-spec.ts`, `CONTRIBUTING.md` | Development fallback only. Production deployments MUST set `DEVOXGUARD_API_KEY`. Allowlisted in `security/gitleaks/gitleaks.toml` by exact literal + path. |
| ~~AR-6~~ | ~~Dashboard API key baked into the built JS bundle (`VITE_DEVOXGUARD_API_KEY`)~~ | `packages/dashboard/src/api/devoxguard-client.ts`, `packages/dashboard/nginx.conf.template` | **Resolved**: the SPA is now same-origin and reads no key from the bundle; nginx reverse-proxies `/devoxguard/api/*` and injects the key server-side at container start (dev uses vite's `server.proxy` with a Node-side-only key). The TLS edge (`caddy/Caddyfile`) additionally requires **basic auth** in front of the dashboard/API, so the key-injecting proxy is never reachable unauthenticated from the internet (`DASHBOARD_AUTH_*`; Caddy fails closed if no hash is set). Kept struck-through rather than deleted, to preserve the accepted-then-fixed history. |
| ~~AR-7~~ | ~~Non-constant-time API key comparison~~ | `packages/engine/src/guard/internal-api-key.guard.ts` | **Resolved**: comparison is now `crypto.timingSafeEqual` over SHA-256 digests of both sides, plus a dedicated rate limiter throttling repeated failed attempts. Kept in this table (struck through) rather than deleted, so the history of what was accepted-then-fixed stays visible. |
| AR-8 | SQL injection via string-concatenated query | `packages/api-demo/src/products/products.service.ts` | Intentional vulnerability for the engine's `SqlInjectionDetector` (CWE-89). The demo endpoint (`GET /products/search`) is genuinely exploitable when the engine is absent — see `test/products.e2e-spec.ts`; the guard blocks it in `test/injection-blocked.e2e-spec.ts`. |
| AR-9 | NoSQL (MongoDB) operator injection via untrusted query filter | `packages/api-demo/src/accounts/accounts.service.ts` | Intentional vulnerability for the engine's `NoSqlInjectionDetector` (CWE-943). `POST /account/login` passes the raw body into `findOne`, exploitable via `{ "$ne": … }` when unprotected (`test/accounts.e2e-spec.ts`); blocked by the guard in `test/injection-blocked.e2e-spec.ts`. |

## Supply-chain and pipeline security

- CI enforces SAST (CodeQL + Semgrep), SCA (OSV-Scanner + `npm audit`),
  secret scanning (Gitleaks, full history), container scanning (Trivy) and
  DAST (OWASP ZAP) — see `docs/devsecops.md`.
- Releases publish SBOMs (Syft) and are signed with Cosign keyless (GitHub
  OIDC); images carry SLSA build provenance attestations.
- New scanner suppressions require an entry in the table above and a
  justification in the PR description.
