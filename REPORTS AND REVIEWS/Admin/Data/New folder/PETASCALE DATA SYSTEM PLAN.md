**Conclusion and A/B Decision**
Select **Option B: Integrated Background Services** (as defined in [implementation_plan.md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/implementation_plan.md:20) and [implementation_plan.md.resolved](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/implementation_plan.md.resolved:20)), hardened with strict process separation (`APP_ROLE=worker`) and durable queue/job state.

**A/B Justification (from provided docs, no guessing)**

| Criterion | Option A (separate analytics/export app) | Option B (integrated background services) |
|---|---|---|
| Definition source | [implementation_plan.md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/implementation_plan.md:15) | [implementation_plan.md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/implementation_plan.md:20) |
| Performance under billion-row analytics | Strong isolation, but adds cross-service hops and duplicated auth/context | Strong enough if worker roles are isolated and request path is read-only/queued; reuse existing role split in [server/index.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/index.ts:205) |
| Operational complexity on OVH bare metal | Higher: extra service lifecycle, CI/CD, schema/version drift risk | Lower: one repo, existing deployment model, worker role already first-class |
| Failure isolation | Better by default | Good if queue + worker process isolation + backpressure are enforced |
| Observability complexity | More moving parts, harder for novice team | Simpler single telemetry model; still supports full queue/storage/DB metrics |
| Security boundary management | More internal trust boundaries to manage | Fewer boundaries; easier to enforce existing `requireAdmin` and session policy chain in [server/routes.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes.ts:108) |
| Cost/self-hosted footprint | Higher operational overhead | Lower overhead, better fit for novice + 3 agents |
| Maintainability | Harder | Better fit for stated maintainability constraint |

Decision rationale: the repo already has durable admin-job patterns ([migrationService.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/migration/migrationService.ts:466), [adminMigration.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/adminMigration.ts:145)), worker-role bootstrapping ([server/index.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/index.ts:222)), and admin polling UI patterns ([AdminDashboard.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/AdminDashboard.tsx:1957)). Option B is the fastest path to hardening without microservice sprawl.

---

**Deep Progression Critique (flow and gaps)**

1. [data_tab_deep_audit_report(1).md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/data_tab_deep_audit_report%281%29.md) correctly identified OOM/timeout and export risks, but stopped at generic recommendations and did not map implementation to existing worker/job scaffolding in this repo.
2. [data_tab_deep_audit_report(2).md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/data_tab_deep_audit_report%282%29.md) improved architecture direction (async export + MinIO), but still lacked concrete repo module-level integration and missed current in-repo migration-job reuse potential.
3. [BRAINSTORM 1.txt](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/BRAINSTORM%201.txt:104) introduced a different A/B (BullMQ vs Temporal), which later conflicts with A/B in implementation plan (separate app vs integrated app). This is a major decision-clarity flaw.
4. [BRAINSTORM 2 - MODIFICATIONS...txt](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/BRAINSTORM%202%20-%20MODIFICATIONS%20TO%20PRODUCE%20A%20PLAN%20of%20IMPLEMENTATION.txt:87) refocused A/B correctly but mixed valid guidance with assumptions not encoded in repo (for example legal/operational assumptions).
5. [task 1-2.md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/task%201-2.md:1) records partial execution, but those steps were infra-only and did not include critical app-side durability/security/observability changes.
6. [implementation_plan.md](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/implementation_plan.md) and [.resolved](/home/bcodex/TD.2.ANTIGRAVITY/REPORTS%20AND%20REVIEWS/Admin/Data/New%20folder/implementation_plan.md.resolved) choose Option B, but still remain high-level; no endpoint-by-endpoint cutover map, no fallback strategy, no hard limits/alerts, no concrete threat model.
7. Unfinished start in [petascale/docker-compose.yml](/home/bcodex/TD.2.ANTIGRAVITY/petascale/docker-compose.yml) and [petascale/prometheus.yml](/home/bcodex/TD.2.ANTIGRAVITY/petascale/prometheus.yml) is not production-hardened: hardcoded credentials, public MinIO metrics auth, and missing queue/worker integration.
8. Critical blind spot across all stages: DataTab hot endpoints still do full scans or N+1 in request path, e.g. [kpi-summary](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:587), [signup-funnel](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:5039), [user-analytics](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:5105), [verification compliance](/home/bcodex/TD.2.ANTIGRAVITY/server/storage.ts:1757).
9. Security/abuse blind spot: export routes are synchronous and large-cap, e.g. trader export up to 50k in memory [admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:1313), and CSV injection defense is incomplete [admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:1429), [admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:1995).
10. Observability blind spot: current `/metrics` in [wsCore.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/wsCore.ts:112) is useful but insufficient for export/analytics pipeline, cache hitrate, DB query performance, and security telemetry.
11. Kubernetes hardening blind spot: no NetworkPolicies or pod security hardening in app deployments ([10-api-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/10-api-deployment.yaml), [11-ingestor-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/11-ingestor-deployment.yaml), [12-worker-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/12-worker-deployment.yaml)); monitoring persistence and adapter TLS posture are weak in [60-monitoring.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/60-monitoring.yaml:81).

