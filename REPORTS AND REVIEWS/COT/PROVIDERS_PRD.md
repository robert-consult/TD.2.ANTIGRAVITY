# Market Data Providers + Instruments “Minitab” + Pip Defaults — PRD (Implemented)

**Project:** TradeQuip / tradehub (TD.2.ANTIGRAVITY)  
**Status:** Implemented in repo (Feb 2026)  
**Primary goal:** Admin can ingest instruments + switch market data providers without code changes.

---

## 1) Executive Summary
TradeQuip now supports a modular Market Data Provider framework with:

- **Instant provider switching** from the Admin Dashboard (Twelve Data primary; 1Forge retained; plus future providers via JSON config upload).
- **Instrument ingestion (“Minitab”)**: fetch provider reference lists (forex, stocks, crypto, bonds, etc.) into a local catalog and selectively enable them into `symbol_configs`.
- **Pip/precision system**: default pip/quote decimals per category with **per-instrument overrides**, so risk checks and trade validations are deterministic across asset classes.

This work is implemented with a DB-backed provider registry, a provider strategy interface, and an admin surface area to manage providers and instrument catalogs.

---

## 2) Goals (Functional Requirements)

### 2.1 Provider Switching (Admin)
- Admin can **view** all providers, see which is active, and **activate** another provider instantly.
- Admin can **upload provider configs** as JSON (file upload or paste) to add future providers without code changes.
- Admin can **test** a provider config against a sample symbol list (default: `EURUSD`).
- Admin can **delete** non-builtin providers (soft delete), with guardrails:
  - Built-ins `twelvedata` and `1forge` cannot be deleted.
  - Active provider cannot be deleted.

### 2.2 Provider Support (Drivers)
The provider registry supports three drivers:

1) `twelvedata` — REST quotes + reference-data lists  
2) `oneforge` — legacy 1Forge REST quotes adapter  
3) `generic_rest_v1` — config-driven REST adapter for future providers

### 2.3 Instrument Ingestion (Admin “Minitab”)
- Admin can fetch a provider’s **reference lists** into `instrument_reference`.
- Admin can browse/search ingested reference rows and **enable selected instruments** into `symbol_configs`.
- Enabling an instrument also writes **provider symbol mappings** so switching providers remains seamless.

### 2.4 Pip Decimalization (Admin “Minitab”)
- Admin can edit **category defaults**: `pip_decimals` and optional `quote_decimals` (formatting/precision hints).
- Admin can override per-instrument `pip_decimals` / `quote_decimals` in the instrument edit flow.
- Trade placement and trade edits use these definitions for **minimum distance** checks and target validation.

---

## 3) Non-Goals (This Phase)
- “No-code” arbitrary adapters beyond `generic_rest_v1` (i.e., no custom scripting, no user-provided executable code).
- Provider-level automatic failover based on rate-limit detection; the system currently falls back to cached quotes on provider failure (availability-first), and admins can manually switch providers.
- A dedicated “list all indices” ingestion endpoint for Twelve Data (not confirmed as a first-class catalog list endpoint in the provided references); indices remain supported as symbols.

---

## 4) Constraints / NFRs (Repo Non-Negotiables)
- **Hot-path performance**: no accidental O(clients * symbols) regressions in `/ws` or quote ingestion.
- **Institutional-grade security**: do not weaken `requirePolicy()`, jurisdiction controls, legal acceptance integrity, or audit trails.
- **Secrets**: provider API keys are **never stored directly** in the DB; only `env:...` references are accepted.

---

## 5) Architecture Overview (What Changed)

### 5.1 Provider strategy interface
Providers implement `MarketDataProvider` (quotes + optional reference-data):

- `fetchQuotes({ symbols: [{ canonicalSymbol, providerSymbol }] })`
- `listReference({ category, filter, limit })` (optional; Twelve Data supports, 1Forge does not)

Key files:
- `server/marketdata/providerTypes.ts`
- `server/marketdata/providerRegistry.ts`
- `server/marketdata/providerManager.ts`
- `server/marketdata/providers/twelvedata.ts`
- `server/marketdata/providers/oneforge.ts`
- `server/marketdata/providers/genericRestV1.ts`

### 5.2 Provider selection & caching (“instant switch”)
The active provider is DB-driven (system config) and cached for low overhead.
Cache invalidates on:
- `market-data:providers-updated`
- `system-config:updated`

Key file:
- `server/marketdata/providerManager.ts` (TTL default ~2s; event invalidation for immediate cutover)

