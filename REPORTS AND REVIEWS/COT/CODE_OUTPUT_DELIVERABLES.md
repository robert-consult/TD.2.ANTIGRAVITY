# Code Output Deliverables (Final)

This file documents what shipped in the repo for:

- Market Data **Provider registry + switching**
- Instruments **Ingestion “Minitab”**
- **Pip defaults + per-instrument overrides**

The source of truth is the repo itself (migrations + server + shared + client). This document is a map + usage guide.

---

## 1) Where the code lives (repo map)

### Database
- `db/migrations/0012_market_data_providers.sql`
- `db/migrations/0013_instrument_reference_and_pips.sql`

### Shared (schemas + validation + pip logic)
- `shared/schema.pg.ts`
- `shared/marketDataProviders.ts` (Zod validation for provider configs)
- `shared/pips.ts` (pip/quote decimals + helpers)

### Server (providers + admin API + quote ingestion)
- `server/marketdata/providerTypes.ts`
- `server/marketdata/providerRegistry.ts`
- `server/marketdata/providerManager.ts`
- `server/marketdata/providers/twelvedata.ts`
- `server/marketdata/providers/oneforge.ts`
- `server/marketdata/providers/genericRestV1.ts`
- `server/routes/adminMarketData.ts` (mounted at `/api/admin/market-data`)
- `server/feeds/quoteFeed.ts` (uses provider selection)

### Client (Admin UI)
- `client/src/components/admin/MarketDataProvidersCard.tsx`
- `client/src/components/admin/InstrumentIngestionPanel.tsx`
- `client/src/components/admin/PipDefaultsPanel.tsx`
- `client/src/pages/AdminDashboard.tsx`

---

## 2) Provider configuration: formats + examples

Example upload files (ready to use in the Admin “Upload Config” modal):
- `REPORTS AND REVIEWS/COT/provider-config.twelvedata.json`
- `REPORTS AND REVIEWS/COT/provider-config.1forge.json`
- `REPORTS AND REVIEWS/COT/provider-config.generic_rest_v1.json`

### 2.1 Security rule (important)
Provider API keys **must not be stored in DB**. The admin API enforces that `apiKey` is an env reference:

- ✅ `"apiKey": "env:TWELVE_DATA_API_KEY"`
- ❌ `"apiKey": "abcd1234"`

The server resolves `env:` references at runtime on the server (not in the browser).

### 2.2 Upload shapes accepted by the UI
The upload modal accepts either:

1) **Full envelope**:
```json
{
  "providerKey": "twelvedata",
  "displayName": "Twelve Data",
  "driver": "twelvedata",
  "config": { "driver": "twelvedata", "apiKey": "env:TWELVE_DATA_API_KEY" }
}
```

2) **Raw config** (must include `driver`; you fill providerKey/displayName in the modal):
```json
{ "driver": "twelvedata", "apiKey": "env:TWELVE_DATA_API_KEY" }
```

### 2.3 Twelve Data example
```json
{
  "driver": "twelvedata",
  "apiKey": "env:TWELVE_DATA_API_KEY",
  "restBaseUrl": "https://api.twelvedata.com",
  "quoteEndpoint": "/price",
  "timeoutMs": 8000,
  "maxBatchSymbols": 8
}
```

### 2.4 1Forge example
```json
{
  "driver": "oneforge",
  "apiKey": "env:FORGE_KEY",
  "restBaseUrl": "https://api.1forge.com",
  "timeoutMs": 8000,
  "maxBatchSymbols": 200
}
```

### 2.5 Generic REST v1 example (future providers)
```json
{
  "driver": "generic_rest_v1",
  "restBaseUrl": "https://api.example.com",
  "quotePath": "/quotes?symbols={{symbols}}",
  "symbolsParamName": "symbols",
  "symbolsJoinChar": ",",
  "apiKeyParamName": "apikey",
  "apiKey": "env:MY_PROVIDER_API_KEY",
  "timeoutMs": 8000,
  "maxBatchSymbols": 50,
  "responseMode": "array",
  "fields": {
    "symbol": "symbol",
    "bid": "bid",
    "ask": "ask",
    "price": "price",
    "timestamp": "timestamp"
  }
}
```

---

## 3) Twelve Data reference-data ingestion mapping
The Twelve Data provider supports these categories/endpoints:

| Category | Endpoint |
|---|---|
| `stocks` | `/stocks` |
| `etf` | `/etf` |
| `forex` | `/forex_pairs` |
| `crypto` | `/cryptocurrencies` |
| `commodities` | `/commodities` |
| `bonds` | `/bonds` |
| `funds` | `/funds` |
| `mutual_funds` | `/mutual_funds/list` |

Ingestion is done via the Admin “Instrument Ingestion” panel, which writes/upserts `instrument_reference`.

---

## 4) Admin API “curl” examples (optional)
All admin endpoints require an authenticated admin session cookie; these examples assume you’re already logged in.

### 4.1 List providers
```bash
curl -sS -b cookies.txt http://127.0.0.1:5000/api/admin/market-data/providers
```

### 4.2 Create/update a provider
```bash
curl -sS -b cookies.txt -H 'content-type: application/json' \
  -d '{"providerKey":"twelvedata","displayName":"Twelve Data","driver":"twelvedata","config":{"driver":"twelvedata","apiKey":"env:TWELVE_DATA_API_KEY"}}' \
  http://127.0.0.1:5000/api/admin/market-data/providers
```

### 4.3 Activate provider
```bash
curl -sS -b cookies.txt -X POST http://127.0.0.1:5000/api/admin/market-data/providers/twelvedata/activate
```

### 4.4 Refresh reference list (example: US stocks)
```bash
curl -sS -b cookies.txt -H 'content-type: application/json' \
  -d '{"providerKey":"twelvedata","category":"stocks","filter":{"country":"United States"},"limit":500}' \
  http://127.0.0.1:5000/api/admin/market-data/instruments/reference/refresh
```

### 4.5 Search ingested reference catalog
```bash
curl -sS -b cookies.txt \
  'http://127.0.0.1:5000/api/admin/market-data/instruments/reference/search?providerKey=twelvedata&category=stocks&q=AAPL&limit=50&offset=0'
```

### 4.6 Enable reference rows into `symbol_configs`
```bash
curl -sS -b cookies.txt -H 'content-type: application/json' \
  -d '{"providerKey":"twelvedata","ids":[1,2,3]}' \
  http://127.0.0.1:5000/api/admin/market-data/instruments/reference/enable
```

---

## 5) Pip defaults + per-symbol overrides

### 5.1 Category defaults
Defaults live in `pip_category_defaults` and are editable from Admin UI.
Example update:
```bash
curl -sS -b cookies.txt -X PUT -H 'content-type: application/json' \
  -d '{"pipDecimals":4,"quoteDecimals":5}' \
  http://127.0.0.1:5000/api/admin/market-data/pip-defaults/forex
```

### 5.2 Per-symbol overrides
Admins can set:
- `symbol_configs.pip_decimals` (override)
- `symbol_configs.quote_decimals` (override)

Server and client resolve the effective values via `shared/pips.ts`.

---

## 6) Verification commands (Definition of Done)
```bash
npm run check
npm run build
npm run e2e
```
DB/schema changes (when applicable):
```bash
npm run db:migrate:drizzle
npm run db:audit
```
