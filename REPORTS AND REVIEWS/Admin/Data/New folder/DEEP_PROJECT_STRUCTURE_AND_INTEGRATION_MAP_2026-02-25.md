# Deep Project Structure and Integration Map (2026-02-25)

## 1) Runtime Structure Map

### 1.1 Root Runtime Domains
- `client/` -> Trader/Admin web UI (React + Vite)
- `server/` -> API + WS + trading engine + admin exports/analytics + security
- `shared/` -> Shared contracts and schemas (Zod + DB contract types)
- `db/` -> migrations/seed/schema tooling
- `scripts/` -> smoke/integrity/load/audit + 20-cycle orchestration
- `e2e/` -> Playwright E2E coverage (trader/admin/integrations)
- `petascale/` -> local petascale stack (ClickHouse/MinIO/Valkey/Grafana/Prometheus/KES + vendor sync)
- `k8s/` -> production deployment/ingress/network policies/monitoring/petascale manifests
- `security/` -> repo-local vulnerability DB and security guardrails

### 1.2 Frontend Surface Map (`client/src`)
- Pages: `client/src/pages/`
  - Trader-facing: `Dashboard.tsx`, `QuotesScreen.tsx`, `TradeScreen.tsx`, `HistoryScreen.tsx`, `AccountScreen.tsx`, `JournalPage.tsx`, `ProfileSettings.tsx`, `ChartScreen.tsx`
  - Admin-facing: `AdminDashboard.tsx`, `AdminData.tsx`, `AdminTradeAudit.tsx`, `AdminCommunications.tsx`, `AdminLegalDocs.tsx`, `AdminLegalAcceptances.tsx`
- Realtime and wiring:
  - `client/src/live/` (`LiveUpdatesProvider`, `ConfigSync`)
  - `client/src/hooks/` (`use-websocket`, perf settings, auth-related hooks)
  - `client/src/lib/` (`queryClient`, CSRF wrappers, secure cache, route prefetch)
- Admin data/export controls:
  - `client/src/pages/AdminData.tsx`
  - `client/src/components/admin/TraderSearchTab.tsx`
  - `client/src/pages/AdminDashboard.tsx` (user exports and audit-trail fetches)
  - `client/src/pages/AdminTradeAudit.tsx` (CSV/JSONL/Parquet audit exports)

### 1.3 Backend Surface Map (`server/`)
- Bootstrap + role split:
  - `server/index.ts` (`APP_ROLE=api/ws/worker`, scheduler and worker startups)
  - `server/routes.ts` (router mount order, auth/session, ws, metrics)
- Decomposed admin route modules:
  - `server/routes/adminDataExports.ts`
  - `server/routes/adminDataRollups.ts`
  - `server/routes/adminInstitutionalAudit.ts`
  - `server/routes/adminTraderScouting.ts`
  - `server/routes/adminDataLegacyCompat.ts`
  - plus legacy monolith still present: `server/routes/admin.ts`
- Export/analytics services:
  - `server/services/adminDataExportQueue.ts` (BullMQ + worker + retry/cancel/requeue)
  - `server/services/adminDataExportBuild.ts` (CSV/JSONL/Parquet builders)
  - `server/services/adminDataExportBuildClickhouse.ts` (CH-backed streaming)
  - `server/services/objectStorage.ts` (MinIO/S3 object write/read link path)
  - `server/services/clickhouseClient.ts`
  - `server/services/clickhouseSync.ts`
  - `server/services/adminDataRollups.ts`
  - `server/services/adminAuditTrail.ts`
- Security/rate-limit/session:
  - `server/security/` (CSRF, bot/captcha, login limit, proxy trust)
  - `server/middleware/` (admin/policy/jurisdiction/auth guards)
- Metrics/observability:
  - `server/routes/wsCore.ts` (`/metrics`, queue/rollup/clickhouse/ws counters and gauges)

### 1.4 Shared Data Contract Map (`shared/`)
- `shared/schema.pg.ts`
  - `adminDataExportJobs`, `adminDataExportJobEvents`, `adminDataRollups`
  - high-volume trading/audit/user tables and relation contracts
- `shared/admin/dataExports.ts`
  - export type/format/status contracts (`csv`, `jsonl`, `parquet`)
  - filter schemas for users, timeline, trader-scouting, audit datasets

### 1.5 Infra / Deployment Map
- Kubernetes:
  - Core app: `k8s/10-api-deployment.yaml`, `11-ingestor-deployment.yaml`, `12-worker-deployment.yaml`, `13-worker-canary-deployment.yaml`
  - Network and edge: `k8s/30-ingress.yaml`, `k8s/31-network-policies.yaml`
  - Monitoring: `k8s/60-monitoring.yaml`
  - Petascale infra: `k8s/70-petascale-infra.yaml`
