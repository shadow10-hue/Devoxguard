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
`.gitleaks.toml` rule, or `.zap/rules.tsv` line) in the same PR.

| # | Weakness | Location | Rationale |
|---|---|---|---|
| AR-1 | Fake bearer auth (`Authorization: Bearer <userId>`, no signature) | `packages/api-demo/src/auth/fake-auth.middleware.ts` | Demo-only: gives the engine identity context without a real IdP. |
| AR-2 | Mass assignment via `Object.assign` with no allow-list | `packages/api-demo/src/users/users.service.ts` | Intentional vulnerability the engine's mass-assignment detector must catch at runtime. |
| AR-3 | `passwordHash` returned by the profile endpoint | `packages/api-demo/src/users/users.service.ts` | Intentional vulnerability for the excessive-exposure detector. |
| AR-4 | Permissive CORS (`origin: true`) | `packages/api-demo/src/main.ts` | Required so the local dashboard (any dev port) can call the API; regression-tested in `cors.e2e-spec.ts`. Not for production. |
| AR-5 | Default API key literal `dev-api-key` | `packages/api-demo/src/app.module.ts`, `scripts/load-test.ts`, `test/cors.e2e-spec.ts`, `CONTRIBUTING.md` | Development fallback only. Production deployments MUST set `DEVOXGUARD_API_KEY`. Allowlisted in `.gitleaks.toml` by exact literal + path. |
| AR-6 | Dashboard API key baked into the built JS bundle (`VITE_DEVOXGUARD_API_KEY`) | `packages/dashboard/src/api/devoxguard-client.ts` | Vite inlines `VITE_*` at build time. Accepted for the demo; a production dashboard must authenticate via a backend session, never a bundled key. |
| AR-7 | Non-constant-time API key comparison | `packages/engine/src/guard/internal-api-key.guard.ts` | Documented limitation (`docs/architecture.md` §7); timing-oracle risk accepted for an internal dashboard API on a trusted network. |

## Supply-chain and pipeline security

- CI enforces SAST (CodeQL + Semgrep), SCA (OSV-Scanner + `npm audit`),
  secret scanning (Gitleaks, full history), container scanning (Trivy) and
  DAST (OWASP ZAP) — see `docs/devsecops.md`.
- Releases publish SBOMs (Syft) and are signed with Cosign keyless (GitHub
  OIDC); images carry SLSA build provenance attestations.
- New scanner suppressions require an entry in the table above and a
  justification in the PR description.
