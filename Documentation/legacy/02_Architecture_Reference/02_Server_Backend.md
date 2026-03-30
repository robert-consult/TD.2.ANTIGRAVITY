# Server Backend Architecture

> **Diátaxis quadrant:** Reference
> **Sources:** `server/AGENTS.md`, `.agents/deep-context.md`, `server/index.ts`

---

## Overview

The server is an Express.js application providing REST API, WebSocket server, trading engine, compliance controls, and background job infrastructure. It comprises ~279 items across routes, services, middleware, and specialized subsystems.

---

## Key Entrypoints

| File | Size | Purpose |
|---|---|---|
| `server/index.ts` | ~27KB | Bootstrap, env validation, deferred init |
| `server/routes.ts` | large | Route registration, `/ws`, `/metrics` |
| `server/storage.ts` | ~57KB | Data access layer (PostgreSQL queries) |
| `server/risk.ts` | ~25KB | Risk management engine |
| `server/recalcAccount.ts` | ~14KB | Account recalculation (equity, margin) |

---

## Domain Map

| Domain | Key Files | Concern |
|---|---|---|
| **Auth & Sessions** | `routes/authCore.ts`, `middleware/auth.ts`, `security/sessionTrail.ts` | Login, registration, session lifecycle |
| **Trading** | `engine/orderEngine.ts`, `risk.ts`, `recalcAccount.ts`, `lib/margin.ts` | Trade execution, risk checks, P&L |
| **Quotes** | `feeds/quoteFeed.ts`, `services/quoteHub.ts`, `services/quoteService.ts` | Ingestion, caching, distribution |
| **Policy** | `middleware/requirePolicy.ts`, `policy/buildDecisionContext.ts` | Server-side policy gating |
| **Legal** | `legal/cryptoUtils.ts`, `legal/coverageGate.ts`, `legal/legalAcceptanceService.ts` | HMAC tokens, terms, acceptance |
| **Grift** | `grift/griftEngine.ts`, `grift/griftAutoEnforcement.ts` | Anti-fraud detection |
| **Admin** | `routes/admin.ts` (~70KB), `routes/adminSecurity.ts` | Admin CRUD, system config |
| **Partner** | `routes/partnerPortal.ts` (~62KB) | White-label partner portal |
| **Messaging** | `services/messaging.ts` (~62KB) | E2EE messaging engine |
| **i18n** | `i18n/service.ts`, `i18n/worker.ts` | DB-backed translations |

---

## Middleware Chain

The Express middleware executes in this order:

1. **Security headers** (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
2. **TLS enforcement** (`/api` routes rejected on non-HTTPS in production)
3. **Health endpoints** (`/status`, `/health`, `/ready`)
4. **Body parsing** (JSON, URL-encoded)
5. **HTTP observability** (correlation IDs, trace IDs)
6. **Request logging** (method, path, status, duration)
7. **CSRF enforcement** (double-submit cookie validation)
8. **Session management** (Valkey-backed, configurable cookie security)
9. **Auth middleware** (session validation, remember-me restoration)
10. **Route handlers** (registered via `registerRoutes()`)

---

## Non-Negotiables

> Source: `server/AGENTS.md` and `.agents/security.md`

- Policy gating stays server-side — never bypass `requirePolicy()`
- Jurisdiction enforcement is consistent across signup/login/session
- Legal acceptance integrity is tamper-evident (HMAC)
- Audit trails are append-only and attributable
- Startup secret validation must not be weakened

---

## Related Pages

- [Trading Engine →](07_Trading_Engine.md)
- [Background Jobs →](06_Background_Jobs.md)
- [WebSocket Protocol →](05_WebSocket_Protocol.md)
- [Security Guardrails →](../05_Security_Reference/00_Security_Guardrails.md)
- [Adding an API Endpoint →](../01_Development_Guides/01_Adding_API_Endpoint.md)
