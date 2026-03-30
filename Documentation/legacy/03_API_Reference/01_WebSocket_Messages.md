# WebSocket Messages

> **Diátaxis quadrant:** Reference
> **Sources:** `shared/ws/protocol.ts`, `server/routes/wsCore.ts`, `client/src/live/`

---

## Connection

```
ws://localhost:5000/ws   (development)
wss://tradehub.example.com/ws   (production)
```

Requires valid session cookie (same as REST).

---

## Server → Client Messages

| Type | Payload | Purpose |
|---|---|---|
| `quotes:update` | `{ [symbol]: QuoteData }` | Quote snapshot/delta |
| `trades:update` | `Trade[]` | Trade state changes |
| `account:update` | `AccountState` | Equity/margin recalculation |
| `global-settings:updated` | `GlobalSettings` | Live config changes |
| `notifications:update` | `Notification[]` | Real-time notifications |

## Client → Server Messages

| Type | Payload | Purpose |
|---|---|---|
| `subscribe` | `{ symbols: string[] }` | Subscribe to quotes |
| `unsubscribe` | `{ symbols: string[] }` | Unsubscribe from quotes |

---

## Discovery Command

```bash
rg -n "quotes:|trades:|auth:" server/routes.ts client/src/live
```

---

## Related Pages

- [WebSocket Protocol →](../02_Architecture_Reference/05_WebSocket_Protocol.md)
- [REST Endpoints →](00_REST_Endpoints.md)
