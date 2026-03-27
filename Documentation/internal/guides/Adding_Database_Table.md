---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - shared/schema.pg.ts
  - shared/schema.pg.base.ts
  - shared/schema.pg.audit.ts
  - db/
  - scripts/drizzleMigrate.ts
last_verified: 2026-03-27
status: maintained
---

# Adding A Database Table

Current workflow:

1. add the table to the correct schema domain file under `shared/schema.pg.*.ts`
2. re-export through `shared/schema.pg.ts` and `shared/schema.ts` when needed
3. generate SQL with `npm run db:generate`
4. apply with `npm run db:migrate:drizzle`
5. validate with `npm run db:audit`

Current guardrails:

- use the domain split in `shared/schema.pg.*.ts`, not a dumping-ground schema file
- keep schema intent aligned with existing audit, identity, legal, grift, and recruitment domains
- if a table touches critical trade or audit data, confirm trade-ledger guardrails still hold
- update storage or service accessors in the appropriate server domain instead of creating disconnected query paths
