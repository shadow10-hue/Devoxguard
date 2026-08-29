# DevSecOps Pipeline

This document describes DevoxGuard's secure development lifecycle: the
automation that runs at each stage, the gates that block a change, the
suppression policy, and how each control maps to international standards
(NIST SSDF SP 800-218, SLSA v1.0, OWASP SAMM / ASVS / Top 10).

Everything runs on free/open-source tooling — no SaaS accounts or API tokens.

## Lifecycle overview

```
 developer machine          pull request                    main / release
┌──────────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐
│ husky pre-commit │   │ ci.yml                  │   │ release.yml (v* tags) │
│  · lint-staged   │──▶│  · lint / typecheck     │──▶│  · build images       │
│  · gitleaks      │   │  · gitleaks (history)   │   │  · Trivy gate         │
│    (staged)      │   │  · OSV-Scanner + audit  │   │  · push to GHCR       │
└──────────────────┘   │  · Semgrep OSS          │   │  · Syft SBOM          │
                       │  · build + tests w/     │   │  · Cosign keyless     │
                       │    real Mongo + ES      │   │  · SLSA provenance    │
                       │  · Docker build + Trivy │   └───────────────────────┘
                       │ codeql.yml (SAST)       │   ┌───────────────────────┐
                       │ dast.yml (api-demo PRs) │   │ dast.yml (weekly ZAP) │
                       └─────────────────────────┘   └───────────────────────┘
```

## Workflows

| Workflow | Triggers | Jobs / gates |
|---|---|---|
| `ci.yml` | PRs, push to `main` | `lint` (ESLint check-only, Prettier, `tsc --noEmit`), `secrets` (Gitleaks full history), `sca` (OSV-Scanner on lockfile + `npm audit --audit-level=high`), `semgrep` (OSS rulesets, `--error`), `iac` (`ansible-lint` + `--syntax-check` of the Ansible playbooks), `build-test` (engine → api-demo → dashboard build, all test suites against real Mongo 7 + Elasticsearch 8.15 service containers, `DEVOX_REQUIRE_SERVICES=1` so tests fail loudly instead of self-skipping), `docker` (image builds + Trivy image & config scans — the config scan covers Dockerfiles, all compose files, and workflows) |
| `codeql.yml` | PRs, push to `main`, weekly | CodeQL `javascript-typescript` with `security-extended` queries |
| `release.yml` | tags `v*` | Build → Trivy gate → push to GHCR → Syft SBOM (SPDX + CycloneDX, attached to the GitHub Release) → Cosign keyless signing → build-provenance attestation |
| `cd.yml` | release published, manual | Continuous deployment: resolve digests → **Cosign verify** both images against `release.yml`'s OIDC identity → Trivy re-scan the pulled image → bring the stack up on a disposable runner target and smoke-test it (health + benign 200 + injection **403**) → deploy over SSH (dormant until `DEPLOY_ENABLED` + `DEPLOY_*` secrets are set). Uses `docker-compose.deploy.yml` to run the signed images instead of building from source. |
| `dast.yml` | weekly, manual, PRs touching `packages/api-demo/**` | Boots Mongo, starts seeded api-demo, OWASP ZAP baseline scan gated by `security/zap/rules.tsv` |

All jobs are **fail-closed**: a scanner error or finding fails the check.
Every third-party action is **pinned to a full commit SHA** with the version
noted in a comment. Workflows declare **least-privilege `permissions:`**
blocks (default `contents: read`; `security-events: write` only for SARIF
upload; `id-token`/`packages`/`attestations: write` only in `release.yml`).

## Suppression policy (curated, auditable)

The demo API is *deliberately* vulnerable — the engine exists to catch those
attacks at runtime. Scanners therefore need suppressions, and each one must
be traceable:

| Mechanism | File | Rule |
|---|---|---|
| Semgrep | inline `// nosemgrep: <rule-id>` + justification comment | one per finding, never per-directory |
| CodeQL | inline `// codeql[<query-id>]` alert suppression | same |
| Gitleaks | `security/gitleaks/gitleaks.toml` allowlist; `.gitleaksignore` for historical commits | exact literal + path scoped, commented; fingerprints justified |
| Trivy | `security/trivy/trivyignore` | CVE id + reason + review date |
| ZAP | `security/zap/rules.tsv` | rule id + comment naming the accepted risk |

