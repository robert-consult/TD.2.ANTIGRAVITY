---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/grift/griftAdminAudit.ts
  - server/grift/griftAutoEnforcement.ts
  - server/grift/griftDb.ts
  - server/grift/griftDefaults.ts
  - server/grift/griftEngine.test.ts
  - server/grift/griftEngine.ts
  - server/grift/griftGeo.ts
  - server/grift/griftIp2AsnDataset.ts
  - server/grift/griftIpAsn.ts
  - server/grift/griftPublicRouter.ts
  - server/grift/griftRetention.ts
  - server/grift/griftScheduler.ts
  - server/grift/griftTypes.ts
  - server/routes/grift.ts
  - shared/schema.pg.grift.ts
last_verified: 2026-03-30
status: maintained
---

# Grift Engine

## Purpose

The grift subsystem is the repo’s anti-fraud and abuse-detection layer. It links device, IP, ASN, and behavioral signals to user risk state and enforcement.

## Main Components

- signal creation and deduplication in `server/grift/griftEngine.ts`
- score-triggered automatic freeze/disable actions in `server/grift/griftAutoEnforcement.ts`
- runtime evaluation scheduling in `server/grift/griftScheduler.ts`
- admin/public route exposure through `server/routes/grift.ts`
- persistence in `shared/schema.pg.grift.ts`

## File Inventory

- `server/grift/griftAdminAudit.ts`: append-only admin-action audit chain with hash linking and verification helpers for grift governance actions.
- `server/grift/griftAutoEnforcement.ts`: threshold-driven freeze/disable enforcement that reads current score state and writes enforcement plus audit records.
- `server/grift/griftDb.ts`: Postgres adapter that gives grift modules a prepared-statement style interface and transactional client wrapper.
- `server/grift/griftDefaults.ts`: canonical default scoring, threshold, mitigation, and retention configuration values.
- `server/grift/griftEngine.test.ts`: focused coverage for config caching and linked-account edge recording behavior.
- `server/grift/griftEngine.ts`: core rule evaluation, signal deduplication, aggregate recomputation, config caching, and live-event invalidation behavior.
- `server/grift/griftGeo.ts`: request-context extraction for IP, device, geo, timezone, language, ASN, and proxy-aware identity inputs.
- `server/grift/griftIp2AsnDataset.ts`: local IP-to-ASN dataset import and lookup support for enrichment without relying only on proxy headers.
- `server/grift/griftIpAsn.ts`: cache, lookup, retry, and enrichment orchestration for IP-to-ASN and organization resolution.
- `server/grift/griftPublicRouter.ts`: authenticated `/ping` router that records session activity and opportunistically applies auto-enforcement.
- `server/grift/griftRetention.ts`: retention-prune logic for raw grift telemetry tables so observation growth stays bounded.
- `server/grift/griftScheduler.ts`: hourly scheduler that runs re-evaluation, retention pruning, and opportunistic IP-to-ASN enrichment.
- `server/grift/griftTypes.ts`: canonical rule, severity, config, audit-context, and enforcement type definitions shared across the subsystem.

## Operational Intent

- grift is not only reporting; it can drive enforcement outcomes
- runtime config and cache invalidation are part of the system
- audit context, IP/ASN enrichment, and live-event hooks are intentional inputs to the scoring model

## Documentation Rule

Internal docs can describe the architecture and enforcement boundaries, but detailed heuristics and sensitive operational thresholds should remain internal-only and close to canonical sources.
