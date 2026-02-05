# Provider Config System Enhancement (Quotes Market Data)

## Goals (what we’re enhancing)
1) **Config file ingestion**: allow provider configs to be defined as JSON files and synced into the DB without breaking existing DB-driven behavior.
2) **Modular replaceability**: swapping/overriding provider configs becomes a *replace file + reload* workflow (with safe defaults).
3) **Export capability**: keep “export config” workflows compatible with the same JSON shape used for file-based ingestion.
4) **No flow breakage**: quote feed continues using the existing provider-manager + symbol refresh mechanics.
5) **Security hardening**: secrets stay as `env:` references; admin-only controls; bounded logs.

## Task Breakdown (reference IDs)

### T1 — Align on current repo implementation (no assumptions)
- Verify quote ingestion uses provider manager (not hardcoded provider).
- Verify providers + system selection are DB-backed (`market_data_providers`, `system_config`).
- Verify admin UI already supports provider activate/test/export/upload.

### T2 — Provider config files (templates)
- Create `config/marketdata/providers/*.json` templates matching the *current* export/import format.
- Document supported formats + patching behavior.

### T3 — Config file loader + patching + validation
- Implement a loader that:
  - reads base provider JSON files,
  - applies optional RFC 7396 merge-patch overlays,
  - validates configs with `MarketDataProviderConfigSchema`,
  - rejects raw secrets (requires `env:` refs).
- Implement a DB sync function with modes:
  - `create_missing` (safe default),
  - `upsert` (overwrite/replace existing configs).

### T4 — Wiring (server + admin) + export bundle
- Admin endpoints:
  - preview loaded files,
  - reload/sync files into DB,
  - export a multi-provider bundle for portability.
- Optional startup sync (off by default).
- Publish live-bus events so the UI and quote feed notice provider changes.

### T5 — Admin UI controls
- Add UI actions for:
  - “Reload from disk” (mode-select),
  - “Export bundle”.

### T6 — Hardening + verification
- Confirm no hot-path regressions (WS/quote fanout untouched).
- Confirm admin-only boundaries and no path traversal.
- Run `npm run check` and `npm run build`.

## 5-Cycle Implementation Walkthrough (what was done)

### Cycle 1 — Read docs + audit repo state (T1)
- Reviewed:
  - `REPORTS AND REVIEWS/quotes provider config/*` (provider patching + extra context)
  - Repo market-data implementation (`server/marketdata/*`, `server/routes/adminMarketData.ts`, `server/feeds/quoteFeed.ts`)
  - Applicable `AGENTS.md` and `@/.agents/*` checklists
- Confirmed the platform already has:
  - DB-backed provider registry + selection,
  - quote feed refactored to provider manager,
  - admin provider UI (activate/test/export/upload).

### Cycle 2 — Add provider config templates (T2)
- Added filesystem templates under `config/marketdata/providers/` for:
  - `twelvedata`,
  - `1forge`,
  - `generic_rest_v1` example.
- Added `config/marketdata/providers/README.md` documenting merge-patch and sync modes.

### Cycle 3 — Implement loader + patching + validation (T3)
- Added `server/marketdata/providerConfigFiles.ts`:
  - RFC 7396 JSON merge patch (`*.patch.json`),
  - env-secret enforcement (`env:` refs only),
  - schema validation via `MarketDataProviderConfigSchema`,
  - DB sync modes (`create_missing` / `upsert`).

### Cycle 4 — Wire endpoints + startup sync + UI controls (T4, T5)
- Server:
  - Added admin endpoints:
    - `GET /api/admin/market-data/providers/files`
    - `POST /api/admin/market-data/providers/reload-files`
    - `GET /api/admin/market-data/providers/export-bundle`
  - Optional startup sync in `server/index.ts` (env-gated).
  - Live-bus event publish on reload so providers refresh everywhere.
- Client:
  - Added “Reload From Disk” (mode-select dialog) and “Export Bundle” buttons to Providers card.

### Cycle 5 — Hardening + verification (T6)
- Verified TypeScript + production build:
  - `npm run check`
  - `npm run build`
- Confirmed:
  - file reload endpoints do **not** accept arbitrary paths (no traversal),
  - exported configs redact non-`env:` secrets defensively,
  - quote feed/WS hot paths unchanged.

## How to use (operator runbook)

### A) Put provider files on disk
- Base files:
  - `config/marketdata/providers/twelvedata.json`
  - `config/marketdata/providers/1forge.json`
- Optional overlays:
  - `twelvedata.patch.json`
  - `twelvedata.<NODE_ENV>.patch.json`
  - `twelvedata.local.patch.json`

### B) Reload via Admin UI
- Admin → Market Data → Providers → **Reload From Disk**
- Choose mode:
  - `upsert` to overwrite existing provider configs,
  - `create_missing` to only add missing providers.

### C) Reload via API
`POST /api/admin/market-data/providers/reload-files` with body:
```json
{ "mode": "upsert" }
```

### D) Optional startup sync (self-host)
- Set env:
  - `MARKET_DATA_PROVIDER_FILE_SYNC=1`
  - Optional: `MARKET_DATA_PROVIDER_FILE_SYNC_MODE=upsert`
  - Optional: `MARKET_DATA_PROVIDER_CONFIG_DIR=/absolute/or/relative/path`

