# TradeQuip (`TD.2.ANTIGRAVITY`)

Self-hosted, low-latency trading platform with:
- real-time quote streaming over `/ws`
- deterministic trade lifecycle + risk controls
- institutional-grade security/compliance and audit trails
- aggressive startup warmup and cache-aware loading paths

## Preserved Quick Commands (unchanged)

- Web dev: `npm run dev`
- Durable Postgres (prevents “history disappears after shutdown” on ephemeral hosts):
  - Start infra: `npm run infra:up:durable`
  - Ensure schema: `npm run db:ensure:durable`
  - Run dev against durable DB: `npm run dev:durable`
  - Valkey (durable infra) listens on `6380`
  - Diagnostics: `npm run audit:trade-history:durable`
- Build: `npm run build`
- Mobile (Capacitor): `CAPACITOR.md`
- Agent guidance: `AGENTS.md` (checklists in `/.agents/`)

## Quick Start (Local)

```bash
npm ci
npm run infra:up
npm run db:ensure
npm run dev
```

Open `http://localhost:5000`.

### Durable Local Database Mode (recommended for persistent trade history)

```bash
npm run infra:up:durable
npm run db:ensure:durable
npm run dev:durable
```

Valkey durable mode uses port `6380`.

## Core Commands

| Task | Command |
|---|---|
| Typecheck | `npm run check` |
| Build (web + server bundle) | `npm run build` |
| Start production bundle | `npm run start` |
| E2E (Playwright) | `npm run e2e` |
| Install Playwright browser | `npm run e2e:install` |
| DB ensure (dev/local) | `npm run db:ensure` |
| DB migrate (CI) | `npm run db:migrate:drizzle` |
| DB audit | `npm run db:audit` |
| Activity audit verify | `npm run audit:activity` |
| Admin smoke sanity | `npm run smoke:admin` |
| Quote publish load test | `npm run loadtest:publish-quotes` |
| WS fanout load test | `npm run loadtest:ws-fanout` |

## Architecture At A Glance

- `client/`: React + Vite web app, trader/admin UI, live quote client
- `server/`: Express API + WebSocket server + trade/risk/compliance engine
- `shared/`: shared schemas and policy contracts
- `db/`: Drizzle migrations, seeders, schema tooling
- `scripts/`: audits, DB tooling, load tests, operational helpers
- `e2e/`: Playwright end-to-end flows
- `MOBILE/`: Capacitor wrapper app
- `NATIVE/`: React Native app
- `k8s/`: Kubernetes manifests

## Startup Performance Model

Trader startup is designed around quote-first readiness:
- immediate quote websocket handshake and snapshot hydration
- aggressive route/data prefetch with tier-aware controls
- in-flight dedupe to prevent duplicate startup fetches
- encrypted persistent cache hydration with user scoping + logout purge

Primary code entrypoints:
- `client/src/main.tsx`
- `client/src/lib/startupDataPrefetch.ts`
- `client/src/lib/routePrefetch.ts`
- `client/src/lib/perfHints.ts`
- `client/src/lib/queryPersistence.ts`
- `client/src/live/QuotesProvider.tsx`

## Security and Compliance Guardrails

- server-side policy gating is mandatory (`shared/policyDecision.ts`, `server/middleware/requirePolicy.ts`)
- jurisdiction and legal acceptance controls are enforced on critical flows
- startup validation fails in production when critical secrets are missing
- audit/report docs and runbooks are maintained in-repo

Key references:
- `AGENTS.md`
- `.agents/PRODUCTION_REQUIREMENTS.md`
- `AUDIT_REPORT.md`
- `REAUDIT_REPORT.md`
- `AUDIT_COMPLIANCE_STATUS.md`
- `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md`
- `CODEX_COUNTRY_TIMEZONE_CONTROLS.md`

## Mobile

- Capacitor wrapper: `CAPACITOR.md` and `MOBILE/README.md`
- React Native app: `NATIVE/README.md`

## Environment Notes

- Do not commit secrets (`.env`, dumps, keystores, prod logs).
- Use `.env.example` as the template for local `.env`.
- Production startup requires strong secret configuration (see `.agents/PRODUCTION_REQUIREMENTS.md` for exact requirements and validation steps).

## Additional Docs

- structure map: `PROJECT_STRUCTURE.md`
- agent and checklists: `AGENTS.md`, `.agents/`
- deployment manifests: `k8s/`
