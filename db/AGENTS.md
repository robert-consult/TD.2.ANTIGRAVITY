# `db/` AGENTS.md (Migrations + Seed + Schema Artifacts)

## What this area is
Postgres-only DB layer (Drizzle) used by the server.

## Non-negotiables
- Do not introduce runtime SQLite fallbacks (Postgres is required; see `db/config.ts`).
- Never commit sensitive DB dumps or production data artifacts.
- Keep migrations deterministic and reviewable (no destructive “fixups” without audit context).

## Key entrypoints
- Connection + drizzle: `db/index.ts`, `db/config.ts`
- Migrations: `db/migrations/`
- Seed: `db/seed.ts`
- Schema artifacts: `db/schema.pg.sql` (generated via `scripts/dbDumpSchema.ts`)

## Required checks before finalizing
- `npm run db:migrate:drizzle`
- `npm run db:audit` (CI enforced for DB/schema changes)

