# AGENTS.md (Repo-wide router) — TD.2.ANTIGRAVITY / TradeQuip

## Project mission (non-negotiable)
TradeQuip (a.k.a. “tradehub”) is a self-hosted trading platform (web + mobile) that must scale to high concurrency with:
1) low-latency quote streaming (`/ws`) and deterministic trade lifecycle behavior,
2) institutional-grade security + auditability (policy gating, jurisdiction controls, legal acceptances),
3) predictable CPU/memory/bandwidth efficiency (no accidental hot-path regressions).

## How you must operate in this repo
1) Read this file first.
2) If you work inside a subproject directory, also read the nearest `AGENTS.md` in that tree (nearest wins).
3) If `AGENTS.local.md` exists, read it but **do not commit it**.
4) Before adding new feature utilities/protocol helpers, scan `@/.agents/shared-services.md` and reuse/extend `shared/` first.
5) Before writing audits, decomposition plans, or maintainability recommendations, read `@/.agents/audit-decomposition.md` and verify the live tree.
6) Before finalizing any change, complete the required checklists referenced below.
7) If you discover any new production/runtime/deployment requirement, update `.agents/PRODUCTION_REQUIREMENTS.md` in the same change.

## Production Requirements Ledger (mandatory)
- Canonical file: `.agents/PRODUCTION_REQUIREMENTS.md`
- This file is a living ledger of production-critical requirements.
- Any agent that uncovers a new requirement must append a dated, testable entry before finalizing.
- Required entry content: scope, exact requirement, enforcement location, validation steps, and failure mode.
- If no new production requirements were introduced in a task, explicitly state that in the final summary.

## Golden commands (must be correct)
### Root (web + api)
- Install: `npm ci` (preferred) or `npm install`
- Dev (full stack): `npm run dev`
- Typecheck: `npm run check`
- Build: `npm run build`
- Start (prod): `npm run start`
- E2E (Playwright): `npm run e2e` (first-time browser install: `npm run e2e:install`)
- DB ensure (local/dev): `npm run db:ensure`
- DB migrate (CI): `npm run db:migrate:drizzle`
- DB audit (CI): `npm run db:audit`
- DB audit (schema dump + audit): `npm run db:audit:auto`
- Activity audit verify: `npm run audit:activity`
- Admin smoke (quick sanity): `npm run smoke:admin`
- Load tests: `npm run loadtest:publish-quotes`, `npm run loadtest:ws-fanout`

### Infra (local)
- Postgres + Valkey: `docker compose -f docker-compose.infra.yml up -d`

### Mobile
- Capacitor sync: `npm run cap:sync` (root) or `cd MOBILE && npm run sync`
- React Native: `cd NATIVE && npm install && npm run android` (tests: `npm test`, lint: `npm run lint`)

## Repo map (high-level)
- `client/`  React + Vite web UI (hooks, pages, `/ws` client)
- `server/`  Express API + WebSocket server + trading engine + compliance controls
- `shared/`  Shared Zod schemas, DB schema (`schema.pg.ts`), policy decisions
- `db/`      Drizzle migrations, seed scripts, schema artifacts
- `scripts/` Audits, DB tooling, i18n tooling, load tests
- `e2e/`     Playwright tests + runbook test
- `MOBILE/`  Capacitor wrapper (remote URL mode, Android focus)
- `NATIVE/`  React Native app (Android + iOS)
- `k8s/`     Kubernetes manifests (deployments, HPA, monitoring)

## Non-functional requirements (NFRs) — enforced on every change
### A) Performance & compute efficiency
This repo is quote- and trade-heavy: avoid increased hot-path complexity, allocations, and blocking IO.
Before finalizing: `@/.agents/performance.md`.

### B) Network & bandwidth efficiency
Treat bandwidth as a first-class constraint (WS payloads, fanout costs, cacheability).
Before finalizing: `@/.agents/performance.md` (bandwidth section).

### C) Security & auditability (institutional-grade)
Do not weaken policy gating, jurisdiction restrictions, verification flows, audit logging, or legal acceptance integrity.
Before finalizing: `@/.agents/security.md`.

Also preserve the invariants documented in:
- `AUDIT_REPORT.md`, `REAUDIT_REPORT.md`, `AUDIT_COMPLIANCE_STATUS.md`
- `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md`, `CODEX_COUNTRY_TIMEZONE_CONTROLS.md`

### D) Supply chain & dependency vulnerabilities
Any dependency / build / container change must be scanned for known vulns and risky provenance.
Before finalizing: `@/.agents/vuln-db.md`.

## Required Definition of Done (cannot skip)
See `@/.agents/release-done.md`.

## Deep context entrypoints (scan these before making assumptions)
See `@/.agents/deep-context.md` for “where to look” by domain (auth, trading, quotes, compliance, i18n, mobile, infra).
For audit/decomposition/maintainability review policy, also see `@/.agents/audit-decomposition.md`.
For route architecture rules (anti-bloat modularization + index wiring), also see `server/routes/AGENTS.md`.

## Boundaries (strict)
- Never commit secrets (including `.env`, DB dumps, prod logs, keystores).
- Never relax startup secret validation or compliance gates “temporarily”.
- Never ship changes that increase hot-path complexity or WS payload size without a mitigation plan.
- No drive-by refactors: only change what the task requires plus directly related hardening.
