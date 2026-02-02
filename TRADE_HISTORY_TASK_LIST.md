# Trade History Not Showing (Traders) — Task List (3 Passes)

Date (UTC): 2026-02-02

## Pass 1 — Root cause + fix (trade history visibility)
- [x] Reproduce: `GET /api/trades` returns only `OPEN/PENDING`; no `CLOSED` rows exist.
- [x] Reproduce: `POST /api/trades/:id/close` returns `409 Market is closed` even when `global_settings` allows 24/7 + weekends.
- [x] Identify root cause: execution quote `marketOpen` used FX-hours logic, diverging from `global_settings` market window used by risk/open flows.
- [x] Fix: make execution-quote `marketOpen` respect `global_settings` (cached) so manual close isn’t hard-blocked in relaxed-market-hour environments.
- [x] Verify: manual close writes `status=CLOSED` (`closed_at`, `close_price`, `profit`) and History can populate.

## Pass 2 — DB + retrieval wiring hardening
- [x] Add dedicated trade-history retrieval endpoint: `GET /api/trades/history`.
- [x] Wire web UI History screen to `GET /api/trades/history` (avoids shipping OPEN/PENDING trades to History).
- [x] Ensure trade WS invalidations/optimistic updates include `/api/trades/history`.
- [x] Add Postgres indexes supporting hot query patterns (user open/pending/history + symbol/status).
- [x] Fix background inactivity sweep SQL boolean predicates (prevents Postgres operator errors).
- [x] Run DB checks: migrations + schema dump + schema audit + ensure.

## Pass 3 — Regression prevention + full verification
- [x] Add E2E: place market order → close → verify appears in History.
- [x] Stabilize existing E2E selectors to match current UI (avoid brittle text selectors).
- [x] Make E2E deterministic: relax `minHoldSec` under `SEED_RELAX_MARKET_HOURS=1` (prevents 60s waits in CI/E2E).
- [x] Run: `npm run check`, `npm run build`, `npm run e2e` (green).

## Follow-ups / watchlist (recommended)
- [ ] Review repo security scan report (OSV): outstanding advisories (esbuild, tar) + base image CVEs.
- [ ] Consider adding server-side pagination for `/api/trades/history` if history sizes grow materially.
- [ ] Add a lightweight “DB index presence” check to `scripts/dbAudit.ts` (optional; current audit is columns-only).
- [ ] If migrating from legacy SQLite: recover user trade history into Postgres via `npm run db:recover:sqlite-trades` (see `DB_HARDENING_REPORT.md`).
