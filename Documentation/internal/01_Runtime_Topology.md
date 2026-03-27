---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/index.ts
  - server/routes.ts
  - server/routes/wsCore.ts
  - client/src/App.tsx
  - client/src/AuthenticatedShell.tsx
  - shared/ws/protocol.ts
last_verified: 2026-03-27
status: maintained
---

# Runtime Topology

The current system is a single repo with several runtime surfaces:

- authenticated web app in `client/`
- API and WS runtime in `server/`
- shared contracts in `shared/`
- public website in `WEBSITE/`
- Capacitor wrapper in `MOBILE/`
- React Native app in `NATIVE/`

Server roles:

- `monolith`: enables `api`, `ws`, `worker`, and `ingestor`
- `api`: HTTP routes and API-facing runtime
- `ws`: WebSocket upgrade and fanout
- `worker`: schedulers, exports, sync jobs, and support workers
- `ingestor`: quote-feed and market-ingestion responsibilities

Critical runtime facts:

- health surfaces come from `server/index.ts`: `/status`, `/health`, `/ready`
- metrics are served from `server/routes/wsCore.ts` at `/metrics`
- the live socket endpoint is `/ws`
- session and CSRF handling are mounted before route handlers in `server/routes.ts`
- the authenticated client shell lives in `client/src/AuthenticatedShell.tsx`

Use the generated references for exact inventories:

- [REST API Catalog](../generated/REST_API_Catalog.md)
- [WebSocket Catalog](../generated/WebSocket_Catalog.md)
- [Environment Catalog](../generated/Environment_Catalog.md)
- [Runtime Inventory](../generated/Runtime_Inventory.md)
