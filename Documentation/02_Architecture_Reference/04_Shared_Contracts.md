# Shared Contracts

> **Diátaxis quadrant:** Reference
> **Sources:** `shared/AGENTS.md`, `.agents/shared-services.md`, `shared/` directory

---

## Purpose

The `shared/` directory contains TypeScript types, Zod schemas, and Drizzle ORM definitions consumed by both `client/` and `server/` (and conceptually by `NATIVE/`). It is the single source of truth for cross-layer contracts.

---

## Contract Families

| Family | Files | Purpose |
|---|---|---|
| **DB Schema** | `schema.pg.*.ts` (6 domain files) | PostgreSQL table definitions |
| **Policy** | `policyDecision.ts` (~14KB) | Policy gate types and decision contracts |
| **Partners** | `partnerProfile.ts` (~14KB) | Partner profile schemas |
| **Trade Rules** | `tradingRules.ts`, `closeReasons.ts` (~13KB) | Trading rules and close reasons |
| **Instruments** | `instruments/` (4 items) | Instrument definitions and configs |
| **Market Data** | `marketDataProviders.ts` | Provider configurations |
| **Quotes** | `quoteSubscriptions.ts` | Quote subscription types |
| **Scalars** | `scalars.ts`, `pips.ts` | Scalar wrappers and pip calculation |
| **Time** | `time/instant.ts`, `time/format.ts`, `time/range.ts` | Time/date logic |
| **Identity** | `identity/headers.ts`, `identity/device.ts` | Device/identity header contracts |
| **Security** | `security/csrf.ts`, `security/botChallenge.ts`, `security/requestIdentity.ts` | CSRF, bot challenge, identity parsing |
| **Transport** | `transport/httpProtocol.ts` | HTTP protocol contracts |
| **WebSocket** | `ws/protocol.ts` | WS message types |
| **E2EE** | `e2ee/envelope.ts` | End-to-end encryption envelopes |
| **Locale** | `locale/preferences.ts` | Locale/timezone preferences |
| **Challenges** | `challenges/` | Challenge system types |
| **Admin** | `admin/` (3 items) | Admin shared types |

---

## Shared-First Rule

> Before adding a new utility/protocol/helper in any subproject, check `shared/` first. If an equivalent exists, reuse it. If not, add it in `shared/` and then consume it downstream.

See [Shared-First Development →](../01_Development_Guides/05_Shared_First_Development.md) for the complete checklist.

---

## Related Pages

- [Database Layer →](03_Database_Layer.md)
- [Server Backend →](02_Server_Backend.md)
- [Adding an API Endpoint →](../01_Development_Guides/01_Adding_API_Endpoint.md)
