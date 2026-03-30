---
audience: generated
exposure: internal
owner: documentation-program
canonical_sources:
  - server/index.ts
  - server/routes.ts
  - server/routes/wsCore.ts
  - server/cron/
  - server/services/
  - server/feeds/
last_verified: 2026-03-30
status: generated
generated_from:
  - scripts/docs/generators/runtime/index.ts
---

# Runtime Inventory

> Generated from the live startup/runtime entrypoints.

## Process Roles

| Role | Meaning |
| --- | --- |
| `monolith` | Enables API, WS, ingestor, and worker responsibilities together. |
| `api` | Runs HTTP routes and API-facing responsibilities. |
| `ws` | Runs WebSocket upgrade and fanout responsibilities. |
| `ingestor` | Runs quote-feed and market-ingestion responsibilities. |
| `worker` | Runs schedulers, exports, sync jobs, and support workers. |

## Startup And Job Inventory

| Symbol | Category | Source File | Active Roles | Startup Gate | Responsibility |
| --- | --- | --- | --- | --- | --- |
| `startAccountLifecycleSweepScheduler` | account-lifecycle | `server/services/accountLifecycleSweepScheduler.ts` | `worker` | worker only and skipped when background jobs are disabled | Sweep inactive and deletion-grace accounts. |
| `startAdminDataExportRetentionScheduler` | admin-export | `server/services/adminDataExportRetention.ts` | `worker` | worker only and skipped when background jobs are disabled | Expire and clean old export artifacts. |
| `startAdminDataExportWorker` | admin-export | `server/services/adminDataExportQueue.ts` | `worker` | worker only and skipped when background jobs are disabled | Run BullMQ-backed admin export jobs. |
| `startAdminDataRollupScheduler` | admin-rollups | `server/services/adminDataRollups.ts` | `worker` | worker only and skipped when background jobs are disabled | Maintain admin rollup read-model data. |
| `startClickHouseSyncScheduler` | analytics-sync | `server/services/clickhouseSync.ts` | `worker` | worker only and skipped when background jobs are disabled | Schedule Postgres-to-ClickHouse synchronization. |
| `startTradeAuditVerificationCron` | audit | `server/cron/tradeAuditVerification.ts` | `worker` | worker only and skipped when background jobs are disabled | Verify trade audit chain integrity. |
| `startGriftEvaluationScheduler` | grift | `server/grift/griftScheduler.ts` | `worker` | worker only and skipped when background jobs are disabled | Run grift evaluation scheduling. |
| `maybeImportIp2AsnDataset` | grift-bootstrap | `server/grift/griftIp2AsnDataset.ts` | `worker` | worker only when an ip2asn dataset path is configured | Import IP-to-ASN data for grift enrichment. |
| `maybeIngestBuiltManifest` | i18n | `server/i18n/service.ts` | `worker` | worker only and skipped when background jobs are disabled | Load built i18n manifest data if present. |
| `startI18nWorker` | i18n | `server/i18n/worker.ts` | `worker` | worker only and skipped when background jobs are disabled | Run DB-backed i18n worker processing. |
| `bootstrapDoc1Seed` | legal-bootstrap | `server/legal/bootstrapDoc1Seed.ts` | `worker` | worker only and skipped when background jobs are disabled | Seed baseline DOC1 legal material. |
| `startQuoteFeed` | market-data | `server/feeds/quoteFeed.ts` | `ingestor` | ingestor only | Start quote-feed ingestion. |
| `syncProviderConfigsFromDirToDb` | market-data-config | `server/marketdata/providerConfigFiles.ts` | `api,ingestor` | only when `MARKET_DATA_PROVIDER_FILE_SYNC=1` | Sync market-data provider config files into DB state. |
| `checkConfiguredProviderSecrets` | market-data-preflight | `server/marketdata/providerManager.ts` | `all` | post-listen runtime preflight | Warn when configured market-data providers are missing required env secrets. |
| `startPartnerAllocationSyncCron` | partner | `server/cron/syncPartnerAllocations.ts` | `worker` | worker only and skipped when background jobs are disabled | Sync partner allocation state. |
| `bootstrapQuoteHub` | quote-bootstrap | `server/services/quoteHub.ts` | `api,ws` | after listen when `api` or `ws` role is active | Warm quote hub from Valkey snapshot data. |
| `bootstrapQuoteHubFromValkeySymbols` | quote-bootstrap | `server/services/quoteHub.ts` | `api,ws` | fallback after quote-hub snapshot bootstrap misses | Backfill quote hub from per-symbol Valkey keys. |
| `startChallengeEvaluationCron` | recruitment | `server/cron/evaluateChallenges.ts` | `worker` | worker only and skipped when background jobs are disabled | Evaluate challenge progression and outcomes. |
| `startMarginCallScheduler` | risk-automation | `server/cron/marginCall.ts` | `ingestor` | ingestor only and skipped when background jobs are disabled | Run margin-call scheduling. |
| `startScoutMetricsCron` | scouting | `server/cron/scoutMetrics.ts` | `worker` | worker only and skipped when background jobs are disabled | Calculate scout metrics snapshots. |
| `initExcursionTrackingPubSub` | trade-analytics | `server/trades/excursionTracking.ts` | `ingestor` | after quote feed starts | Initialize excursion-tracking pub/sub support. |
| `startAutoCloseScheduler` | trade-automation | `server/cron/autoClose.ts` | `ingestor` | ingestor only and skipped when background jobs are disabled | Run automated close scheduling. |
| `startVerificationReminderCron` | verification | `server/cron/verificationReminders.ts` | `worker` | worker only and skipped when background jobs are disabled | Schedule verification reminder sends. |

## Runtime Endpoints

| Endpoint | Source | Notes |
| --- | --- | --- |
| `/status` | `server/index.ts` | Plain health probe. |
| `/health` | `server/index.ts` | JSON health probe. |
| `/ready` | `server/index.ts` | DB and Valkey readiness. |
| `/metrics` | `server/routes/wsCore.ts` | Prometheus surface with private-access controls. |
| `/ws` | `server/routes/wsCore.ts` | Session-authenticated WebSocket endpoint. |

Agent guidance files discovered in the repo: **24**.
