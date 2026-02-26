# RUNBOOK: Analytics Staleness

**Trigger Alert:** `RollupRefreshStale` / `ClickHouseSyncStale`

## Symptoms
- Admin dashboard showing stale data (freshness gauge > 1h)
- Rollup or ClickHouse sync metrics indicate no recent success

## Diagnosis

```bash
# 1. Check rollup refresh metrics
curl -s http://tradehub-api.tradehub.svc:5000/metrics | grep rollup

# 2. Check ClickHouse sync state
curl -s http://tradehub-api.tradehub.svc:5000/metrics | grep clickhouse_sync

# 3. Check ClickHouse connectivity
kubectl exec -n tradehub sts/tradehub-clickhouse -- \
  clickhouse-client --query "SELECT count() FROM trades_sync"

# 4. Check worker logs for sync errors
kubectl logs -n tradehub -l role=worker --tail=50 | grep -i "sync\|rollup"
```

## Resolution

```bash
# Manual rollup rebuild (safe — idempotent)
kubectl exec -n tradehub deploy/tradehub-api -- \
  node -e "const r=require('./dist/server/services/adminDataRollups');r.rebuildAll()"

# Advance ClickHouse high-watermark if stuck
kubectl exec -n tradehub deploy/tradehub-worker -- \
  node -e "const s=require('./dist/server/services/clickhouseSync');s.resetWatermark()"
```

## Prevention
- Monitor `admin_data_rollup_refresh_last_success_at` freshness
- Ensure weekend full-rebuild cron is registered in `server/index.ts`
