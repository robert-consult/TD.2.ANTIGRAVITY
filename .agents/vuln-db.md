# Vulnerability DB + Scanning Policy (TradeQuip)

## Purpose
This repo keeps a **repo-local vulnerability DB** to prevent repeating app-specific failures (beyond CVEs).

If you touch security boundaries (auth, sessions, trading engine, policy gating, legal tokens, admin controls, infra),
you must:
1) cross-check relevant entries in `security/vuln-db/*.yaml`,
2) run dependency vulnerability scans appropriate to the subproject(s),
3) add/adjust tests or runbooks to prevent regression,
4) document any intentional waivers in the PR/issue description (with rationale and risk).

## Repo-local vuln DB (must maintain)
Folder: `security/vuln-db/`
- `web.yaml`     UI/session/cookies/CORS/XSS/CSRF
- `api.yaml`     authz, injection, request smuggling, rate limits
- `trading.yaml` state machine, idempotency, race conditions, quote integrity
- `data.yaml`    PII leakage, retention, encryption, audit immutability
- `ops.yaml`     misconfig, insecure defaults, excessive privileges, supply chain

Each entry includes:
- `id`, `title`, `impact`, `exploit_scenario`
- `detection` (grep/heuristics/tests), `mitigation`, `done_criteria`

## Dependency vulnerability scanning (required for dependency/build changes)
### Root (web+api)
- Lockfile scan (preferred if available): `osv-scanner --lockfile=package-lock.json`
- NPM audit (fallback/secondary): `npm audit`

### MOBILE (Capacitor)
- `osv-scanner --lockfile=MOBILE/package-lock.json`
- `cd MOBILE && npm audit`

### NATIVE (React Native)
- `osv-scanner --lockfile=NATIVE/package-lock.json`
- `cd NATIVE && npm audit`

Notes:
- If `osv-scanner` is not installed in your environment, document that and run `npm audit` at minimum.
- Do not ignore findings without a written mitigation/waiver.

## Supply chain posture (recommended for releases)
- OpenSSF Scorecard (best run in CI against the repo URL): `scorecard --repo=<git-url>`
- Container/IaC scanning: follow `k8s/AGENTS.md` and any infra-specific guidance.