---

**Enhanced, Hardened, Repo-Grounded Implementation Plan**

**1) Current Admin DataTab map and immediate breakpoints**
1. Endpoints currently powering DataTab are concentrated in one monolith file [admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts) and UI entry [AdminData.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/AdminData.tsx:73), [TraderSearchTab.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/components/admin/TraderSearchTab.tsx:69).
2. Confirmed breakpoints at scale:
- In-memory full table load in [kpi-summary](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:598).
- N+1 per-user trades loop in [signup-funnel](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:5068).
- Login history truncation and full-loop logic in [user-analytics](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:5120).
- Full login history in memory in [getAllUsersLoginStats](/home/bcodex/TD.2.ANTIGRAVITY/server/storage.ts:956).
- Full users scan in [getVerificationComplianceMetrics](/home/bcodex/TD.2.ANTIGRAVITY/server/storage.ts:1757).
- Hard truncation in [/all-trades](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:724) (`limit(5000)`).
- Large sync export cap in [/trader-scouting/export](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:1301).
- Large sync join export in [/deactivated-accounts/export](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:1825).
3. Existing reusable foundation for background jobs exists in migration subsystem [migrationService.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/migration/migrationService.ts:466), but currently uses in-process `setImmediate` and local file writes, not distributed durable queue/state.

**2) Target architecture blueprint (Option B, hardened)**
1. OLTP remains PostgreSQL-backed app core (`users`, `trades`, `trade_audit`, `user_login_history`) in [shared/schema.pg.ts](/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts:257).
2. Analytics plane becomes dual-layer:
- Fast operational read models in Postgres rollup tables for dashboard responsiveness and fallback.
- Heavy aggregate/export source in ClickHouse for billion-row scans.
3. Background execution plane:
- BullMQ queues on Valkey.
- Worker processes running under `APP_ROLE=worker` only.
- Job metadata/state in Postgres (authoritative), queue as execution transport.
4. Artifact storage:
- MinIO private buckets for export files and manifests.
- Download via short-lived signed links issued through authenticated API endpoint.
5. Monitoring/security visibility:
- Prometheus + Grafana as unified telemetry layer.
- Expanded app metrics + queue/storage/db/system dashboards.
- Alerting on saturation, lag, failures, abuse, and exfiltration indicators.
6. Zero-heavy-work request path invariant:
- Admin API returns either small paginated data (<=100) or async job handles.
- No full-table read or mega-export assembly in Express handlers.

**3) Workstreams with exact repo integration, DataTab coverage, and scale rationale**

1. **WS-01: Admin route decomposition + schema validation hardening**
- Repo integration: split logic from [server/routes/admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts) into new `server/routes/adminData/*` and wire in [server/routes.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes.ts:134); follow route guardrails in [server/routes/AGENTS.md](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/AGENTS.md).
- Changes: add shared Zod request contracts in `shared/admin/dataTab.ts`; keep endpoint paths stable; enforce bounded params on all heavy routes.
- Supports Admin DataTab: all six subtabs in [AdminData.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/AdminData.tsx:75) and trader search.
- Scale rationale: smaller route modules + strict bounds prevent accidental monolith growth and request-path regressions at million-trader scale.

2. **WS-02: Read-model rollups for KPI/Funnel/Analytics/Compliance/Deactivated**
- Repo integration: add rollup tables in [shared/schema.pg.ts](/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts), migrations under `db/migrations/`, worker calculators under `server/services/adminDataRollups.ts`, scheduler `server/cron/adminDataRollups.ts`, startup registration in [server/index.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/index.ts:620).
- Changes: replace request-time aggregation with incremental rollup updates + weekend full rebuild jobs; API handlers become small point lookups.
- Supports Admin DataTab: `kpi-summary`, `signup-funnel`, `user-analytics`, `analytics/compliance`, `deactivated-accounts/summary`.
- Scale rationale: transforms unbounded scans to O(1)/O(log n) reads; keeps API latency stable while raw data grows into billions.

