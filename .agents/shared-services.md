# Shared Services Chain (Mandatory Scan Before New Features)

## Purpose
Prevent duplicate implementations across `client/`, `server/`, and `NATIVE/`.

## Rule
Before adding a new utility/protocol/helper in any subproject, check `shared/` first.
If an equivalent exists, reuse it. If not, add it in `shared/` and then consume it downstream.

## Shared-first checklist

1. Time/date logic:
   - `shared/time/instant.ts`
   - `shared/time/format.ts`
   - `shared/time/range.ts`
2. Identity/device header contracts:
   - `shared/identity/headers.ts`
   - `shared/identity/device.ts`
3. HTTP/REST transport contracts:
   - `shared/transport/httpProtocol.ts`
   - `shared/security/csrf.ts`
4. WS protocol contracts:
   - `shared/ws/protocol.ts`
5. Bot challenge contract:
   - `shared/security/botChallenge.ts`
6. E2EE envelope contracts:
   - `shared/e2ee/envelope.ts`
7. Locale/timezone preference contracts:
   - `shared/locale/preferences.ts`
8. Request identity parsing primitives:
   - `shared/security/requestIdentity.ts`

## Required when touching these domains

- If you add/alter message types or transport headers:
  - update shared contract first
  - then update `server/`, `client/`, and `NATIVE/` consumers
- If you add date/time inputs:
  - use shared parse/format helpers (no raw unix-only UX fields)
- If you add security envelope/challenge logic:
  - use shared validators/constants; do not duplicate regexes/ad hoc parsing
