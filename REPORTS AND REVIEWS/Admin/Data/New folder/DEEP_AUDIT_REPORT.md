# Petascale Infrastructure Deep Audit Report
## Overview
This report audits the current state of the repository (`TD.2.ANTIGRAVITY`) against the **10-Workstream Petascale Implementation Plan (Option B: Integrated Background Services)**. 
The objective is to identify exactly what has been built, what was missed, and where critical bottlenecks remain unresolved.

---

## Workstream Audit Findings

### ❌ WS-01: Admin route decomposition + schema validation
**Status: INCOMPLETE / MISSED**
- **Expected:** `server/routes/admin.ts` decomposed into `server/routes/adminData/*`. Hot endpoints mapped to Zod schemas and stripped of heavy scans.
- **Found:** The `admin.ts` file remains a massive 218KB monolith. The high-risk endpoints (`kpi-summary`, `signup-funnel`, `user-analytics`, `deactivated-accounts/summary`) still perform full table in-memory scans, N+1 queries, and unbounded aggregations inline. `server/routes/adminDataExports.ts` was added for exports, but the core reading routes were left untouched.

### ❌ WS-02: Read-model rollups
**Status: INCOMPLETE / MISSED**
- **Expected:** Rollup tables in `shared/schema.pg.ts` and `server/services/adminDataRollups.ts` to power the dashboard endpoints instantly.
- **Found:** Zero evidence of `adminDataRollups`. `schema.pg.ts` contains no new analytical rollup tables for KPI, Funnel, or Compliance. The Admin DataTab is still querying raw row-level data synchronously.

### ❌ WS-03: Trader search/scouting optimization
**Status: INCOMPLETE / MISSED**
- **Expected:** `server/services/traderScoutQuery.ts` extracting the huge SQL block from `admin.ts`.
- **Found:** `calcScoutMetrics.ts` and `scoutService.ts` exist, but the monolithic `TRADER_SCOUT_SEARCH_SQL` remains deeply embedded in `admin.ts`. Keyset pagination optimizations were not implemented.

### ⚠️ WS-04: Unified async export platform
**Status: PARTIAL / IN PROGRESS**
- **Expected:** Job queue, `admin_export_jobs` table, async router `adminDataExports.ts`, and full cutover of legacy exports.
- **Found:** Extensive scaffold exists (`adminDataExportBuild.ts`, `adminDataExportQueue.ts`, `dataExports.ts`). The router `adminDataExports.ts` is mounted in `routes.ts`. However, schema integration for the export jobs table appears missing in `schema.pg.ts` under expected names. Furthermore, legacy sync exports like `/trader-scouting/export` and `/all-trades` are still functionally exposed in `admin.ts`.

### ✅ WS-05: ClickHouse analytics offload
**Status: PARTIALLY IMPLEMENTED**
- **Expected:** `clickhouseClient.ts`, `clickhouseSync.ts`, and Compose manifests.
- **Found:** `server/services/clickhouseClient.ts` and `clickhouseSync.ts` are present. Bare-metal compose file `petascale/docker-compose.yml` configures the OLAP engine.

### ✅ WS-06: MinIO artifact storage and secure link delivery
**Status: IMPLEMENTED**
- **Expected:** `server/services/objectStorage.ts` wired to MinIO.
- **Found:** `objectStorage.ts` exists and handles the S3-compatible Multipart Uploads and signed URL generation routines needed for async exports.

### ⚠️ WS-07: Observability expansion
**Status: PARTIAL**
- **Expected:** `server/observability/metrics.ts`, Grafana dashboards, queue/cache hitrate telemetry.
- **Found:** `adminDataExportMetrics.ts` created, and `k8s/60-monitoring.yaml` includes Prometheus. `petascale/` contains Grafana configurations. Core `wsCore.ts` remains the main metrics endpoint, but granular app-level business telemetry (snapshot freshness, ClickHouse sync lag) is weak.

### ⚠️ WS-08: Security hardening for export/analytics
**Status: PARTIAL / MISSING CRITICAL DEFENSES**
- **Expected:** CSV injection neutering, strict export sizing caps, rate limiting on heavy requests.
- **Found:** While `adminScopeSession.ts` exists, the legacy exports in `admin.ts` retain weak CSV escaping (`csvEscape` without "=" prefix nullification) and massive 50K row memory caps (`admin.ts:1313`). Rate limiting for new job initialization is present but legacy targets remain exposed.

### ⚠️ WS-09: Kubernetes and runtime hardening
**Status: PARTIAL**
- **Expected:** NetworkPolicies, Non-root pod specs, read-only root filesystems, secure TLS ingress.
- **Found:** `k8s/31-network-policies.yaml` and `70-petascale-infra.yaml` were added. However, deep pod security context lockdown (e.g., `readOnlyRootFilesystem`) was likely not retrofitted into the older `10-api-deployment.yaml`.

### ❌ WS-10: Test/load/failure validation
**Status: MISSED**
- **Expected:** Load test scripts for export pipelines, chaos tests, and synthetic billion-row queries.
- **Found:** The `scripts/loadtest/` directory contains only `publishQuotes.ts` and `wsFanout.ts`. No new scripts for `adminDataTab.ts` or `exportPipeline.ts` were created. Runbooks were not fully realized.

---

## Conclusion

The agent executed the heavy foundational plumbing for **MinIO, ClickHouse, and BullMQ (WS-04, 05, 06)** but completely skipped the **Data-Plane Refactoring (WS-01, 02, 03)**. 

Because `admin.ts` was not decomposed and Rollup tables were not created, the entire Admin DataTab remains fundamentally broken at scale. Pushing ClickHouse into the infrastructure achieves nothing if the Express handlers are still running `.filter()` on `db.select().from(trades)` inNode.js memory.

**Immediate Action Items:**
1. Execute **WS-01** & **WS-02**: Decompose `admin.ts` and build Postgres Rollups.
2. Execute **WS-03**: Optimize the trader scout SQL out of `admin.ts`.
3. Complete **WS-08**: Patch CSV injection and hard-cap the legacy export routes.
4. Execute **WS-10**: Write the export pipeline load tests.
