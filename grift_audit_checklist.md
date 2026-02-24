# Grift Detection Audit: Critique + Hardening Map

Date (UTC): 2026-02-23
Scope: `client/src/components/admin/GriftAdmin.tsx`, `server/grift/griftEngine.ts`, Grift DB indexes
Goal: Address findings through enhancements only (no trade/compliance behavior regression), with scale readiness.

## 1) Finding: "Invalid Date" in Identity Links (Last Seen)

### Critique
- Root cause is valid but incomplete: the failure mode is not only ISO strings. PostgreSQL `bigint` fields commonly arrive as string values in Node (`"1739999999000"`), and the local formatter in `GriftAdmin.tsx` is typed as `number` and performs coercive math.
- Current local formatter duplicates shared functionality and weakens consistency vs existing shared time contracts.

### Hardening map
- Replace local `formatTimestamp` parser with shared `formatInstantToLocaleString` (`@shared/time/format`).
- Keep UI fallback deterministic (`"N/A"`), preserving existing UX behavior.
- Do not add new date parsing logic in component scope.

### Non-degradation guardrail
- Rendering-only change; no API payload, auth, policy, or detection-rule changes.

## 2) Finding: Cases tab misses key context fields

### Critique
- Gap is real: `assigned_admin_id`, `created_by_admin_id`, `closed_at`, `resolution` are returned but not surfaced.
- Avoid joining `users` here as first hardening step; extra joins on admin dashboard hot paths can add avoidable overhead at scale.

### Hardening map
- Extend Cases table with `Created By`, `Assigned To`, `Closed`, and `Resolution`.
- Surface admin IDs directly (`#<id>`) with null-safe placeholders; keep query contract unchanged.
- Add resolution truncation in table cell while preserving full value via title/tooltip.

### Non-degradation guardrail
- No new backend calls or query shape expansion for this pass.

## 3) Finding: Edge writes are sequential and bottleneck under load

### Critique
- Problem is valid; recommendation to "just use Promise.all()" is not sufficient and can be counterproductive.
- In this repo, Grift flows frequently run on a single leased PG client (`withGriftClient`), where naive concurrent query fanout does not guarantee throughput gains and can increase queue pressure.

### Hardening map
- Replace per-edge sequential writes with bounded batch upserts (single SQL statement per batch).
- Preserve existing cap (`GRIFT_MAX_LINKED_EDGE_WRITES_PER_TRIGGER`) and dedupe edge keys before insert to avoid duplicate `ON CONFLICT` collisions.
- Keep confidence increment semantics and conflict target unchanged.

### Non-degradation guardrail
- No change to scoring thresholds, rule firing conditions, or evidence semantics beyond accurate edge-write counts.

## 4) Finding: In-memory config cache staleness across pods

### Critique
- 60s fixed TTL is too coarse for distributed mitigation tuning.
- Full distributed invalidation (pub/sub) is larger in scope; safe near-term fix is bounded TTL configurability.

### Hardening map
- Make TTL configurable via env (`GRIFT_CONFIG_TTL_MS`) with safe bounds and lower default staleness window.
- Preserve explicit local invalidation on admin config update (`invalidateConfigCache()`).

### Non-degradation guardrail
- Bound minimum TTL to prevent DB thrash from accidental ultra-low values.

## 5) Finding: Missing indexes for high-frequency correlation paths

### Critique
- Index coverage is currently sparse for `grift_observations`, `grift_trade_observations`, and read-heavy edge traversals.
- Broad "index everything" guidance risks write amplification; indexes must map directly to active predicates/orderings.

### Hardening map
- Add targeted indexes only for proven predicates/orderings:
  - `grift_observations (user_id, observed_at DESC)`
  - `grift_observations (ip, asn, observed_at DESC, user_id)`
  - `grift_trade_observations (symbol, direction, observed_at DESC)`
  - `grift_trade_observations (user_id, symbol, direction, observed_at DESC)`
  - `grift_linked_account_edges (user_a, last_confirmed_at DESC)`
  - `grift_linked_account_edges (user_b, last_confirmed_at DESC)`
  - `grift_device_users (device_id, last_seen_at DESC)`
- Apply via deterministic migration and mirror in shared schema metadata.

### Non-degradation guardrail
- Keep index set minimal and query-driven to limit extra write cost.

## 6) Implementation status map
- [x] Frontend time formatting hardening (`GriftAdmin.tsx`)
- [x] Cases table context expansion (`GriftAdmin.tsx`)
- [x] Batched linked-edge upserts (`griftEngine.ts`)
- [x] Config TTL hardening (`griftEngine.ts`)
- [x] Grift read-path indexes (migration + `shared/schema.pg.ts`)
- [ ] Validation: `npm run check` (long-running/aborted in interactive session; rerun recommended before merge)
- [x] Validation: `npm run build`
- [x] Validation: `npm run db:migrate:drizzle`
- [x] Validation: `npm run db:audit`

## 7) Acceptance criteria (must pass before merge)
- No `Invalid Date` for numeric-string, unix-sec, unix-ms, or ISO inputs in Grift admin views.
- Cases tab shows assignment, closure, and resolution context without extra API calls.
- Edge recording is bounded and batch-based, with no rule-score behavior changes.
- Config updates propagate within bounded TTL window (env-tunable) without process restart.
- Query plans for Grift correlation paths hit targeted indexes in production-like DB.