3. **WS-03: Trader search/scouting optimization**
- Repo integration: extract SQL and mapping from [admin.ts TRADER_SCOUT_SEARCH_SQL](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:907) into `server/services/traderScoutQuery.ts`; optimize scout metric builder in [calcScoutMetrics.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/scout/calcScoutMetrics.ts:136); keep scheduler in [scoutMetrics.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/cron/scoutMetrics.ts:49).
- Changes: remove per-candidate inner daily query loop; batch per-window aggregates; keyset pagination for search result pages.
- Supports Admin DataTab: Trader Search tab + drilldowns in [TraderSearchTab.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/components/admin/TraderSearchTab.tsx:295).
- Scale rationale: avoids repeated user-by-user DB loops and supports deep history scanning.

4. **WS-04: Unified async export platform**
- Repo integration: add new tables `admin_export_jobs`, `admin_export_job_events`, `admin_export_artifacts` in [shared/schema.pg.ts](/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts); add queue service `server/services/exportQueue.ts`; add worker `server/jobs/exportWorker.ts`; add API router `server/routes/adminDataExports.ts`; add UI component in [AdminData.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/AdminData.tsx:237) and [TraderSearchTab.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/components/admin/TraderSearchTab.tsx:260).
- Changes: all heavy exports become `POST create-job` + `GET status/list` + `POST cancel/retry` + `GET download-link`.
- Supports Admin DataTab: Stats exports, trader scouting export, deactivated export; then extend to `export/users` and timeline endpoints.
- Scale rationale: request path returns immediately, workers stream in chunks, queue controls concurrency/backpressure.

5. **WS-05: ClickHouse analytics offload (heavy reads + huge exports)**
- Repo integration: add `server/services/clickhouseClient.ts`, `server/jobs/clickhouseSyncWorker.ts`, sync state table in schema; add deployment manifests under `k8s/` and hardened compose under `petascale/`.
- Changes: incremental sync from Postgres (`trades`, `trade_audit`, `user_login_history`, `user_account_events`) using high-watermark checkpoints; query CH for heavy aggregates and bulk export reads.
- Supports Admin DataTab: heavy multi-period analytics and massive export sources.
- Scale rationale: columnar engine is fit-for-purpose for billion-row aggregations; Postgres remains OLTP source-of-truth.

6. **WS-06: MinIO artifact storage and secure link delivery**
- Repo integration: add `server/services/objectStorage.ts`; add MinIO env settings to [k8s/01-configmap.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/01-configmap.yaml) and [k8s/02-secrets.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/02-secrets.yaml) templates.
- Changes: write export chunks and manifest to private bucket; API generates short TTL signed links only after authz + job ownership checks; persist only object keys in DB.
- Supports Admin DataTab: “export in background and deliver links” requirement.
- Scale rationale: avoids proxying multi-GB/TB files through Node; minimizes API bandwidth pressure.

7. **WS-07: Observability expansion (app + queue + db + k8s + node + docker)**
- Repo integration: extend metrics endpoint in [wsCore.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/wsCore.ts:112) or centralize in new `server/observability/metrics.ts`; update [k8s/60-monitoring.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/60-monitoring.yaml); add Grafana dashboard JSONs in `k8s/monitoring/dashboards/`.
- Changes: instrument route latency, query latency, queue depth/lag, job throughput/failures, snapshot freshness, cache hitrate, export bytes/rows, worker heartbeat.
- Supports Admin DataTab: visibility for analytics freshness, export completion, bottlenecks.
- Scale rationale: detects failure/ceiling before user-visible breakage.

8. **WS-08: Security hardening for export/analytics surfaces**
- Repo integration: add request schemas in shared module; add rate-limit middleware for heavy admin routes; apply admin resource scope checks using [adminScopeSession.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/security/adminScopeSession.ts:94) patterns; harden CSV escaping where used in [admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts:1429).
- Changes: protect against CSV formula injection, job abuse, link leakage, and overbroad data export; append immutable audit events for job create/start/fail/download.
- Supports Admin DataTab: safe exports, safe large analytics access.
- Scale rationale: prevents data exfiltration and abuse amplification under high concurrency.

