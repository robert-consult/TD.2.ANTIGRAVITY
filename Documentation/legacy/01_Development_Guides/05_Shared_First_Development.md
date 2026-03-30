# Shared-First Development

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `.agents/shared-services.md`

---

## Rule

Before adding a new utility, protocol, or helper in any subproject (`client/`, `server/`, `NATIVE/`), check `shared/` first:

- If an equivalent exists → **reuse it**
- If not → **add it in `shared/`** and consume downstream

---

## Shared-First Checklist

| Domain | Check these files first |
|---|---|
| **Time/date logic** | `shared/time/instant.ts`, `shared/time/format.ts`, `shared/time/range.ts` |
| **Identity/device headers** | `shared/identity/headers.ts`, `shared/identity/device.ts` |
| **HTTP/REST transport** | `shared/transport/httpProtocol.ts`, `shared/security/csrf.ts` |
| **WebSocket protocol** | `shared/ws/protocol.ts` |
| **Bot challenge** | `shared/security/botChallenge.ts` |
| **E2EE envelopes** | `shared/e2ee/envelope.ts` |
| **Locale/timezone** | `shared/locale/preferences.ts` |
| **Request identity parsing** | `shared/security/requestIdentity.ts` |

---

## Required When Touching These Domains

- **Message types or transport headers:** update shared contract first, then update `server/`, `client/`, and `NATIVE/` consumers
- **Date/time inputs:** use shared parse/format helpers (no raw unix-only UX fields)
- **Security envelope/challenge logic:** use shared validators/constants (no duplicate regexes/ad hoc parsing)

---

## Related Pages

- [Shared Contracts →](../02_Architecture_Reference/04_Shared_Contracts.md)
