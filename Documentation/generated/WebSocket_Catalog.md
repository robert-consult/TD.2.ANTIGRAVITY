---
audience: generated
exposure: internal
owner: documentation-program
canonical_sources:
  - shared/ws/protocol.ts
  - server/routes/wsCore.ts
  - client/src/live/
last_verified: 2026-03-30
status: generated
generated_from:
  - scripts/docs/generators/ws/index.ts
---

# WebSocket Catalog

> Generated from the canonical protocol module and the current WS runtime integration points.

Protocol version: **1**

## Canonical Message Types

| Type | Direction | Constant | Source |
| --- | --- | --- | --- |
| `account:snapshot` | server -> client | `WS_MSG_ACCOUNT_SNAPSHOT` | `shared/ws/protocol.ts` |
| `account:subscribe` | client -> server | `WS_MSG_ACCOUNT_SUBSCRIBE` | `shared/ws/protocol.ts` |
| `account:unsubscribe` | client -> server | `WS_MSG_ACCOUNT_UNSUBSCRIBE` | `shared/ws/protocol.ts` |
| `account:update` | server -> client | `WS_MSG_ACCOUNT_UPDATE` | `shared/ws/protocol.ts` |
| `account:updated` | server -> client | `WS_MSG_ACCOUNT_UPDATED` | `shared/ws/protocol.ts` |
| `auth:hello` | client -> server | `WS_MSG_AUTH_HELLO` | `shared/ws/protocol.ts` |
| `auth:ok` | server -> client | `WS_MSG_AUTH_OK` | `shared/ws/protocol.ts` |
| `legal:doc1-updated` | server -> client | `WS_MSG_LEGAL_DOC1_UPDATED` | `shared/ws/protocol.ts` |
| `ping` | client -> server | `WS_MSG_PING` | `shared/ws/protocol.ts` |
| `pong` | server -> client | `WS_MSG_PONG` | `shared/ws/protocol.ts` |
| `quote-subscriptions:updated` | server -> client | `WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED` | `shared/ws/protocol.ts` |
| `quotes:snapshot` | server -> client | `WS_MSG_QUOTES_SNAPSHOT` | `shared/ws/protocol.ts` |
| `quotes:subscribe` | client -> server | `WS_MSG_QUOTES_SUBSCRIBE` | `shared/ws/protocol.ts` |
| `quotes:unsubscribe` | client -> server | `WS_MSG_QUOTES_UNSUBSCRIBE` | `shared/ws/protocol.ts` |
| `quotes:update` | server -> client | `WS_MSG_QUOTES_UPDATE` | `shared/ws/protocol.ts` |
| `trades:subscribe` | client -> server | `WS_MSG_TRADES_SUBSCRIBE` | `shared/ws/protocol.ts` |
| `trades:unsubscribe` | client -> server | `WS_MSG_TRADES_UNSUBSCRIBE` | `shared/ws/protocol.ts` |
| `trades:update` | server -> client | `WS_MSG_TRADES_UPDATE` | `shared/ws/protocol.ts` |
| `trades:updated` | server -> client | `WS_MSG_TRADES_UPDATED` | `shared/ws/protocol.ts` |
| `ws:error` | server -> client | `WS_MSG_ERROR` | `shared/ws/protocol.ts` |

## Runtime Integration Points

| Area | File | Notes |
| --- | --- | --- |
| Server runtime | `server/routes/wsCore.ts` | Upgrade handling, auth handshake, fanout, metrics, rate limits |
| Shared protocol | `shared/ws/protocol.ts` | Endpoint path, protocol version, message constants |
| Client live updates | `client/src/live/LiveUpdatesProvider.tsx` | Socket bootstrap and auth hello |
| Quote sync | `client/src/live/QuotesProvider.tsx` | Quote subscribe, unsubscribe, snapshot, update handling |
| Config sync | `client/src/live/ConfigSync.tsx` | Global settings, legal doc, and quote-subscription invalidation |
