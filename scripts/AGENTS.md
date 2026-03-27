# `scripts/` AGENTS.md (Tooling, Audits, Load Tests)

## What this area is
Operational and developer tooling: DB ensure/audit/dump, activity audits, i18n tools, and load tests.

## Non-negotiables
- Scripts must be safe by default (no surprise production mutations).
- Never print secrets (env vars) or dump PII to stdout.
- Prefer idempotent operations; document any destructive behavior clearly in the script help/header.

## Important scripts
- DB audit (CI): `scripts/dbAudit.ts`, `scripts/dbDumpSchema.ts`
- Activity audit: `scripts/activityAuditVerify.ts`
- Admin smoke: `scripts/adminSmoke.ts`
- Load tests: `scripts/loadtest/publishQuotes.ts`, `scripts/loadtest/wsFanout.ts`
- Docs automation: `scripts/docs/AGENTS.md`, `scripts/docs/README.md`

## Required checks before finalizing
- If you changed DB tooling: run `npm run db:audit`
- If you changed load tests: run the modified script locally with a safe target
