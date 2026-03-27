# Background Jobs & Schedulers

> **Diátaxis quadrant:** Reference
> **Sources:** `server/index.ts` deferred init, `server/cron/`, `server/services/` schedulers

---

## Overview

Background jobs are registered during the deferred initialization phase of `server/index.ts`. Each job is guarded by the server's `APP_ROLE`, ensuring only the appropriate process instances run specific schedulers.

---

## Job Inventory

| Job | File | Role Guard | Frequency |
|---|---|---|---|
| **Quote ingestion** | `server/feeds/quoteFeed.ts` | `ingestor` | Continuous (provider feed) |
| **Auto-close** | `server/cron/autoClose.ts` | `ingestor` | Configurable cron |
| **Margin call liquidation** | `server/cron/marginCall.ts` | `ingestor` | Configurable cron |
| **Excursion tracking** | `server/trades/excursionTracking.ts` | `ingestor` | Pub/sub from quote feed |
| **Grift evaluation** | `server/grift/griftScheduler.ts` | `worker` | Configurable interval |
| **Challenge evaluation** | `server/cron/evaluateChallenges.ts` | `worker` | Dynamic (admin-configured) |
| **ClickHouse sync** | `server/services/clickhouseSync.ts` | `worker` | Configurable interval |
| **Data export pipeline** | `server/services/adminDataExportQueue.ts` | `worker` | Queue-based (Bull) |
| **Export retention** | `server/services/adminDataExportRetention.ts` | `worker` | Configurable sweep |
| **Account lifecycle** | `server/services/accountLifecycleSweepScheduler.ts` | `worker` | Daily sweep |
| **Verification reminders** | `server/cron/verificationReminders.ts` | `worker` | Configurable cron |
| **i18n worker** | `server/i18n/worker.ts` | `worker` | Manifest ingest |
| **Scout metrics** | `server/services/scoutMetrics.ts` | `worker` | Configurable interval |
| **Partner allocation sync** | `server/services/partnerAllocationSync.ts` | `worker` | Configurable interval |

---

## Dynamic Runtime Control

Several schedulers support **admin-driven dynamic configuration** without process restart:

- **Challenge evaluation:** `challengeEvalEnabled`, `challengeEvalIntervalMin`, `challengeEvalMaxRows`
- **WS fanout pacing:** `wsPushFrequencyMs`

Changes are applied through the admin System Config UI and propagate via `global-settings:updated` WebSocket broadcast.

---

## Observability Metrics

| Metric | Type | Source |
|---|---|---|
| `admin_data_export_jobs_*` | Counters/Gauge | Data export pipeline |
| `admin_data_export_queue_*` | Gauges | Export queue state |
| `clickhouse_sync_*` | Counters/Gauge | ClickHouse sync |

---

## Related Pages

- [Server Backend →](02_Server_Backend.md)
- [Observability Stack →](../06_Operations/01_Observability.md)
- [Trading Engine →](07_Trading_Engine.md)