Every suppression must correspond to a row in the **accepted-risk register**
in [`.github/SECURITY.md`](../.github/SECURITY.md) (AR-1 … AR-7). The PR
template requires new suppressions to be declared and justified. Reviewers
listed in CODEOWNERS gate every change to suppression files.

## Standards mapping

| Pipeline control | NIST SSDF (SP 800-218) | SLSA v1.0 | OWASP |
|---|---|---|---|
| Pre-commit hooks (lint-staged, staged Gitleaks) | PW.5, PW.7 | — | SAMM Implementation |
| Secret scanning (Gitleaks, full history) | PS.1 | — | ASVS V2/V6 |
| SAST (CodeQL security-extended, Semgrep OSS) | PW.7, PW.8 | — | Top 10, SAMM Verification |
| SCA (OSV-Scanner, `npm audit`) + Dependabot | PW.4, PS.3 | — | A06:2021 – Vulnerable & Outdated Components |
| Pinned actions, `npm ci` from lockfile, least-privilege workflow permissions | PO.5, PS.1 | Build L1–L2 | — |
| SBOM (Syft) + Cosign signatures + provenance attestations | PS.3, PW.4 | Build L2 (L3-track: hosted runner + signed provenance) | SAMM Supply Chain |
| Container hardening + Trivy image/config scans | PW.9, RV.1 | — | ASVS V14 |
| DAST (OWASP ZAP baseline) | PW.9, RV.1 | — | Top 10 (verification) |
| SECURITY.md, accepted-risk register, suppression governance | RV.2, RV.3 | — | SAMM Governance |
| Branch protection + required checks + CODEOWNERS | PO.3, PS.1 | — | SAMM Governance |

## Security-by-design choices in the pipeline itself

- **Least privilege**: every workflow declares the minimum `permissions:`;
  the default `GITHUB_TOKEN` is read-only.
- **Supply-chain pinning**: actions pinned by SHA, Docker base images pinned
  by digest, dependencies installed with `npm ci` against the committed
  lockfile.
- **Fail-closed gates**: scanners run with error-on-finding flags; the
  service-container probe (`DEVOX_REQUIRE_SERVICES=1`) turns silent test
  skips into hard failures.
- **Non-root, minimal containers**: multi-stage builds, `USER node` /
  unprivileged nginx, production-only dependencies in the runtime layer.
- **No secrets in code**: dev fallback keys are allowlisted explicitly and
  documented (AR-5/AR-6); real deployments inject `DEVOXGUARD_API_KEY` via
  the environment.

## Branch protection (applied via repo settings)

`main` requires: pull request before merge, required status checks
(`lint`, `secrets`, `sca`, `semgrep`, `build-test`, `docker`, CodeQL),
dismissal of stale approvals, no force pushes, no deletions.

## Verifying the gates actually gate

On a throwaway branch, each of these must turn the corresponding job red:

1. Commit a fake AWS key (e.g. `AKIA` + 16 uppercase chars) → `secrets` fails.
2. Add `eval(req.query.q)` to a controller → `semgrep` / CodeQL fails.
3. Downgrade a dependency to a version with a known CVE → `sca` / `osv-scan` fails.
4. Stop the Mongo service container → `build-test` fails (not skips).

This was actually run (2026-08-05, branch `test/fail-closed-proof`, deleted
after verification). Findings:

- **secrets** and **osv-scan** failed exactly as expected on the injected
  fake AWS key and a reverted vitest version with known critical/high CVEs.
- **semgrep passed when it should have failed.** `p/typescript` +
  `p/owasp-top-ten` — and, on further testing, `p/javascript`,
  `p/security-audit`, and `p/nodejsscan` too — do not flag a bare `eval()`
  call for unauthenticated/free Semgrep; that rule lives behind a paid
  Semgrep account, which conflicts with the free-tooling requirement. Fixed
  by adding [`security/semgrep/custom-rules.yml`](../security/semgrep/custom-rules.yml)
  (eval/Function-constructor detection) to the semgrep step. Re-verified:
  the same throwaway branch then failed `semgrep` as expected, with zero
  false positives against the rest of the repo.
- **sca** (`npm audit --omit=dev`) correctly did *not* fail on the
  vitest downgrade, since it's a devDependency — that's by design, not a
  gap; `osv-scan` is the gate that covers devDependencies.

Lesson: free-tier SAST registries have real coverage gaps for specific sink
patterns (bare `eval`, likely others). Don't assume a named ruleset implies
coverage — verify with an actual injected finding, and expect to supplement
with small custom rules for gaps that matter to this codebase.
