# AGENTS.md (Repo-wide router) — TD.2.ANTIGRAVITY / TradeQuip

## Project mission (non-negotiable)
TradeQuip (a.k.a. “tradehub”) is a self-hosted trading platform (web + mobile) that must scale to high concurrency with:
1) low-latency quote streaming (`/ws`) and deterministic trade lifecycle behavior,
2) institutional-grade security + auditability (policy gating, jurisdiction controls, legal acceptances),
3) predictable CPU/memory/bandwidth efficiency (no accidental hot-path regressions).

## How you must operate in this repo
1) Read this file first.
2) **Read `PROJECT_STRUCTURE.md`** for a comprehensive deep-map of the entire codebase — directory layout, subsystem locations, build commands, and dependency management. This is your primary navigation reference.
3) If you work inside a subproject directory, also read the nearest `AGENTS.md` in that tree (nearest wins). See the AGENTS.md Location Index at the bottom of `PROJECT_STRUCTURE.md` for all agent guidance files.
4) If `AGENTS.local.md` exists, read it but **do not commit it**.
5) Before adding new feature utilities/protocol helpers, scan `@/.agents/shared-services.md` and reuse/extend `shared/` first.
6) Before writing audits, decomposition plans, or maintainability recommendations, read `@/.agents/audit-decomposition.md` and verify the live tree.
7) Before finalizing any change, complete the required checklists referenced below.
8) If you discover any new production/runtime/deployment requirement, update `.agents/PRODUCTION_REQUIREMENTS.md` in the same change.

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
- Capacitor Android run/build: `cd MOBILE && npm run run:android`, `cd MOBILE && npm run build:android:release`
- Capacitor iOS run: `cd MOBILE && npm run run:ios` (macOS + Xcode only)
- React Native: `cd NATIVE && npm install && npm run android` (tests: `npm test`, lint: `npm run lint`)
- React Native iOS prep/build: `cd NATIVE && npm run pod:install && npm run build:ios` (macOS + Xcode only)

## Repo map (high-level)
> **For the full deep-map with every subdirectory & file, see [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md).**

- `client/`    React + Vite web UI (hooks, pages, `/ws` client, i18n, service worker)
- `server/`    Express API + WebSocket server + trading engine + compliance controls
  - Key subsystems: `routes/`, `services/`, `grift/`, `security/`, `legal/`, `recruitment/`, `marketdata/`, `cron/`, `feeds/`, `i18n/`, `partner/`, `policy/`, `scout/`, `engine/`
- `shared/`    Shared Zod schemas, DB schema (`schema.pg.*.ts`), policy decisions, instrument defs
- `db/`        Drizzle migrations (47 files), seed scripts, schema artifacts
- `scripts/`   Audits, DB tooling, i18n tooling, load tests, integrity checks
- `e2e/`       Playwright tests + runbook test
- `MOBILE/`    Capacitor wrapper (remote URL mode, Android + iOS shells, bridge helpers in `MOBILE/src/mobile/`)
- `NATIVE/`    React Native app (Android + iOS)
- `k8s/`       Kubernetes manifests (deployments, HPA, monitoring, petascale infra)
- `ops/`       Observability: Grafana dashboards, Prometheus config, runbooks, chaos testing
- `petascale/` ClickHouse analytics stack (docker-compose, Grafana, vendor)
- `config/`    Application configs (market data providers)
- `design/`    Design assets (badges, certificates, themes)
- `REPORTS AND REVIEWS/`  Detailed reports archive (250+ items across 24 domains)

## Mobile Routing
- Platform projects are already physically separated under `MOBILE/android`, `MOBILE/ios`, `NATIVE/android`, and `NATIVE/ios`. Keep that split; do not invent mixed-platform shell files in shared roots when a platform subtree is more appropriate.
- Wrapper bridge/runtime: `MOBILE/src/mobile/AGENTS.md`
- Wrapper Android shell: `MOBILE/android/AGENTS.md`
- Wrapper iOS shell: `MOBILE/ios/AGENTS.md`
- Native shared app code: `NATIVE/src/AGENTS.md`
- Native Android shell: `NATIVE/android/AGENTS.md`
- Native iOS shell: `NATIVE/ios/AGENTS.md`

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