9. **WS-09: Kubernetes and runtime hardening**
- Repo integration: update [10-api-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/10-api-deployment.yaml), [11-ingestor-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/11-ingestor-deployment.yaml), [12-worker-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/12-worker-deployment.yaml), [30-ingress.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/30-ingress.yaml), [60-monitoring.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/60-monitoring.yaml).
- Changes: add `securityContext`, non-root, read-only FS where feasible, NetworkPolicies, ingress rate limits/TLS policy, persistent Prometheus storage, remove insecure adapter TLS skip.
- Supports Admin DataTab: stable and secure worker/API execution under load.
- Scale rationale: protects cluster reliability and limits blast radius.

10. **WS-10: Test/load/failure validation**
- Repo integration: extend [scripts/traderSearchIntegrity.ts](/home/bcodex/TD.2.ANTIGRAVITY/scripts/traderSearchIntegrity.ts), add `scripts/loadtest/adminDataTab.ts`, `scripts/loadtest/exportPipeline.ts`, and failure drills.
- Changes: add synthetic billion-row style query tests (through CH), export stress tests, queue recovery tests, storage outage tests.
- Supports Admin DataTab: verifies correctness and operational behavior before production.
- Scale rationale: catches regressions before live traffic.

**4) Data lifecycle strategy (billions of rows, exports, weekend analytics)**
1. Ingestion:
- OLTP writes remain in Postgres via existing application flow and audit tables in [shared/schema.pg.ts](/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts:257).
- Incremental sync worker streams append/update events to ClickHouse using high-watermark checkpoints.
2. Partitioning and retention:
- Introduce time-based partitioned tables for high-growth tables (`trades`, `trade_audit`, `order_intent_audit`, `user_login_history`) via `db/migrations/*`.
- Keep retention policy configurable and explicit; never hardcode destructive retention without compliance signoff.
3. Weekend analytics:
- Weekend full recompute jobs rebuild rollups/snapshots.
- Weekday incremental updates run at low cadence with capped batches.
4. Dashboard freshness:
- Every rollup row stores `as_of` timestamp and `source_lag_sec`.
- API returns freshness metadata so Admin UI can show “live / stale / delayed”.
5. Export lifecycle:
- Created -> queued -> running -> uploading -> ready -> expired/failed/cancelled.
- Large exports chunked with manifest (reuse concepts from [migrationService.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/migration/migrationService.ts:398)).
- Links are temporary and regenerated on demand.

**5) Job orchestration and export management details**
1. Queue model:
- Queue names: `admin-export-v1`, `admin-analytics-refresh-v1`, `clickhouse-sync-v1`.
- BullMQ with Valkey transport; Postgres job table is source of truth.
2. Idempotency and dedupe:
- Job fingerprint = hash(adminId + exportType + filters + format + version).
- Duplicate active jobs return existing jobId.
3. Backpressure:
- Per-admin concurrent export cap.
- Global worker concurrency caps by queue.
- Priority lanes for small exports to avoid starvation.
4. Retry and failure:
- Exponential backoff with max attempts.
- Stuck-job sweeper marks stale RUNNING jobs and requeues when safe.
5. Resumability:
- Persist checkpoint (last sort key / row id / part number) after each chunk.
- Retry resumes from checkpoint.
6. Admin UI:
- Add “Export Jobs” panel in DataTab using existing polling pattern from [AdminDashboard.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/AdminDashboard.tsx:1957).
- Show queued/running/failed/completed, rows processed, bytes written, ETA, and download action.

