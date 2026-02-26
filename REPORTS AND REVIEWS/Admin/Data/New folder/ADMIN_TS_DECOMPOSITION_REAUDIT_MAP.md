# Admin.ts Decomposition Reaudit Map (Updated)

Date: 2026-02-25  
Repo: `/home/bcodex/TD.2.ANTIGRAVITY`

## 1) Purpose
Provide a clear carry-over map for `server/routes/admin.ts` decomposition, with explicit status of what is already extracted, what was left out before, and what still must be extracted without breaking behavior.

## 2) Current Reality Snapshot

1. `server/routes/admin.ts` is still large (`~3.5k LOC`), but reduced materially after trader-scouting extraction.
2. Canonical DataTab hot routes are now owned by decomposed routers:
- `server/routes/adminDataRollups.ts`
- `server/routes/adminInstitutionalAudit.ts`
 - `server/routes/adminTraderScouting.ts`
3. Legacy duplicate handlers are no longer registered on canonical public paths; they were remapped to `/api/admin/_legacy/*` in `server/routes/admin.ts`.
4. Async export platform is canonical (`server/routes/adminDataExports.ts` + queue/repo/build/object storage services).

## 3) Mount Order and Safety

In `server/routes.ts`, canonical decomposed routers are mounted before `registerAdminRoutes(app)`:
- `/api/admin` -> `adminDataRollupsRouter`
- `/api/admin` -> `adminInstitutionalAuditRouter`
- `/api/admin` -> `adminTraderScoutingRouter`

This ensures canonical paths are served by decomposed modules.

Additional hardening now applied:
- Legacy monolith duplicates moved to:
  - `/api/admin/_legacy/kpi-summary`
  - `/api/admin/_legacy/signup-funnel`
  - `/api/admin/_legacy/user-analytics`
  - `/api/admin/_legacy/analytics/compliance`
  - `/api/admin/_legacy/deactivated-accounts/summary`
  - `/api/admin/_legacy/trade-audit`
  - `/api/admin/_legacy/order-intent-audit`
  - `/api/admin/_legacy/audit-trail`
  - `/api/admin/_legacy/export-manifests`
  - `/api/admin/_legacy/trade-audit/export/csv|jsonl`
  - `/api/admin/_legacy/order-intent-audit/export/csv`

## 4) Already Decomposed (Canonical)

1. `adminDataRollupsRouter`
- Public canonical routes:
  - `GET /api/admin/kpi-summary`
  - `GET /api/admin/signup-funnel`
  - `GET /api/admin/user-analytics`
  - `GET /api/admin/analytics/compliance`
  - `GET /api/admin/deactivated-accounts/summary`

2. `adminInstitutionalAuditRouter`
- Public canonical routes:
  - `GET /api/admin/trade-audit`
  - `GET /api/admin/order-intent-audit`
  - `GET /api/admin/audit-trail`
  - `GET /api/admin/export-manifests`
  - `GET /api/admin/trade-audit/export/csv|jsonl` (queue-based)
  - `GET /api/admin/order-intent-audit/export/csv|jsonl` (queue-based)

3. `adminDataExportsRouter`
- Durable job lifecycle routes:
  - create/list/status/events/retry/cancel/download-link/files
  - convenience create endpoints for trader/deactivated/trade-audit/order-intent-audit

4. `adminTraderScoutingRouter`
- Public canonical routes:
  - `GET /api/admin/trader-scouting/categories`
  - `GET /api/admin/trader-scouting/search`
  - `GET /api/admin/trader-scouting/:userId/asset-classes`
  - `GET /api/admin/trader-scouting/:userId/trade-extremes`

## 5) Decomposition Backlog (Still in Monolith)

These domains remain in `server/routes/admin.ts` and should be extracted next in bounded routers:

1. `adminSymbolsRouter`
- `/api/admin/symbols*`

2. `adminUsersRouter`
- `/api/admin/users*`, `/api/admin/notes*`, `/api/admin/login-history`, `/api/admin/online-users`, bulk user ops

3. `adminUserExportsRouter`
- `/api/admin/export/users*`

