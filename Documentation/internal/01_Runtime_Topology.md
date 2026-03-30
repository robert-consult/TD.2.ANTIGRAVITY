---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/index.ts
  - server/routes.ts
  - server/routes/wsCore.ts
  - server/security/csrf.ts
  - server/context/buildMiddleware.ts
  - client/src/App.tsx
  - client/src/AuthenticatedShell.tsx
  - client/src/live/
  - shared/ws/protocol.ts
last_verified: 2026-03-29
status: maintained
---

# Runtime Topology

The repo is a multi-surface system with one primary authenticated runtime and several adjacent product/operator modules.

## Product Surfaces

- authenticated web app in `client/`
- API and WS runtime in `server/`
- shared contracts in `shared/`
- public website in `WEBSITE/`
- Capacitor wrapper in `MOBILE/`
- React Native app in `NATIVE/`

## HTTP And Middleware Shape

`server/index.ts` owns process startup, health probes, transport headers, TLS enforcement for `/api`, JSON parsing, HTTP observability, and the handoff into `registerRoutes(app)`.

Inside `server/routes.ts`, the global request order matters:

1. session store wiring
2. CSRF bootstrap and enforcement for `/api`
3. impersonation guard
4. jurisdiction session guard
5. domain-specific route mounts

That order is part of the runtime contract. Docs and implementation guides should treat it as fixed unless a change is deliberately re-verified.

## Server Roles

- `monolith`: enables `api`, `ws`, `worker`, and `ingestor`
- `api`: HTTP routes and API-facing runtime
- `ws`: WebSocket upgrade and fanout
- `worker`: schedulers, exports, sync jobs, and support workers
- `ingestor`: quote-feed and market-ingestion responsibilities

`APP_ROLE` decides which responsibilities are active. `E2E_DISABLE_BACKGROUND_JOBS=1` suppresses schedulers and workers for test-oriented runs.

## Client Shell Boundaries

- `client/src/App.tsx` owns unauthenticated routes, auth bootstrap, CSRF/bootstrap installation, query persistence attachment, and the custom `I18nProvider`
- `client/src/AuthenticatedShell.tsx` owns authenticated route switching plus the live/runtime wrappers:
  - `LiveUpdatesProvider`
  - `QuotesProvider`
  - `ConfigSync`
  - `AccountSummarySync`
  - `VerificationReminderPopup`
  - `LegalReacceptGate`
- route chunks are loaded through `lazyWithPing`, and dashboard state/query conventions come from `client/src/lib/dashboardUrlState.ts`

## Live Transport

Critical runtime facts:

- health surfaces come from `server/index.ts`: `/status`, `/health`, `/ready`
- metrics are served from `server/routes/wsCore.ts` at `/metrics`
- the live socket endpoint is `/ws`
- the canonical WS protocol constants live in `shared/ws/protocol.ts`
- the client subscribes through the live providers under `client/src/live/`
- quote, trade, account, notification, and legal update events are part of the current runtime surface and must be documented from source-derived catalogs rather than hand-written message lists

## Background And Deferred Startup

Deferred startup includes quote-hub bootstrap, quote ingestion, i18n worker startup, grift evaluation, audit verification, exports, rollups, ClickHouse sync, partner allocation sync, challenge evaluation, and account lifecycle work. The exact inventory changes over time and is therefore captured in generated form.

Use maintained docs for intent, and generated docs for exact inventory:

- startup role/task inventory: [Runtime Inventory](../generated/Runtime_Inventory.md)
- route inventory: [REST API Catalog](../generated/REST_API_Catalog.md)
- socket message inventory: [WebSocket Catalog](../generated/WebSocket_Catalog.md)
- environment and runtime toggles: [Environment Catalog](../generated/Environment_Catalog.md)

This page replaces the old legacy server-backend, WS-protocol, and background-job summaries by documenting the stable topology and delegating volatile lists to generation.
