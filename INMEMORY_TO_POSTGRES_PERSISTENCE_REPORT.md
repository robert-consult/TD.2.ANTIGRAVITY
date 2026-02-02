# In‑Memory + Valkey → Postgres Durability Report (TradeQuip / TD.2.ANTIGRAVITY)

Date (UTC): 2026-02-02

## Executive summary
- **Trades and trade history are persisted directly to Postgres** (`trades`, `trade_audit`, `order_intent_audit`). Valkey is **not** a trade durability layer.
- **Valkey + in‑process memory are used for low-latency quote distribution and cross-instance fanout**, not as the source of truth for trade lifecycle.
- **Quote persistence to Postgres is optional** (env-controlled). If you want “persist-as-you-go” durability for quotes, enable `QUOTE_DB_WRITE_MODE` (recommended: `interval`).

## Sources of truth vs cache (by subsystem)

### Trades (durable, authoritative)
- **Source of truth:** Postgres
  - Tables: `trades`, `trade_audit`, `order_intent_audit`
  - Write paths:
    - Open/submit: `server/routes.ts` → `storage.createTrade()` (insert) → `writeTradeAudit()`
    - Close: `server/routes.ts` → `storage.closeTrade()` (update) → `writeTradeAudit()`
  - Read paths:
    - All: `GET /api/trades` → `storage.getTradesByUserId()`
    - History (closed/canceled): `GET /api/trades/history` → `storage.getTradeHistoryByUserId()`
    - Open: `GET /api/trades/open` → `storage.getOpenTradesByUserId()`
    - Pending: `GET /api/trades/pending` → `storage.getPendingTradesByUserId()`
- **Caches involved:** none required for durability (WS broadcasts are for UI sync only).

### Quotes (fast path, cache-first; durability optional)
- **In-process cache:** `server/services/quoteHub.ts` (`quoteMap`)
- **Valkey caches (TTL / ephemeral):**
  - Snapshot: `quotes:latest:v1` (env: `QUOTE_SNAPSHOT_KEY`)
  - Per-symbol: `q:v1:{SYMBOL}`
  - Rolling buffer: `quote:rolling:{SYMBOL}` (30s window)
  - PrevClose cache: `prevClose:{SYMBOL}` (24h TTL)
- **Optional Postgres durability:** `server/feeds/quoteFeed.ts` can upsert latest quotes into `quotes` table when `QUOTE_DB_WRITE_MODE` is enabled.
- **Daily close durability:** `server/feeds/quoteFeed.ts` writes `market_daily_close` on an interval and caches prevClose.

### Sessions (durability depends on configuration)
- Session store can be:
  - **Postgres (default):** `connect-pg-simple` table `session`
  - **Valkey:** `connect-redis` keys `sess:*`
- See `server/services/sessionStore.ts`.

### Live updates (not durable)
- `server/services/liveBus.ts` emits events locally and optionally publishes/subscribes via Valkey PubSub (`livebus:events`) for multi-instance fanout.
- `/ws` clients receive deltas (`quotes:update`, `trades:updated`, `account:updated`, etc.). These are **not** durability.

## Call-path diagrams (high level)

### Trade open/close → Postgres (durable) → WS (UI sync)
1. Client `POST /api/trades` or `POST /api/trades/:id/close`
2. Server enforces auth + policy + legal acceptance + bot guard (`server/routes.ts`)
3. Server writes trade rows and audit rows in Postgres (`server/storage.ts`, `server/lib/auditWriter.ts`)
4. Server broadcasts `trades:updated` (WS) so other sessions refresh

### Quote ingestion → cache (Valkey + in-proc) → optional Postgres
1. Quote feed polls provider (`server/feeds/quoteFeed.ts`)
2. Batch handler:
   - writes rolling buffer (Valkey)
   - optionally persists daily close (Postgres)
   - optionally persists latest quotes (Postgres)
   - publishes `quotes:update` (LiveBus → WS)
   - persists snapshot/per-symbol values (Valkey)
3. Quote hub applies deltas (`server/services/quoteHub.ts`)

### Execution quote read (close/open) — fallback chain
`server/services/quoteService.ts:getLatestQuoteRow()`:
1. in-process quote hub
2. Valkey per-symbol snapshot
3. Valkey rolling buffer
4. Postgres `quotes` table
5. Valkey `prevClose` fallback (last resort)

## “Persist-as-you-go” posture: what should be durable?

### Trades (already durable)
No action needed: trade lifecycle writes are synchronous Postgres writes.

### Quotes (durability is a product decision)
If you want quotes to survive Valkey loss / process restarts (last-known values), enable DB writes:
- Recommended:
  - `QUOTE_DB_WRITE_MODE=interval`
  - `QUOTE_DB_WRITE_INTERVAL_MS=60000` (or lower if symbol count is small and you need tighter recovery)

Rationale: writing every tick scales poorly; interval upserts keep durability without turning quotes into a DB hot path.

## Failure modes and how to diagnose

### “Trade history missing” for a user
1. Check Postgres counts:
   - `SELECT status, count(*) FROM trades t JOIN users u ON u.id=t.user_id WHERE lower(u.email)=lower($1) GROUP BY status;`
2. If Postgres has `OPEN/PENDING` but no `CLOSED`, validate close path is succeeding (no `409 Market is closed`).
3. If Postgres has **zero** trades but you have legacy `.db` backups:
   - Dry run recovery:
     - `RECOVER_EMAIL=user@example.com SQLITE_DB_PATH=/path/to/trading_app.db npm run db:recover:sqlite-trades`
   - Apply:
     - `RECOVER_EMAIL=user@example.com SQLITE_DB_PATH=/path/to/trading_app.db RECOVER_APPLY=1 npm run db:recover:sqlite-trades`

### “Trades were wiped”
- Verify whether destructive seed was run:
  - Look for `SEED_RESET_TRADES=1` usage (now requires explicit confirmations).
- Check Postgres delete counters (heuristic only):
  - `SELECT n_tup_del FROM pg_stat_all_tables WHERE relname='trades';`

## Guardrails against future deletion/wipe
- DB-level triggers block `DELETE`/`TRUNCATE` on critical trade tables unless explicitly overridden per-session:
  - Migration: `db/migrations/0010_trade_delete_guards.sql`
- Seed is guarded and refuses to run destructively unless explicitly allowed:
  - `SEED_RESET_TRADES=1` requires `SEED_DESTRUCTIVE_OK=1` and refuses `NODE_ENV=production`
- `npm run db:audit` now also verifies the presence of the critical trade indexes and anti-wipe triggers.

