## What & why

<!-- Short description of the change and its motivation. -->

## Type of change

- [ ] Feature
- [ ] Fix
- [ ] Docs
- [ ] CI / tooling
- [ ] Security-relevant (touches guard, rules, auth, CORS, pipeline gates, or suppressions)

## Checklist

- [ ] `npm run lint` and `npm test` pass locally
- [ ] Integration/e2e tests ran against real Mongo/ES (not self-skipped)
- [ ] **No new scanner suppressions** (`nosemgrep`, `.gitleaks.toml`, `.trivyignore`, `.zap/rules.tsv`) — or each new one has a justification below **and** a row in `.github/SECURITY.md`'s accepted-risk register
- [ ] No secrets, connection strings, or `.env` content in the diff
- [ ] Docs updated if behaviour changed (`docs/`, `CONTRIBUTING.md`)

## New suppressions (if any)

<!-- rule id → file → why it is a false positive or accepted risk, and for how long. -->