4. `adminViewAsRouter`
- `/api/admin/view-as/*`

5. `adminKycRouter`
- `/api/admin/kyc*`, `/api/admin/user-profiles`, `/api/admin/users/:id/kyc-status`, `/api/admin/users/:id/tier`

6. `adminIdentityAuditRouter`
- `/api/admin/identity-audit*`

7. `adminFxClosesRouter`
- `/api/admin/daily-fx-closes*`

8. `adminGlobalSettingsRouter` (legacy block)
- `/api/admin/global-settings` legacy handlers (dedupe against existing adminSystemConfig route surface)

9. `adminWaitlistRouter`
- `/api/admin/signup-waitlist*`

10. `adminOpsRouter`
- `/api/admin/system-health`, `/api/admin/trader-stats`, `/api/admin/all-trades`, `/api/admin/daily-pnl`

## 6) Deep Audit Trail Exhaustive Capture Map

### Trade Audit (`trade_audit`) capture groups
- IDs and lifecycle: `id`, `trade_id`, `correlation_id`, `order_id`, `execution_id`, `position_id`
- Event metadata: `event_type`, `event_category`, `event_at`, `event_at_ms`
- Provenance: `actor_type`, `actor_user_id`, `session_id`, `ip`, `user_agent`
- Order/economics: `symbol`, `side`, `order_type`, `time_in_force`, `qty_lots`, `notional_usd`
- Cost/PnL snapshot: gross/net/cost/commission/fees/financing/swap/overnight/category/cost model
- Price/quote/TCA: requested/trigger/limit/stop/fill/avg fill, quote fields, spread/slippage/latency
- Risk evidence: `risk_check_name`, `risk_limit_value`, `risk_observed_value`, `risk_result`, `reason_code`
- Tamper evidence: `payload_json`, `prev_hash`, `event_hash`
- Linked user context in exports: `user_id`, `username`, `user_email`

### Order Intent Audit (`order_intent_audit`) capture groups
- IDs/timing: `id`, `correlation_id`, `event_at`, `event_at_ms`, `event_code`
- Decision evidence: `decision`, `reject_check`, `reject_reason`
- Provenance: `actor_type`, `user_id`, `session_id`, `ip`, `user_agent`
- Order snapshot: symbol/side/type/tif/qty/prices/tp/sl
- Quote/risk snapshot: quote fields + risk JSON snapshots
- Tamper evidence: `payload_json`, `prev_hash`, `event_hash`
- Linked user context in exports: `username`, `user_email`

### Cross-system linkage keys
- `correlation_id`
- `session_id`
- `user_id` / `actor_user_id`
- `trade_id` / `order_id` / `execution_id` / `position_id`
- `event_hash` + `prev_hash`

Implementation surface:
- Deep selectors/linkage: `server/services/adminAuditTrail.ts`
- Deep export builders: `server/services/adminDataExportBuild.ts`
- CH sync/query for deep exports: `server/services/clickhouseSync.ts`, `server/services/adminDataExportBuildClickhouse.ts`

## 7) Remaining Gaps (Accurate)

1. Full monolith breakup is incomplete.
2. Keyset pagination and some heavy admin lists (outside rollup/audit scopes) still need targeted extraction/hardening.
3. Production canary/cutover validation is pending live OVH/k8s execution (cannot be fully validated locally).

## 8) Validation Completed in This Reaudit Cycle

Executed and passing:
- `npm run check`
- `npm run build`
- `npm run audit:petascale-parquet`
- `CYCLES=20 UNIT_EVERY=4 LOAD_EVERY=10 HEAVY_EVERY=20 K8S_EVERY=20 AUDIT_EVERY=20 npm run audit:system:20-cycles` (20/20 pass, includes e2e/load/audit/k8s gates)

## 9) Decomposition Next Steps (No Functionality Loss)

1. Extract `adminOpsRouter` next (highest scale impact after current work).
2. Add route-level contract tests before each extraction batch.
3. After each extraction, move replaced monolith paths to `_legacy` and keep canonical router as single public owner.
4. Continue until `registerAdminRoutes` only wires legacy domains not yet extracted.