### 5.3 Quote ingestion refactor (no longer hardcoded 1Forge)
`server/feeds/quoteFeed.ts` now:
- Looks up active provider selection each poll.
- Uses `providerSymbolMapJson` to map each enabled symbol to provider-specific identifiers.
- Falls back to simulated quotes (E2E) or persisted cache where necessary.

Key file:
- `server/feeds/quoteFeed.ts`

### 5.4 Pip/precision rules are centralized
Shared utility resolves pip size/decimals based on per-symbol overrides, category defaults, and safe fallbacks:

- `shared/pips.ts`

It is consumed in server trade validation and client formatting.

---

## 6) Data Model (DB)
Migrations:
- `db/migrations/0012_market_data_providers.sql`
- `db/migrations/0013_instrument_reference_and_pips.sql`

### 6.1 `market_data_providers`
Stores provider registry rows:
- `provider_key` (unique stable key)
- `driver` (`twelvedata` | `oneforge` | `generic_rest_v1`)
- `display_name`
- `config_json` (validated JSON)
- `is_enabled`, `deleted_at`, timestamps

### 6.2 `system_config`
Adds provider selection fields:
- `market_data_active_provider_key`
- `market_data_fallback_provider_keys_csv` (reserved for future/optional failover)

### 6.3 `instrument_reference`
Provider ingestion catalog (not necessarily enabled for trading):
- `provider_key`
- `category`
- `canonical_symbol` (TradeQuip internal stable key)
- `provider_symbol` (provider’s native string)
- optional metadata: `name`, `country`, `exchange`, `currency_base`, `currency_quote`, `region`, `meta_json`

### 6.4 `pip_category_defaults`
Default pip settings per category:
- `category` (PK)
- `pip_decimals`
- `quote_decimals` (optional)

### 6.5 `symbol_configs` (extended)
Enabled instruments for the platform now include:
- `category`
- `pip_decimals` (nullable override)
- `quote_decimals` (nullable override)
- `provider_symbol_map_json` (JSON map of providerKey → providerSymbol)

---

## 7) Admin API Surface
Mounted at:
- `server/routes/adminMarketData.ts` → `/api/admin/market-data/*`

### Providers
- `GET /api/admin/market-data/providers`
- `POST /api/admin/market-data/providers` (create/update via JSON payload)
- `POST /api/admin/market-data/providers/:providerKey/activate`
- `POST /api/admin/market-data/providers/:providerKey/test`
- `DELETE /api/admin/market-data/providers/:providerKey`

### Instrument Reference / Ingestion
- `POST /api/admin/market-data/instruments/reference/refresh`
- `GET /api/admin/market-data/instruments/reference/search`
- `POST /api/admin/market-data/instruments/reference/enable`

### Pip Defaults
- `GET /api/admin/market-data/pip-defaults`
- `PUT /api/admin/market-data/pip-defaults/:category`

---

## 8) Admin UI/UX (Where it lives)

### 8.1 Providers (System Config → Market Data)
- `client/src/components/admin/MarketDataProvidersCard.tsx`
- Wired into `client/src/pages/AdminDashboard.tsx`

### 8.2 Instruments “Minitab” (Instruments tab)
- Ingestion: `client/src/components/admin/InstrumentIngestionPanel.tsx`
- Pip defaults: `client/src/components/admin/PipDefaultsPanel.tsx`
- Per-instrument override fields in symbol create/edit flows (Admin instruments UI)

---

## 9) Security & Audit Requirements
- Provider config secrets must be `env:...` references (enforced server-side).
- Provider keys are validated (`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`).
- Admin routes are protected by `requireAdmin`.
- Existing policy gating and legal acceptance flows remain unchanged.

---

## 10) Acceptance Criteria (Implemented)
- Provider switching takes effect without restart (cache invalidation + TTL).
- Reference ingestion is idempotent (upsert into `instrument_reference`).
- Enabled symbols are written to `symbol_configs` with provider symbol mappings.
- Pip/precision behavior is consistent across:
  - Trade placement (pending orders min-distance)
  - Trade edits
  - Audit pip computations
  - UI formatting

---

## 11) Verification / DoD
- `npm run check`
- `npm run build`
- `npm run e2e`
- DB changes (when applicable): `npm run db:migrate:drizzle` + `npm run db:audit`

---

## 12) Roadmap / Follow-ups (Optional)
- Add Twelve Data WebSocket streaming support (server-side quote hub integration).
- Add admin UI for configuring fallback provider keys (and optional runtime failover behavior).
- Expand stock ingestion UX into “region cards” with curated presets and/or dynamic country list derived from reference data.
