# `shared/` AGENTS.md (Schemas + Policy)

## What this area is
Shared code used by server and clients:
- DB schema types (Drizzle + Zod)
- Policy decisions and feature gates
- Shared constants/enums

## Non-negotiables
- Changes here are cross-cutting: update server + web/mobile callers and tests.
- Treat schema and policy changes as contract changes: document and verify downstream impacts.

## Key files
- DB schema (source of truth): `shared/schema.pg.ts`
- Policy decisions + feature gates: `shared/policyDecision.ts`
- Close reason enums: `shared/closeReasons.ts`

## WebSocket Protocol (centralized reference)
WebSocket messages follow this structure. See `server/routes.ts` for implementation.

| Message Type | Direction | Purpose |
|--------------|-----------|---------|
| `quotes:subscribe` | Client → Server | Subscribe to symbol quotes |
| `quotes:update` | Server → Client | Quote price update |
| `trades:update` | Server → Client | Trade status change |
| `auth:session` | Server → Client | Session/auth state |
| `ping` / `pong` | Bidirectional | Keepalive |

**Protocol Version**: Check `WS_PROTOCOL_VERSION` in `server/routes.ts`.

When changing WS message shapes:
1. Update server handlers in `server/routes.ts`
2. Update client hooks in `client/src/live/`
3. Update native hooks in `NATIVE/src/services/websocket.ts`
4. Consider backward compatibility for active connections

## Required checks before finalizing
- Typecheck: `npm run check`
- If you changed schema: `npm run db:migrate:drizzle` + `npm run db:audit`
- If behavior changes: update `AUDIT_REPORT.md`/runbooks where appropriate

