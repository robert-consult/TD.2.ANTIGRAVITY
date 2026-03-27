# Project Deep Map

> **Diátaxis quadrant:** Reference
> **Sources:** `PROJECT_STRUCTURE.md`

---

> This page is a formatted adaptation of the canonical [`PROJECT_STRUCTURE.md`](../../PROJECT_STRUCTURE.md) located at the repository root. For the raw detailed file, always consult the root version as the source of truth.

## Quick Reference

| Component | Path | Technology |
|---|---|---|
| Public Website | `WEBSITE/` | React 18 + Vite + Express |
| Web Frontend | `client/` | React 18 + Vite |
| Backend API | `server/` | Express + Node |
| Shared Contracts | `shared/` | TypeScript + Zod + Drizzle |
| Database Layer | `db/` | Drizzle ORM + PostgreSQL |
| Capacitor Wrapper | `MOBILE/` | Capacitor 8 (remote WebView) |
| Native Apps | `NATIVE/` | React Native 0.83 |
| Observability | `ops/` | Grafana + Prometheus + K8s |
| Petascale Analytics | `petascale/` | ClickHouse + Prometheus |
| Kubernetes | `k8s/` | YAML manifests |
| E2E Tests | `e2e/` | Playwright |
| Scripts & Tooling | `scripts/` | TypeScript + Shell |
| Design Assets | `design/` | SVG, certificates, themes |
| Config | `config/` | Market data provider configs |

---

## Dependency Management

The repository has **three independent `node_modules/`** trees:

| Scope | Location | Installation |
|---|---|---|
| Root (web + API + tests) | `node_modules/` | `npm ci` from root |
| Capacitor wrapper | `MOBILE/node_modules/` | `cd MOBILE && npm install` |
| React Native | `NATIVE/node_modules/` | `cd NATIVE && npm install` |

> Never cross-import between these trees. See [Shared-First Development](../01_Development_Guides/05_Shared_First_Development.md) for the shared contract strategy.

---

## Key Subsystem Breakdown

### Server (`server/` — 279 items)

| Subsystem | Path | Items |
|---|---|---|
| Routes (API endpoints) | `server/routes/` | 106 |
| Services (business logic) | `server/services/` | 38 |
| Grift (anti-fraud) | `server/grift/` | 13 |
| Security | `server/security/` | 13 |
| Legal compliance | `server/legal/` | 13 |
| Recruitment portal | `server/recruitment/` | 14 |
| Market data | `server/marketdata/` | 9 |
| Cron jobs | `server/cron/` | 7 |
| Middleware | `server/middleware/` | 7 |
| Feeds (quote ingestion) | `server/feeds/` | 6 |
| i18n | `server/i18n/` | 7 |
| Utilities | `server/lib/` + `server/utils/` | 24 |

### Client (`client/src/` — 109+ components)

| Area | Path | Items |
|---|---|---|
| UI primitives (shadcn) | `components/ui/` | 48 |
| Admin dashboard | `components/admin/` | 28 |
| Route pages | `pages/` | 24 |
| React hooks | `hooks/` | 15 |
| Lib/utilities | `lib/` | 37 |
| Live/WS providers | `live/` | 6 |

---

## Full Directory Tree

For the complete annotated directory tree with every file and subdirectory, see the canonical [`PROJECT_STRUCTURE.md`](../../PROJECT_STRUCTURE.md).

---

## Related Pages

- [System Overview →](00_System_Overview.md)
- [Server Backend →](../02_Architecture_Reference/02_Server_Backend.md)
- [Client Frontend →](../02_Architecture_Reference/01_Client_Frontend.md)
- [Agent Guidance Index →](../07_Appendices/03_Agent_Guidance_Index.md)
