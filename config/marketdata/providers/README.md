# Market data provider config files

This folder contains **optional** JSON provider definitions that can be synced into the `market_data_providers` table.

## File format

The loader accepts the same shape as the admin export endpoint:

```json
{
  "providerKey": "twelvedata",
  "displayName": "Twelve Data",
  "driver": "twelvedata",
  "config": { "driver": "twelvedata", "apiKey": "env:TWELVE_DATA_API_KEY" }
}
```

Notes:
- `config.driver` must match `driver`.
- **Secrets must be `env:` references** (no raw API keys).
- Extra fields are ignored by the loader.

## Patching / overrides (merge-patch)

Optional JSON Merge Patch files can override a base provider file:

- `twelvedata.patch.json` (always applied if present)
- `twelvedata.<NODE_ENV>.patch.json` (applied after `.patch.json` when `NODE_ENV` is set)
- `twelvedata.local.patch.json` (applied last; useful for local tweaks)

Patch semantics follow RFC 7396 (object keys merge; `null` removes keys; arrays replace).

## Sync modes

Sync behavior is controlled via env vars and admin endpoints:

- Startup sync (optional): set `MARKET_DATA_PROVIDER_FILE_SYNC=1`
- Upsert mode (optional): set `MARKET_DATA_PROVIDER_FILE_SYNC_MODE=upsert` (default is `create_missing`)

The admin UI also exposes a “Reload from disk” action when the server endpoint is enabled.

