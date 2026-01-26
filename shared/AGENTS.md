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

## Required checks before finalizing
- Typecheck: `npm run check`
- If you changed schema: `npm run db:migrate:drizzle` + `npm run db:audit`
- If behavior changes: update `AUDIT_REPORT.md`/runbooks where appropriate

