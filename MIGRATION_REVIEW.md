# Postgres Migration Review (Uncommitted Changes)

This file is a **ground-truth reference** for the current uncommitted diff in this repo, why the changes were made, and which regressions they introduced.

## 1) What changed (high level)

### A) Database: forced Postgres-only
- Postgres is now treated as the only supported runtime DB.
- Drizzle config + schema dump tooling were adjusted to Postgres (`pg_dump`) and the `db/schema.pg.sql` artifact.

**Files**
- `db/config.ts`: now requires `DATABASE_URL` and assumes Postgres.
- `drizzle.config.ts`: Postgres-only drizzle-kit config (uses `shared/schema.pg.ts`).
- `scripts/dbDumpSchema.ts`: writes `db/schema.pg.sql` using `pg_dump`.
- `scripts/dbAudit.ts`: Postgres-only audit using `information_schema`.
- `scripts/db-backup.sh`: Postgres-only backup via `pg_dump` (custom format).
- `package.json`, `package-lock.json`: removed SQLite driver deps; added `db:backup` script.
- `.npmrc`: added `omit=peer` to avoid Drizzle peer driver installs.

### B) Runtime code: removed SQLite branches / fallbacks
Several runtime paths had “SQLite vs Postgres” branches. Those were simplified to Postgres-only to avoid silent SQLite fallback.

**Files**
- `server/index.ts`: removed SQLite “ensureSchema” bootstrapping and switched quote feed start to an explicit `startQuoteFeed()` call.
- `server/policy/buildDecisionContext.ts`, `server/utils/marketDailyClose.ts`, `db/create_admin_views.ts`, `server/routes/grift.ts`, `server/migration/migrationService.ts`: removed SQLite-only logic/strings.

### C) Repo cleanup: removed large dumps/logs and legacy SQLite scripts
Large log artifacts and legacy scripts were removed from git working tree.

**Files**
- Deleted: `db_dump.sql`, many `server-dev*.log`, `.tmp/*.log`, various `scripts/*` and `db/*` SQLite-era helpers, and `shared/schema.sqlite.ts`.

## 2) What was deleted, and why it matters

### A) `db_dump.sql` (very large)
- **Why it was deleted:** it appeared to be a full DB dump (high risk of containing sensitive/PII data) and was not required for Postgres runtime.
- **Why this can hurt you:** if you were using it as a migration/reference artifact, its removal interrupts that workflow.

### B) `data/i18n.sqlite` + `scripts/i18nSqliteToPostgres.ts`
- **What changed:** the local SQLite translation store `data/i18n.sqlite` was removed from the working tree to avoid any runtime/ops reliance on SQLite.
- **Why this can break user-visible behavior:** if you relied on that SQLite DB as the source of truth and did not migrate its contents into Postgres (`i18n_translations`), non-English bundles can be empty/incorrect and the UI can look like language prefs “disappeared”.
- **Mitigation:** the repo now contains a one-time import tool `scripts/i18nSqliteToPostgres.ts` (requires optional `better-sqlite3` only when you run it) so existing translations can be carried over instead of regenerated.

### C) `scripts/sqliteToPostgres.ts` (and other migration scripts)
- **Why it was deleted:** it was a SQLite→Postgres migration utility that depends on `better-sqlite3`.
- **Why this can hurt you:** it removes the practical ability to migrate existing data from the bundled SQLite DB(s) into Postgres.

### D) `db/schema.sql`
- **Why it was deleted:** it was the SQLite schema reference; Postgres schema is now represented by `db/schema.pg.sql` + Drizzle migrations.
- **Why this can hurt you:** if you relied on this file for schema reference/documentation, it’s now gone.

## 3) Concrete regressions identified (root causes)

### A) Leaderboard “disappeared”
**Root cause:** `/api/leaderboard` response shape changed.

- Before: `[{ userId, username, profit, winRate, totalTrades }]`
- After (current uncommitted): `[{ userId, username, profit }]`

The client uses `leader.winRate.toFixed(...)`, so missing `winRate` can crash the leaderboard UI.

**File involved**
- `server/storage.ts` (`getLeaderboard()`).

### B) i18n “language preferences disappeared / translations not propagating”
Most likely this is **data migration**, not UI code:
- Postgres i18n tables exist (`i18n_translations`, jobs, sources), but if they’re empty, bundles will return `{ strings: {} }` for non-default locales.
- Removing `data/i18n.sqlite` without migrating its contents removes the easiest path to preserve existing translation data.

**Files involved**
- Deleted/local-only artifact: `data/i18n.sqlite`
- One-time migration tooling: `scripts/i18nSqliteToPostgres.ts`
- Runtime: `server/i18n/service.ts`, `server/i18n/worker.ts`, `server/routes/i18n.ts`

### C) Swahili (sw) bundle shows mixed languages (e.g., Swedish)
**Root cause:** bad `sw` rows inside Postgres.
- `GET /api/i18n/bundle?locale=sw` returns whatever is stored in `i18n_translations.locale='sw'` (no fallback/merge).
- The LLM has produced Swedish/other-language outputs for some `sw` batches historically, so the DB contains mixed-language translations.