**6) Observability plan (holistic)**
1. System dashboards:
- Node CPU/memory/disk/network, container restarts, pod OOM/restarts, ingress throughput, k8s scheduling pressure.
2. Application dashboards:
- Route latency/error for all `/api/admin/*` DataTab routes.
- Export queue depth, job age, success/failure rates, throughput.
- Worker heartbeat, event-loop lag, retry counts.
3. Data dashboards:
- Postgres slow query count, pool saturation, bloat/index usage.
- ClickHouse query latency, part merges, disk usage, sync lag.
- Valkey memory/evictions/hitrate.
- MinIO object put/get latency, failed requests, bucket growth.
4. Business dashboards:
- KPI freshness, trader funnel conversion, compliance trend, export demand by type/admin/team.
5. Alerts (early warning before breakage):
- Export queue lag > threshold.
- Snapshot freshness stale > threshold.
- Route p95/p99 latency breach.
- Error-rate spike by endpoint.
- Valkey memory pressure and eviction spike.
- MinIO disk fill forecast.
- ClickHouse sync lag growth.
6. Repo wiring:
- Extend [wsCore.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/wsCore.ts:112) metrics or centralize metrics registry.
- Harden and expand scrape config in [k8s/60-monitoring.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/60-monitoring.yaml).
- Add alert rule files + Grafana dashboards under `k8s/monitoring/`.
7. Incident runbooks to add:
- `RUNBOOK_EXPORT_PIPELINE_INCIDENT.md`
- `RUNBOOK_ANALYTICS_STALENESS.md`
- `RUNBOOK_DDOS_DOS_RESPONSE.md`
- `RUNBOOK_DATA_EXFIL_ALERT.md`

**7) Security hardening plan (holistic)**
1. Threat model scope:
- Export endpoints, queue workers, ClickHouse sync, object storage links, admin dashboard access.
2. DDoS/DoS mitigation:
- Ingress rate limits and request-size constraints in [30-ingress.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/30-ingress.yaml).
- Route-level heavy endpoint rate limits.
- Queue admission control with per-admin caps.
3. Data exfiltration controls:
- Private bucket only; no public object ACL.
- Signed URL TTL short; one-time token option for sensitive exports.
- Export column allowlists; explicit denylist of sensitive fields.
- Export/download audit events appended to immutable audit trail.
4. Authn/authz boundaries:
- Keep `requireAdmin` and session chain in [server/routes.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes.ts:108).
- Apply admin resource scope filters for exportable domains using patterns in [adminScopeSession.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/security/adminScopeSession.ts:94).
5. Secrets management:
- Remove placeholder operational practice from [k8s/02-secrets.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/02-secrets.yaml) in production process; inject real secrets at deploy time.
- Add MinIO/ClickHouse/BullMQ credentials with rotation procedure.
6. Least privilege:
- Separate service accounts for API/worker/ingestor/prometheus.
- NetworkPolicies isolating API, worker, DB, queue, object storage.
7. Secure transport:
- Keep TLS-required API behavior in [server/index.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/index.ts:282).
- Enforce TLS ingress and secure internal routing where feasible.
8. Tamper evidence:
- Extend usage of `audit_export_manifest` ([shared/schema.pg.ts](/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts:2056)) to all DataTab export job outputs with hash manifest.

**8) Package-by-package alignment (Petascale-data + Headlamp)**
1. `bullmq-master`: **Adopt**. Role: durable distributed job execution for exports/refresh/sync. Integrate via new `server/services/exportQueue.ts`. Deploy as app dependency; use existing Valkey.
2. `bull-board-master`: **Adopt (internal only, optional)**. Role: operator queue UI. Integrate as admin-only route behind `requireAdmin` and strict scope.
3. `ClickHouse-master`: **Adopt**. Role: OLAP for heavy aggregates and massive export scans. Deploy as StatefulSet/PVC (or hardened compose initially).
4. `minio-master`: **Adopt**. Role: export artifact/object storage. Deploy private bucket, lifecycle, strict creds, signed URL access.
5. `prometheus-main`: **Adopt**. Role: metrics/alerts. Extend current [k8s/60-monitoring.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/60-monitoring.yaml).
6. `grafana-main`: **Adopt**. Role: dashboards and alerts.
7. `valkey-unstable`: **Adopt** (already present). Role: queue transport/cache/session store.
8. `pigsty-main`: **Defer/Optional**. Powerful, but high operational surface for novice team; keep current Postgres/K8s path unless dedicated DB ops ownership exists.
9. `infra-pkg-main`: **Reject for app plan**. Packaging repo, not runtime necessity for this implementation.
10. `minio_monitor-main`: **Reject**. Redundant with Prometheus+Grafana MinIO metrics.
11. `kes-master`: **Reject for now**. Local README marks it deprecated; do not anchor production on deprecated key service.
12. `headlamp`: **Optional, not required**. It is Kubernetes resource UI ([README](/home/K8s_Headlamp_Web_UI/headlamp/README.md:14)), not observability backend. Use only if ops team wants cluster UX; Grafana/Prometheus remain primary telemetry.

**9) Phased execution plan (simple first, then scale-hardening)**

