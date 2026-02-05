# Implementation Plan (Delivered): Market Data Providers + Instruments “Minitab” + Pip Defaults

**Status:** Completed (Feb 2026) — this file documents what shipped, where, and how to extend it safely.

---

## Phase 0 — Foundation (DB + shared contracts) ✅

### Migrations
- `db/migrations/0012_market_data_providers.sql`
  - `market_data_providers`
  - `system_config.market_data_active_provider_key`
  - `system_config.market_data_fallback_provider_keys_csv`
  - Seeds built-ins: `twelvedata`, `1forge`

- `db/migrations/0013_instrument_reference_and_pips.sql`
  - `instrument_reference`
  - `pip_category_defaults` (seeded defaults per category)
  - Extends `symbol_configs` with: `category`, `pip_decimals`, `quote_decimals`, `provider_symbol_map_json`

### Shared schema + validation
- `shared/schema.pg.ts` updated for all new tables/columns.
- `shared/marketDataProviders.ts` defines Zod validation for:
  - `twelvedata`
  - `oneforge`
  - `generic_rest_v1`
- `shared/pips.ts` centralizes pip/precision behavior used by server + client.

---

## Phase 1 — Provider framework (server-side) ✅
- `server/marketdata/providerTypes.ts` (`MarketDataProvider` interface + quote shapes)
- `server/marketdata/providerRegistry.ts` (driver → provider factory)
- `server/marketdata/providerManager.ts`
  - Reads active provider selection from DB
  - Caches selection with short TTL
  - Invalidates on live-bus events (`market-data:providers-updated`, `system-config:updated`)
- Provider implementations:
  - `server/marketdata/providers/twelvedata.ts`
  - `server/marketdata/providers/oneforge.ts`
  - `server/marketdata/providers/genericRestV1.ts`

---

## Phase 2 — Quote ingestion refactor ✅
- `server/feeds/quoteFeed.ts` now:
  - Resolves active provider each poll
  - Maps canonical symbols via `provider_symbol_map_json` (per-symbol override)
  - Uses provider batching (`maxBatchSymbols`)
  - Uses persisted cache/simulated quotes when provider is unavailable (E2E/availability)

---

## Phase 3 — Admin API ✅
Router:
- `server/routes/adminMarketData.ts` mounted at `/api/admin/market-data`

Endpoints:
- Providers: list/create/update/activate/test/delete
- Instruments: reference refresh/search/enable
- Pip defaults: list/update per category

Events published (for immediate cutover + symbol refresh):
- `market-data:providers-updated`
- `symbols:updated`

---

## Phase 4 — Admin UI (“Minitab” + providers card) ✅

### Providers card (System Config → Market Data)
- `client/src/components/admin/MarketDataProvidersCard.tsx`
- Wired in `client/src/pages/AdminDashboard.tsx`

### Instruments “Minitab”
- Ingestion: `client/src/components/admin/InstrumentIngestionPanel.tsx`
- Pip defaults: `client/src/components/admin/PipDefaultsPanel.tsx`
- Per-symbol overrides surfaced in the instrument create/edit UI (Admin instruments)

---

## Security Constraints (Enforced)
- Provider secrets are never stored in DB:
  - API keys must be `env:...` references (validated server-side).
- Admin routes require `requireAdmin`.
- No weakening of policy gating, jurisdiction controls, or audit trails.

---

## Verification (Runbook)
Required:
```bash
npm run check
npm run build
npm run e2e
```
DB/schema (when changed):
```bash
npm run db:migrate:drizzle
npm run db:audit
```

---

## Future enhancements (Optional)
- Add Twelve Data WebSocket provider (quotesWs) for low-latency streaming.
- Add admin UI to edit `system_config.market_data_fallback_provider_keys_csv` (automatic failover policy).
- Add stock-region UX helpers (region cards/presets) on top of existing country/exchange filter JSON.
