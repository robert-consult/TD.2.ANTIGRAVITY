# Adding Observability

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `.agents/observability.md`, `PROJECT_STRUCTURE.md` §Adding Observability

---

## When to Add Observability

If your change affects trading, auth, WebSocket, or background engines, observability must change with it.

---

## Steps

### 1. Add Prometheus Metrics

Define counters/gauges/histograms in the relevant server module and expose them at `GET /metrics`:

```ts
// Example: server/routes/metricsState.ts
import { Counter, Gauge } from "prom-client";

export const myFeatureCounter = new Counter({
  name: "my_feature_total",
  help: "Total my_feature operations",
});
```

### 2. Create or Update Grafana Dashboard

- Add dashboard JSON to `ops/grafana/provisioning/dashboards/`
- Reference the metrics you just added
- There are currently **65 dashboard JSON files** in the ops directory

### 3. Add Alert Rules (if applicable)

Add Prometheus alert rules to `ops/prometheus/rules/` (24 existing rule files).

### 4. Create an Incident Runbook (if applicable)

Add a runbook to `ops/runbooks/` with the naming convention `RUNBOOK_<EVENT>.md`.

### 5. Update K8s Monitoring (if applicable)

If adding new scrape targets, update `k8s/60-monitoring.yaml`.

---

## Current Metrics

| Metric | Type | Source |
|---|---|---|
| `ws_active_connections` | Gauge | WS server |
| `quotehub_size`, `quotehub_seq`, `quotehub_asof` | Gauge | Quote hub |
| `admin_data_export_jobs_*` | Counter/Gauge | Export pipeline |
| `clickhouse_sync_*` | Counter/Gauge | ClickHouse sync |
| `trade_open_rejected_quote_revalidation_total` | Counter | Trade engine |
| `trade_close_rejected_quote_revalidation_total` | Counter | Trade engine |

---

## Logging Rules

- Keep logs structured and bounded (no full object dumps)
- Preserve correlation IDs from `server/lib/auditWriter.ts`
- **Never log:** tokens, passwords, HMAC secrets, session cookies, PII

---

## Related Pages

- [Observability Stack →](../06_Operations/01_Observability.md)
- [Server Backend →](../02_Architecture_Reference/02_Server_Backend.md)
