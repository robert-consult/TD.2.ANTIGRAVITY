---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - shared/ws/protocol.ts
  - server/engine/orderEngine.ts
  - .agents/deep-context.md
last_verified: 2026-03-29
status: maintained
---

# Glossary

| Term | Definition |
| --- | --- |
| Audit trail | Append-oriented record of material state changes with attributable provenance. |
| Bot challenge | Abuse-control proof required on selected mutation paths. |
| Coverage gate | Legal check that resolves whether the current document set applies to a user or signup flow. |
| Grift engine | Fraud and abuse detection subsystem spanning signals, scores, and enforcement. |
| I18nProvider | The custom client-side internationalization provider; this repo does not use `i18next` for the main app. |
| Monolith role | Default `APP_ROLE` shape that enables API, WS, worker, and ingestor responsibilities together. |
| Order engine | System-owned engine that processes pending orders and SL/TP execution from live quotes. |
| Partner gate | Explicit onboarding/data-room/action gates evaluated for partner workflows. |
| Policy gate | Server-side decision point enforced through `requirePolicy`. |
| Quote hub | In-memory quote aggregation and bootstrap service. |
| Same-origin wrapper mode | Capacitor wrapper model that keeps the authenticated app on the canonical app origin for session, CSRF, and `/ws` behavior. |
| Tear-sheet | Cached partner-facing performance summary surface. |
| Trade ledger guardrail | DB-side protection against destructive trade-history mutations. |
| Valkey | Redis-compatible in-memory store used for sessions, caching, and queue support. |
| Worker role | `APP_ROLE` responsibility for schedulers, exports, rollups, and support workers. |
