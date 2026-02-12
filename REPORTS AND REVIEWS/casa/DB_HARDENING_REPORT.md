# DB Hardening Report — Trade History Fix (TradeQuip / TD.2.ANTIGRAVITY)

Date (UTC): 2026-02-02

## Executive summary
Trade history was “missing” for traders because positions could not be manually closed when `global_settings` was configured for 24/7 + weekend trading (E2E/dev mode). The close path used an FX-hours `marketOpen` calculation (Sunday 22:00 UTC → Friday 22:00 UTC), causing `POST /api/trades/:id/close` to return `409 Market is closed`, leaving no `CLOSED` rows to display.

Fixes shipped:
1) execution quote `marketOpen` now respects `global_settings` market hours (cached), unblocking close → CLOSED trade rows, and
2) History screen now fetches trade-history only (`/api/trades/history`) and the DB gained supporting indexes.

## Root cause + impact
### Symptom
- History UI showed “No trades found” for traders.
- DB had `OPEN/PENDING` trades but no `CLOSED` rows.

### Root cause
- `/api/trades/:id/close` blocks on `q.marketOpen === false`.
- `q.marketOpen` came from `server/services/marketHours.ts` (FX-hours), while open/risk behavior uses `global_settings` market window (and E2E seed relaxes this to 24/7).
- Result: traders could open positions (per global settings) but could not close them (per FX-hours), preventing history population.

## Postgres vs SQLite (and why “history was stuck”)
This codebase is **Postgres-only** at runtime (`db/config.ts` requires `DATABASE_URL` and declares `dbDialect="postgres"`). SQLite `.db` files in the repo are **legacy artifacts/backups** from the pre-Postgres era and are only used for one-time migrations/recovery tooling.

If you see “missing history” for a specific user after moving to Postgres, it usually means:
- the user/trades were never migrated from the legacy SQLite DB into Postgres, or
- the Postgres `trades` table was wiped/reset at some point (see seed guard below).

## Fixes implemented
### Trade close market-hours alignment (server)
- `server/services/quoteService.ts`: `getExecutionQuote()` now computes `marketOpen` using `global_settings` (cached; fallback to FX-hours if unavailable).

### Trade history retrieval (server + client)
- `server/storage.ts`: added `getTradeHistoryByUserId()` (closed + canceled).
- `server/routes.ts`: added `GET /api/trades/history`.
- `client/src/pages/HistoryScreen.tsx`: switched History query to `"/api/trades/history"`.
- `client/src/hooks/use-trades.tsx`: invalidates and optimistically updates `"/api/trades/history"` on trade updates/closes.

## DB hardening changes
### Indexes (Postgres)
- Migration: `db/migrations/0009_trades_indexes.sql`
  - `trades_user_opened_at_idx` (`user_id`, `opened_at`)
  - `trades_user_status_opened_at_idx` (`user_id`, `status`, `opened_at`)
  - `trades_symbol_status_opened_at_idx` (`symbol_id`, `status`, `opened_at`)
  - `trades_user_closed_at_history_idx` (`user_id`, `closed_at`) WHERE `status IN ('CLOSED','CANCELED')`
  - `trades_open_opened_at_idx` (`opened_at`) WHERE `status='OPEN'`

### Deletion/wipe guardrails (Postgres)
- Migration: `db/migrations/0010_trade_delete_guards.sql`
  - Adds DB-level **BEFORE DELETE** and **BEFORE TRUNCATE** triggers on:
    - `trades`
    - `trade_audit`
    - `order_intent_audit`
  - Any attempt to delete/truncate these tables now fails unless the session/transaction sets:
    - `SELECT set_config('tradequip.allow_destructive', '1', true);`

### Connection pool hardening (opt-in)
- `db/index.ts`: optional pool envs (no behavior change unless set):
  - `PG_POOL_MAX`
  - `PG_POOL_IDLE_TIMEOUT_MS`
  - `PG_POOL_CONNECTION_TIMEOUT_MS`

### DB audit hardening (prevents future regressions)
- `scripts/dbAudit.ts`: `npm run db:audit` now also verifies:
  - required `trades` indexes from `db/migrations/0009_trades_indexes.sql`, and
  - required trade-history anti-wipe triggers from `db/migrations/0010_trade_delete_guards.sql`.

### Account lifecycle sweep (Postgres boolean correctness)
- `server/services/accountLifecycle.ts`: fixed inactivity sweep SQL to use boolean predicates (`success IS TRUE`, `is_admin IS FALSE`, `is_deleted IS FALSE`) to prevent Postgres operator errors in background sweeps.

### E2E seed determinism (opt-in)
- `db/seed.ts`: when `SEED_RELAX_MARKET_HOURS=1`, also sets `global_settings.min_hold_sec = 0` so E2E doesn’t need 60s waits to close.
- `db/seed.ts`: destructive reset (`SEED_RESET_TRADES=1`) now also requires `SEED_DESTRUCTIVE_OK=1` and refuses to run under `NODE_ENV=production` to prevent accidental trade-history loss on shared DBs.
- `db/seed.ts`: destructive reset on **non-local** DB hosts now also requires `SEED_DESTRUCTIVE_NONLOCAL_OK=1`.

## Verification / audits run
- DB:
  - `npm run db:migrate:drizzle`
  - `npm run db:schema:dump` (updates `db/schema.pg.sql`)
  - `npm run db:audit` (notes extra `session` table; expected for session store)
  - `npm run db:ensure`
- App:
  - `npm run check`
  - `npm run build`
  - `npm run e2e` (Playwright): all tests passing (including new trade-history regression test).

## Legacy SQLite trade-history recovery (data “stuck” in old DB files)
If a user’s closed trades exist in the legacy SQLite DB (e.g. `trading_app.db`) but do not appear in Postgres, use:

- Dry run (no writes):
  - `RECOVER_EMAIL=user@example.com npm run db:recover:sqlite-trades`
- Apply (imports `CLOSED`/`CANCELED` trades + `trade_audit` for that user):
  - `RECOVER_EMAIL=user@example.com RECOVER_APPLY=1 npm run db:recover:sqlite-trades`

Notes:
- The script defaults to importing **closed/canceled only**. Set `RECOVER_INCLUDE_OPEN=1` to also import open/pending rows (not recommended unless you intend to restore live positions).
- Safety: the script refuses to run if Postgres user IDs don’t match the SQLite user ID for that email, or if trade IDs already exist in Postgres (to avoid corrupting attribution / audit chains).

## Repo-local vuln DB cross-check
- Reviewed `security/vuln-db/trading.yaml`:
  - `TQ-TRD-001` (state transitions): no invalid transition path added; added E2E open→close→history coverage.
  - `TQ-TRD-002` (stale/unverified quotes): stale controls unchanged; manual-close still audits quote provenance.

## Security + performance notes
- Policy gating is unchanged: close route still enforces `requirePolicy("TRADE_CLOSE_OR_REDUCE")`, auth, jurisdiction guard, and bot guard.
- WS hot paths untouched; DB changes are indexes and request-path retrieval only.
- `global_settings` is now the authoritative market-window signal for execution quotes (consistent with risk/open configuration and E2E seeding).
