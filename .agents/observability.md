# Observability Checklist (TradeQuip)

## Scope rule
If behavior changes (especially trading, auth, WS, background engines), observability must change with it.

## Logs (server)
- Keep logs structured and bounded (avoid dumping full objects; avoid PII/secrets).
- Preserve/propagate correlation IDs when available (`server/lib/auditWriter.ts`).
- Do not log raw tokens, passwords, HMAC secrets, Twilio/Resend keys, or session cookies.

## Metrics
The API exposes Prometheus-format metrics at:
- `GET /metrics` (implemented in `server/routes.ts`)

Current metrics include:
- `ws_active_connections`
- `quotehub_size`, `quotehub_seq`, `quotehub_asof`
- `admin_data_export_jobs_*` (created/start/success/fail/cancel counters, running gauge)
- `admin_data_export_queue_*` (waiting/active/delayed/failed/completed gauges)
- `admin_data_export_last_*` (last duration/success/failure timestamps)
- `admin_data_export_retention_*` (retention sweeps + expired artifacts)
- `clickhouse_sync_*` (scheduler liveness, last run/success/failure, rows synced)

Kubernetes scraping is configured in:
- `k8s/60-monitoring.yaml`

When you add a new hot path or high-risk control (rate limit, queue size, WS fanout change), add or extend metrics
so operations can detect regressions quickly.

## Traces (if you introduce them)
- Prefer low-cardinality labels; never include PII in attributes.
- Keep spans around network calls, DB calls, and background jobs.