- Local petascale stack:
  - `petascale/docker-compose.yml`
  - `petascale/prometheus.yml`
  - `petascale/prometheus-rules/alerts.yml`
  - `petascale/clickhouse/init/00-init.sql`
  - `petascale/vendor/*` (BullMQ, ClickHouse, MinIO, Grafana, Prometheus, Valkey, pigsty, infra-pkg, minio_monitor, kes, headlamp, bull-board)

### 1.6 Validation Harness Map
- Full-cycle orchestrator: `scripts/deepSystemAudit20Cycles.sh`
- Smokes: `scripts/adminSmoke.ts`, `scripts/traderSearchIntegrity.ts`, `scripts/marketDataIntegrity.ts`
- Load tests:
  - `scripts/loadtest/publishQuotes.ts`
  - `scripts/loadtest/wsFanout.ts`
  - `scripts/loadtest/adminDataTab.ts`
  - `scripts/loadtest/exportPipeline.ts`
- DB/security audits:
  - `scripts/dbAudit.ts`
  - `scripts/activityAuditVerify.ts`
  - `scripts/tradeHistoryDurabilityAudit.ts`
- Petascale parquet audit:
  - `scripts/verifyPetascaleParquetIntegration.sh`
- E2E:
  - `e2e/runbook.spec.ts`, `trade-history.spec.ts`, `trader-search.spec.ts`, `scout-ecosystem.spec.ts`, etc.

## 2) Integration Edges (Source of Truth Wiring)

### 2.1 Trader Frontend -> API/WS -> Persistence
1. Trader pages (`client/src/pages/*`) call REST via `client/src/lib/queryClient.ts`/`fetchWithIdentity.ts`.
2. WS path from `client/src/live/*` -> `/ws` served by `server/routes.ts`.
3. Trading and audit writes go through server engine/services -> Postgres (`shared/schema.pg.ts` tables).

### 2.2 Admin Data / Exports Pipeline
1. Admin UI (DataTab, Trade Audit, Admin Dashboard) queues exports via `/api/admin/data-exports*`.
2. `adminDataExportsRouter` validates requests using shared schemas.
3. `adminDataExportQueue.ts` persists durable job state, enqueues BullMQ work, processes in `APP_ROLE=worker`.
4. Builders generate CSV/JSONL/Parquet artifacts; object storage writer persists artifacts to MinIO/S3.
5. Download-link route issues controlled retrieval links for completed jobs.

### 2.3 Analytics and Petascale Offload
1. OLTP source: Postgres transactional and audit rows.
2. `clickhouseSync.ts` incrementally syncs to ClickHouse analytics tables.
3. Heavy exports and analytics can query ClickHouse via `adminDataExportBuildClickhouse.ts`.
4. Rollups for hot admin cards served from `adminDataRollups` read-model.

### 2.4 Observability and Security Guardrails
1. App metrics exposed at `/metrics` via `server/routes/wsCore.ts`.
2. Prometheus scrape + alerts in `k8s/60-monitoring.yaml` and `petascale/prometheus-rules/alerts.yml`.
3. CSRF contract (`/api/csrf` + `x-csrf-token`) enforced by server security layer and client/script callers.
4. Ingress/network policy controls in `k8s/30-ingress.yaml` and `k8s/31-network-policies.yaml`.

## 3) Expanded 20-Cycle Verification Matrix (Execution Plan)

Cycle gates to run in each iteration (with scheduled heavy gates):
- Type/build correctness: `npm run check` (+ periodic `npm run build`)
- Unit/component tests: `vitest` (frontend hooks/components + backend utility/security tests)
- Trader/admin functional smokes:
  - `npm run smoke:admin`
  - `npm run smoke:trader-search` (CSRF-aware export checks incl parquet)
  - `npm run integrity:market-data`
- Realtime/load/perf:
  - `npm run loadtest:publish-quotes`
  - `npm run loadtest:ws-fanout`
  - `npm run loadtest:admin-data-tab`
  - `npm run loadtest:export-pipeline`
- Data/security audits:
  - `npm run db:audit`
  - `npm run audit:activity`
  - `npm run audit:trade-history`
  - `npm audit --audit-level=high`
- Petascale/Parquet integration assertion:
  - `npm run audit:petascale-parquet`
- End-to-end coverage:
  - `npm run e2e`
- Deployment hygiene:
  - `kubectl apply --dry-run=client -f k8s/`

## 4) Scope Notes for This Run
- This map is grounded in current repo paths and scripts only (no assumed external services beyond what repo defines).
- 24h canary/cutover remains cluster-operational work and is validated with runbook scripts/manifests, not local-branch-only execution.