**Files involved**
- `server/i18n/providers/openai.ts` (LLM prompting/placeholder handling)
- `server/i18n/worker.ts` (job processing + validation)
- `scripts/i18nRepairLocale.ts` (requeue/delete suspect rows)

### D) Real-time quotes/trading “not instantaneous”
There is an identified WebSocket timing/race issue in `server/routes.ts` (the `/ws` server). A buffering fix was attempted, but smoke test reliability was still reported as intermittent for “send immediately on open”.

**Files involved**
- `server/routes.ts` (`wss.on("connection"...`).
- `scripts/adminSmoke.ts` (sends `auth:hello` + `quotes:subscribe` immediately).

## 4) Fixes applied in this working tree (since writing this doc)

### A) Leaderboard is repaired (contract + SQL)
- `/api/leaderboard` no longer 500s and no longer drops fields used by the client.
- Server now returns: `userId`, `username`, `profit` (absolute), `profitPct`, `winRate`, `totalTrades`.
- The query is Postgres-native and avoids `round(double precision, int)` by casting to `numeric`.

**Files**
- `server/storage.ts`
- `client/src/components/Leaderboard.tsx` (uses `profitPct` when present; falls back to computing from `profit`)

### B) i18n migration scripts restored (for SQLite → Postgres data carryover)
This reintroduces the *migration tooling* without reintroducing SQLite in runtime code paths.

**Files**
- `scripts/i18nSqliteToPostgres.ts` (requires optional `better-sqlite3` only when you run it)
- `scripts/sqliteToPostgres.ts` (requires optional `better-sqlite3` only when you run it)
- `package.json` (restores `db:import:sqlite` and adds `i18n:import:sqlite`)

### C) WebSocket message handler is made safer
The WS handler now defines `handleMessage` before attaching the `message` listener (avoids any theoretical TDZ/timing hazards).

**Files**
- `server/routes.ts`

## Appendix A) Full uncommitted file list

Current output of `git diff --name-status`:

```
M	.dockerignore
M	.githooks/pre-commit
M	.github/workflows/db-audit.yml
M	.gitignore
M	.replit
D	.tmp/dev-err.log
D	.tmp/dev-out.log
D	.tmp/prod-err.log
D	.tmp/prod-out.log
D	.tmp/stage-err.log
D	.tmp/stage-out.log
M	CODEX_COUNTRY_TIMEZONE_CONTROLS.md
M	JURISDICTION_CONTROLS_VERIFICATION_RUNBOOK.md
M	client/src/components/Leaderboard.tsx
M	client/src/components/admin/GriftAdmin.tsx
M	client/src/pages/TradeScreen.tsx
D	data/i18n.sqlite
D	db/add_quote_fields.ts
M	db/config.ts
M	db/create_admin_views.ts
D	db/fixLotSizes.ts
D	db/fixLots.ts
D	db/migrate.js
M	db/migrations/meta/_journal.json
D	db/schema.sql
D	db/updateLots.js
D	db/updateLots.mjs
D	db_dump.sql
M	drizzle.config.ts
M	package-lock.json
M	package.json
M	replit.md
M	scripts/activityAuditVerify.ts
D	scripts/add_lots_column.js
D	scripts/capacity_model.cjs
M	scripts/db-backup.sh
M	scripts/dbAudit.ts
M	scripts/dbDumpSchema.ts
D	scripts/fix-database.js
D	scripts/fix_quotes.js
D	scripts/fix_quotes.sql
M	scripts/i18nSqliteToPostgres.ts
D	scripts/initDb.cjs
D	scripts/prune-db-history.ps1
D	scripts/seedLegalAddenda.cjs
M	scripts/sqliteToPostgres.ts
D	server-dev-verify-10.err.log
D	server-dev-verify-10.log
D	server-dev-verify-11.err.log
D	server-dev-verify-11.log
D	server-dev-verify-12.err.log
D	server-dev-verify-12.log
D	server-dev-verify-13.err.log
D	server-dev-verify-13.log
D	server-dev-verify-2.err.log
D	server-dev-verify-2.log
D	server-dev-verify-3.err.log
D	server-dev-verify-3.log
D	server-dev-verify-4.err.log
D	server-dev-verify-4.log
D	server-dev-verify-5.err.log
D	server-dev-verify-5.log
D	server-dev-verify-6.err.log
D	server-dev-verify-6.log
D	server-dev-verify-7.err.log
D	server-dev-verify-7.log
D	server-dev-verify-8.err.log
D	server-dev-verify-8.log
D	server-dev-verify-9.err.log
D	server-dev-verify-9.log
D	server-dev-verify.err.log
D	server-dev-verify.log
D	server-dev.err.log
D	server-dev.log
M	server/cron/autoClose.ts
M	server/db/ensureSchema.ts
M	server/feeds/forgeFeed.ts
M	server/feeds/quoteFeed.ts
M	server/i18n/providers/openai.ts
M	server/index.ts
M	server/legal/regionRules.ts
M	server/migration/migrationService.ts
M	server/policy/buildDecisionContext.ts
M	server/routes.ts
M	server/routes/admin.ts
M	server/routes/grift.ts
M	server/storage.ts
D	server/utils/dailyChange.js
M	server/utils/marketDailyClose.ts
M	shared/schema.pg.ts
D	shared/schema.sqlite.ts
```
