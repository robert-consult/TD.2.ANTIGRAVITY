# Implementation Plan vs Deep Audit Reaudit (Updated 2026-02-25)

Repo: `/home/bcodex/TD.2.ANTIGRAVITY`

## 1) Decision and Alignment
- Architecture decision remains **Option B (Integrated Background Services)** from `implementation_plan.md`.
- Current branch implementation is now materially aligned with the plan for:
  - async export offload,
  - rollup-backed admin hot reads,
  - deep audit trail exportability,
  - ClickHouse sync path for heavy audit/export analytics.

## 2) What Was Left Out Before and Is Now Closed

1. Institutional deep-audit routing decomposition
- Implemented in `server/routes/adminInstitutionalAudit.ts`.
- Mounted before legacy monolith in `server/routes.ts`.

2. Deep audit exports as durable background jobs
- Added `trade_audit` and `order_intent_audit` export types in `shared/admin/dataExports.ts`.
- Implemented CSV/JSONL builders in `server/services/adminDataExportBuild.ts`.
- Added convenience creation endpoints in `server/routes/adminDataExports.ts`.

3. Hedgefund-grade column capture and linkage support
- Trade/order audit exporters include exhaustive forensic fields and chain identifiers.
- Deep linkage map logic is in `server/services/adminAuditTrail.ts` and exposed by `/api/admin/audit-trail`.

4. ClickHouse audit sync + metrics expansion
- Added CH tables and sync loops for `admin_trade_audit` and `admin_order_intent_audit` in `server/services/clickhouseSync.ts`.
- Added sync metrics output in `server/routes/wsCore.ts`.

5. Request-path collision risk after decomposition
- Fixed by moving duplicate monolith handlers to `/api/admin/_legacy/*` in `server/routes/admin.ts`.
- Canonical public paths are now served by decomposed routers.

6. Trader scouting decomposition
- Canonical `/api/admin/trader-scouting/*` routes are now extracted to `server/routes/adminTraderScouting.ts`.
- Router is mounted before `registerAdminRoutes(app)` in `server/routes.ts`.

## 3) Remaining Open Items (True Gaps)

1. Full `admin.ts` decomposition is still incomplete.
- The file remains large and should be split into bounded routers (users, kyc, waitlist, ops, etc.).

2. Live production rollout validation remains pending.
- Worker canary + 24h observation + API cutover with new ingress/network policy SLO tracking require real OVH/k8s environment.
- Concrete runbook + orchestration are now in-repo:
  - `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md`
  - `scripts/ops/canary_cutover_runbook.sh`

3. Full production security operations closure remains environment-dependent.
- DDoS/exfil runbook drills and alert response validation must be executed in target infra.

## 4) Validation Completed in This Cycle

Successful runs:
- `npm run check`
- `npm run build`
- `npm run audit:petascale-parquet` (`pass=19 fail=0`)
- `CYCLES=20 UNIT_EVERY=4 LOAD_EVERY=10 HEAVY_EVERY=20 K8S_EVERY=20 AUDIT_EVERY=20 npm run audit:system:20-cycles` (`DONE pass_count=20 cycles=20`, includes e2e/load/audit/k8s gates)
- `npm run ops:canary-cutover -- --dry-run` (command plan and manifest sequence validated)

Non-blocking local warnings observed:
- Missing optional provider secrets (Twilio/Resend/OpenAI i18n), invalid local 1Forge key.

## 5) Production Requirement Ledger
Added new requirement:
- `PRD-AUD-006` in `.agents/PRODUCTION_REQUIREMENTS.md`
- Scope: prevent decomposed-route regressions by isolating/removing legacy duplicate public path registrations.
- `PRD-OPS-005` in `.agents/PRODUCTION_REQUIREMENTS.md`
- Scope: mandatory worker-canary gate and observed SLO window before API cutover on export/analytics infra changes.
