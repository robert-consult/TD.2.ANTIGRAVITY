# Glossary

> **Diátaxis quadrant:** Reference

---

| Term | Definition |
|---|---|
| **Audit trail** | Append-only record of state-changing actions, attributable with correlation IDs |
| **Bot challenge** | Client-side proof-of-work used to gate abuse-prone endpoints |
| **Capacitor** | Ionic framework for wrapping web apps as native mobile apps (WebView mode) |
| **Correlation ID** | Unique identifier linking related audit trail entries across a request lifecycle |
| **Coverage gate** | Legal terms check ensuring a user has accepted all required documents |
| **CSRF** | Cross-Site Request Forgery — mitigated via double-submit cookie pattern |
| **Deep context map** | Repo navigation guide (`.agents/deep-context.md`) for locating entrypoints by problem type |
| **Definition of Done** | Checklist of criteria a change must satisfy before being considered complete |
| **Drizzle ORM** | TypeScript-first SQL ORM used for schema definitions and migrations |
| **E2EE** | End-to-end encryption — used for partner inquiry payloads and mailbox messages |
| **Excursion tracking** | Recording intraday high/low (MFE/MAE) for trade analytics |
| **Grift engine** | Anti-fraud detection and enforcement system |
| **Headlamp** | Kubernetes dashboard used for cluster visibility |
| **HMAC** | Hash-based Message Authentication Code — used for legal acceptance tokens |
| **Hot path** | Performance-critical code path (quotes, WS fanout, trading, risk) |
| **Idempotency key** | Client-provided key ensuring duplicate requests produce the same result |
| **Jurisdiction control** | Server-enforced geographic restrictions on platform access |
| **MAE** | Maximum Adverse Excursion — worst unrealized loss during a trade |
| **MFE** | Maximum Favorable Excursion — best unrealized profit during a trade |
| **Monolith role** | Default server role running all subsystems (API + worker + ingestor) |
| **PgBouncer** | PostgreSQL connection pooler for production deployments |
| **Policy gate** | Server-side authorization check for trading actions |
| **Quote hub** | In-memory quote aggregation service distributing market data |
| **Remember-me** | Persistent login via secure cookie-based token |
| **Scaffold** | Directory/file structure template established before content is written |
| **Scout** | Trader scouting/recruitment system for identifying talent |
| **SOPS** | Secrets OPerationS — Mozilla tool for encrypting secrets in Git |
| **Tear-sheet** | Partner analytics summary page with cached query results |
| **Trade ledger guardrail** | PostgreSQL trigger preventing accidental deletion/truncation of trade data |
| **Valkey** | Redis-compatible in-memory store (sessions, quote cache, rate limiting) |
| **Worker role** | Server role for background schedulers, exports, and admin views |
