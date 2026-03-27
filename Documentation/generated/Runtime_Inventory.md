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
last_verified: 2026-03-27
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

## Deferred Initialization Symbols

| Symbol | Source File |
| --- | --- |
| `bootstrapDoc1Seed` | `server/legal/bootstrapDoc1Seed.ts` |
| `maybeImportIp2AsnDataset` | `server/grift/griftIp2AsnDataset.ts` |
| `maybeIngestBuiltManifest` | `server/i18n/service.ts` |
| `startAccountLifecycleSweepScheduler` | `server/services/accountLifecycleSweepScheduler.ts` |
| `startAdminDataExportRetentionScheduler` | `server/services/adminDataExportRetention.ts` |
| `startAdminDataExportWorker` | `server/services/adminDataExportQueue.ts` |
| `startAdminDataRollupScheduler` | `server/services/adminDataRollups.ts` |
| `startChallengeEvaluationCron` | `server/cron/evaluateChallenges.ts` |
| `startClickHouseSyncScheduler` | `server/services/clickhouseSync.ts` |
| `startGriftEvaluationScheduler` | `server/grift/griftScheduler.ts` |
| `startI18nWorker` | `server/i18n/worker.ts` |
| `startPartnerAllocationSyncCron` | `server/cron/syncPartnerAllocations.ts` |
| `startScoutMetricsCron` | `server/cron/scoutMetrics.ts` |
| `startTradeAuditVerificationCron` | `server/cron/tradeAuditVerification.ts` |
| `startVerificationReminderCron` | `server/cron/verificationReminders.ts` |

## Runtime Endpoints

| Endpoint | Source | Notes |
| --- | --- | --- |
| `/status` | `server/index.ts` | Plain health probe. |
| `/health` | `server/index.ts` | JSON health probe. |
| `/ready` | `server/index.ts` | DB and Valkey readiness. |
| `/metrics` | `server/routes/wsCore.ts` | Prometheus surface with private-access controls. |
| `/ws` | `server/routes/wsCore.ts` | Session-authenticated WebSocket endpoint. |

Agent guidance files discovered in the repo: **24**.
