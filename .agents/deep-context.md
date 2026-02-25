# Deep Context Map (scan-first guide)

## Scope rule (keep context small)
Only load files for the area you’re changing **plus** adjacent call paths (callers/callees, shared utilities, schemas).

Use this file to locate the right entrypoints quickly; do not “read the whole repo” into context.

## Start here (always)
- Repo router: `AGENTS.md`
- Shared-first router: `.agents/shared-services.md`
- Routes architecture router: `server/routes/AGENTS.md`
- Structure guide: `PROJECT_STRUCTURE.md`
- Security invariants: `AUDIT_REPORT.md`, `REAUDIT_REPORT.md`, `AUDIT_COMPLIANCE_STATUS.md`
- Compliance runbooks: `JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md`, `CODEX_COUNTRY_TIMEZONE_CONTROLS.md`
- Mobile wrapper: `CAPACITOR.md`, `MOBILE/README.md`, `NATIVE/README.md`

## Domain entrypoints (by problem type)

### Auth, sessions, identity
- Session setup + middleware wiring: `server/routes.ts`
- Session trail + device/geo identity parsing: `server/security/sessionTrail.ts`
- Bot defense (challenge + scoring): `server/security/botChallenge.ts`, `server/security/botGuard.ts`
- Captcha provider + verification: `server/security/captcha.ts`
- Jurisdiction session guard: `server/middleware/jurisdictionSessionGuard.ts`
- Admin impersonation guard: `server/middleware/auth.ts`

### Policy gating (non-negotiable for trading actions)
- Policy engine + gates: `shared/policyDecision.ts`
- Server-side enforcement middleware: `server/middleware/requirePolicy.ts`
- Context builder (inputs into policy): `server/policy/buildDecisionContext.ts`
- Jurisdiction controls: `server/policy/jurisdictionControl.ts`

### Trading lifecycle (orders, positions, close, audit)
- Primary API wiring: `server/routes.ts`, `server/routes/admin.ts`
- Order execution + pending/SL/TP engine: `server/engine/orderEngine.ts`
- Risk middleware (limits, stale quote guard, market hours, maintenance): `server/risk.ts`
- Account recalculation (equity/margin): `server/recalcAccount.ts`
- Audit writer + correlation IDs: `server/lib/auditWriter.ts`
- Margin math: `server/lib/margin.ts`
- Realized PnL: `server/lib/realizedPnl.ts`

### Quotes + WebSocket fanout (hot path)
- Quote ingestion: `server/feeds/quoteFeed.ts`, `server/feeds/forgeFeed.ts`
- In-memory quote hub + Valkey snapshots: `server/services/quoteHub.ts`
- Quote reads (latest row / fallback): `server/services/quoteService.ts`
- WS server implementation + protocol: `server/routes.ts` (`/ws`, `WS_PROTOCOL_VERSION`)
- Load tests: `scripts/loadtest/publishQuotes.ts`, `scripts/loadtest/wsFanout.ts`

### Legal terms + compliance tokens
- Crypto primitives (HMAC signing + token verification): `server/legal/cryptoUtils.ts`
- Terms resolution + coverage gates: `server/legal/coverageGate.ts`, `server/legal/regionRules.ts`
- Acceptance write path + audit: `server/legal/legalAcceptanceService.ts`, `server/legal/legalDocChangeAuditService.ts`
- Doc seeding: `server/legal/bootstrapDoc1Seed.ts`, `server/legal/bootstrapDoc2Seed.ts`, `scripts/legalSeedDoc2.ts`

### Admin, audit, and “grift” controls
- Admin routes: `server/routes/admin.ts`, `server/routes/adminSecurity.ts`, `server/routes/adminSystemConfig.ts`
- Admin background export pipeline: `server/routes/adminDataExports.ts`, `server/services/adminDataExportQueue.ts`, `server/services/adminDataExportBuild.ts`, `server/services/adminDataExportBuildClickhouse.ts`, `server/services/objectStorage.ts`
- Export lifecycle + OLAP sync: `server/services/adminDataExportRetention.ts`, `server/services/clickhouseSync.ts`, `server/services/clickhouseClient.ts`
- Activity admin: `server/routes/adminActivity.ts`, `scripts/activityAuditVerify.ts`
- “Grift” engine + enforcement: `server/grift/griftEngine.ts`, `server/grift/griftAutoEnforcement.ts`, `server/routes/grift.ts`
- Grift public router: `server/grift/griftPublicRouter.ts`

### i18n (DB-backed translations + worker)
- Runtime i18n service + manifest ingest: `server/i18n/service.ts`, `server/i18n/worker.ts`
- Admin i18n: `server/routes/adminI18n.ts`
- One-time migration tools: `scripts/i18nSqliteToPostgres.ts`, `scripts/i18nRepairLocale.ts`
- Client i18n: `client/src/i18n/`, `client/i18n-manifest.json`

### Database + migrations
- Schema source of truth: `shared/schema.pg.ts`
- Drizzle setup + connection: `db/index.ts`, `db/config.ts`
- Migrations + seed: `db/migrations/`, `db/seed.ts`
- Audit tooling (CI enforced): `scripts/dbDumpSchema.ts`, `scripts/dbAudit.ts`, `.github/workflows/db-audit.yml`
- Migration risk notes: `MIGRATION_REVIEW.md`

### Web UI
- Routing/pages: `client/src/pages/`, `client/src/App.tsx`
- Data layer: `client/src/hooks/`, `client/src/lib/`
- Live updates: `client/src/live/` (WS client + providers)
- UI conventions: `design_guidelines.md`

### Mobile apps
- Capacitor wrapper (remote URL mode): `MOBILE/`, `MOBILE/src/mobile/`
- React Native app: `NATIVE/src/`

### Infra / deployment
- Docker infra (local Postgres/Valkey): `docker-compose.infra.yml`
- k8s manifests: `k8s/` (notably `60-monitoring.yaml` for Prometheus scraping `/metrics`)

## Quick “where is X?” commands (preferred)
- Find API routes: `rg -n \"app\\.(get|post|patch|put|delete)\\(\" server/routes.ts server/routes`
- Find WS message types: `rg -n \"quotes:|trades:|auth:\" server/routes.ts client/src/live`
- Find policy gates: `rg -n \"requirePolicy\\(|decidePolicy\\(|featureGates\\(\" server shared`
- Find audit writes: `rg -n \"writeTradeAudit\\(|appendIdentityAudit\\(\" server`
