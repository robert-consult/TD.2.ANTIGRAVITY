# Observability Stack

> **Diátaxis quadrant:** Reference
> **Sources:** `.agents/observability.md`, `ops/` directory

---

## Components

| Tool | Access Path | Auth |
|---|---|---|
| Grafana | `/grafana` | Admin, Superadmin |
| Prometheus | `/prometheus` | Superadmin only |
| Headlamp | `/headlamp` | Superadmin only |
| MinIO Monitor | `/minio-monitor` | Superadmin only |
| Bull Board | `/api/admin/data-exports/queues` | Superadmin only |

---

## Prometheus Metrics

The API exposes metrics at `GET /metrics`. Current metrics include `ws_active_connections`, `quotehub_*`, `admin_data_export_*`, `clickhouse_sync_*`, and trade rejection counters.

---

## Grafana Dashboards

65 dashboard JSON files in `ops/grafana/provisioning/dashboards/`.

## Prometheus Alert Rules

24 alert rule files in `ops/prometheus/rules/`.

---

## Related Pages

- [Adding Observability →](../01_Development_Guides/04_Adding_Observability.md)
- [Kubernetes →](00_Kubernetes.md)