1. **Milestone 0: Guardrail and decomposition baseline**
- What ships: endpoint decomposition plan, strict request validation, CSV injection fix, synchronous hard caps.
- Repo changes: [admin.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes/admin.ts), new shared schemas, start splitting into `server/routes/adminData/*`, update [server/routes.ts](/home/bcodex/TD.2.ANTIGRAVITY/server/routes.ts).
- Acceptance: no DataTab endpoint performs full-table in-memory scan in handler; CSV formula injection neutralized.

2. **Milestone 1: Async export backbone**
- What ships: export jobs tables, BullMQ queue, worker, status APIs, DataTab “job status” UI.
- Repo changes: schema + migrations, `server/jobs/exportWorker.ts`, `server/routes/adminDataExports.ts`, [AdminData.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/AdminData.tsx), [TraderSearchTab.tsx](/home/bcodex/TD.2.ANTIGRAVITY/client/src/components/admin/TraderSearchTab.tsx).
- Acceptance: export requests return fast with `jobId`; long exports complete in background and provide authenticated links.

3. **Milestone 2: Rollup-backed analytics cutover**
- What ships: rollup tables and periodic refresh workers; DataTab read endpoints cut over to rollups.
- Repo changes: `shared/schema.pg.ts`, `db/migrations/*`, `server/services/adminDataRollups.ts`, route handlers.
- Acceptance: `kpi-summary`, funnel, analytics, compliance, deactivated summary read from rollups only.

4. **Milestone 3: ClickHouse + MinIO scale plane**
- What ships: OLTP->OLAP sync worker, CH-backed heavy queries, MinIO artifact storage for all large exports.
- Repo changes: clickhouse/minio service modules, deployment manifests, worker jobs.
- Acceptance: massive exports no longer touch Postgres request path; heavy aggregate queries execute against CH.

5. **Milestone 4: Observability and security full hardening**
- What ships: full dashboards, alerting, rate limiting, scope-aware export authz, network policies, pod security context.
- Repo changes: [k8s/30-ingress.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/30-ingress.yaml), [k8s/10-api-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/10-api-deployment.yaml), [k8s/11-ingestor-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/11-ingestor-deployment.yaml), [k8s/12-worker-deployment.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/12-worker-deployment.yaml), [k8s/60-monitoring.yaml](/home/bcodex/TD.2.ANTIGRAVITY/k8s/60-monitoring.yaml), middleware and audit modules.
- Acceptance: alerts cover queue lag, snapshot staleness, route latency, export failures, and abuse patterns.

6. **Milestone 5: Scale/failure certification**
- What ships: load tests, chaos tests, recovery drills, runbooks.
- Repo changes: new scripts in `scripts/loadtest/` + runbook markdown files.
- Acceptance: proven recovery from worker crash, queue restart, MinIO outage, and ClickHouse lag; no API OOM during export operations.

**10) Validation strategy aligned to repo**
1. Baseline validation: `npm run check`, `npm run build`, `npm run smoke:admin`.
2. Trading/WS non-regression: `npm run loadtest:ws-fanout`, `npm run loadtest:publish-quotes`.
3. Existing data integrity checks: `npm run smoke:trader-search`, `npm run db:audit`.
4. New required tests to add: export queue stress, analytics freshness lag, worker crash-resume, signed-link authz enforcement.
5. Kubernetes manifest validation: `kubectl apply --dry-run=client -f k8s/`.
6. Failure drills: queue down, storage down, CH lag, and API fallback behavior.

**11) Explicit unknowns requiring mandatory check before implementation**
1. Required legal retention windows for trade/audit/login history are **unknown** in provided artifacts; retention/archival policies must be approved before destructive lifecycle automation.
2. Exact OVH bare-metal topology and capacity are **unknown**; final shard/partition/replica sizing requires host-level inventory (CPU/RAM/NVMe/network).
3. Production orchestration mode (all-k8s vs hybrid k8s+standalone Docker) is **unknown**; plan assumes k8s-first for simplicity but needs explicit ops decision.
4. Organization legal position on AGPL obligations for selected components is **unknown**; legal check is required before production rollout.
5. Current external DDoS edge controls (OVH firewall profiles, ACLs, scrubbing config) are **unknown**; app-level controls are not a substitute and must be validated with infra runbook.

No new production requirement was implemented in code in this planning-only deliverable; `.agents/PRODUCTION_REQUIREMENTS.md` should be updated during execution milestones when each concrete control is actually introduced.