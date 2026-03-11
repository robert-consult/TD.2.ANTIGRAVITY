# Market Data Provider Modularity And Twelve Data Cutover

Last updated: 2026-03-09

## Objective

Make Twelve Data the live production provider without hardcoding the application to one provider implementation, and preserve admin-driven switching and fallback behavior.

## Repo Findings

Core provider system already existed in:

- `shared/marketDataProviders.ts`
- `server/marketdata/providerRegistry.ts`
- `server/marketdata/providerManager.ts`
- `server/routes/adminMarketData.ts`
- `config/marketdata/providers/twelvedata.json`
- `config/marketdata/providers/1forge.json`

## Changes Implemented

- production candidate selection now defaults to `twelvedata`
- env fallback is disabled by default in production
- singleton config creation defaults active provider to `twelvedata`
- live diagnostics route now reports active provider instead of 1Forge-only state
- `/api/market/quotes` now fetches through the provider manager
- `/api/market/symbols` can use the active provider reference endpoint when requested
- tests added for provider candidate ordering and fallback rules

## Production Cutover Steps

1. Supply `TWELVE_DATA_API_KEY`.
2. Replace the placeholder in the overlay secret manifest.
3. Ensure `config/marketdata/providers/twelvedata.json` remains synced or use the admin import flow.
4. In admin:
   - open System Config / Market Data
   - confirm Twelve Data provider config is present
   - run provider test
   - activate Twelve Data
5. Confirm `marketDataActiveProviderKey=twelvedata`.
6. Confirm diagnostics show:
   - `status=configured`
   - active provider key is `twelvedata`
   - no missing env refs for the active provider
7. Keep `1forge` only as optional fallback until confidence is high.

## Fallback Rules

Current production intent:

- active provider comes from `system_config`
- fallback providers come from `marketDataFallbackProviderKeysCsv`
- legacy env fallback is off in production

This means production switching must happen through:

- system config
- admin activation
- provider rows/config files

not through hidden env inference.

## Admin Workflow To Use

### Provider creation/import

- use the existing admin market-data UI or provider file sync
- keep secrets as `env:` refs only

### Secret ref verification

- `apiKey` values must be `env:TWELVE_DATA_API_KEY`
- no raw third-party keys go into DB config JSON

### Test and activate

- use provider test action in the admin UI
- activate only after test succeeds

### Fallback order

- set fallback keys explicitly
- keep order deterministic

### Quote validation

- watch diagnostics
- confirm quote freshness and symbol coverage
- observe live feed behavior in staging first

## Known Residual Gaps

- legacy 1Forge historical helper files remain in `server/utils/`; they are not part of the live provider path but should be reviewed if any feature depends on them
- Twelve Data production rate-limit sizing must still be checked against expected quote volume

## Inputs Needed From You

- Twelve Data API key
- expected symbol universe and rate-limit tier
- confirmation whether `1forge` should remain as an emergency fallback during the first launch window
