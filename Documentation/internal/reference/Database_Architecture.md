---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - shared/schema.pg.ts
  - shared/schema.pg.base.ts
  - shared/schema.pg.audit.ts
  - shared/schema.pg.identity.ts
  - shared/schema.pg.grift.ts
  - shared/schema.pg.legal.ts
  - shared/schema.pg.recruitment.ts
  - db/migrations/
  - scripts/drizzleMigrate.ts
  - scripts/dbAudit.ts
last_verified: 2026-03-30
status: maintained
---

# Database Architecture

## Schema Shape

The Postgres schema is intentionally split by domain:

- `schema.pg.base.ts`: core product tables such as users, sessions, trades, quotes, mailbox, notifications, push devices, global settings, and system config
- `schema.pg.audit.ts`: audit and historical tables
- `schema.pg.identity.ts`: verification, MFA, KYC, payout, and identity audit surfaces
- `schema.pg.grift.ts`: fraud signals, scores, links, and enforcement state
- `schema.pg.legal.ts`: legal documents, pointers, acceptances, and legal-change audit
- `schema.pg.recruitment.ts`: challenge, scouting, recruitment, and partner-adjacent recruitment data

`shared/schema.pg.ts` is the aggregator and re-export layer. New tables should be added to a domain file first, then surfaced through the aggregator.

## Topology

```mermaid
flowchart TD
  A[shared/schema.pg.base.ts]
  B[shared/schema.pg.audit.ts]
  C[shared/schema.pg.identity.ts]
  D[shared/schema.pg.grift.ts]
  E[shared/schema.pg.legal.ts]
  F[shared/schema.pg.recruitment.ts]
  G[shared/schema.pg.ts aggregator]
  H[db/migrations/*.sql]
  I[scripts/drizzleMigrate.ts]
  J[server runtime + storage/services/routes]
  K[shared zod + TS contracts]
  L[db:audit]

  A --> G
  B --> G
  C --> G
  D --> G
  E --> G
  F --> G
  G --> J
  G --> K
  G --> H
  H --> I
  I --> L
  J --> L
```

## Runtime Coupling

- the Express session store is backed by the `session` table
- trade, audit, and order-intent durability rely on schema plus migration guardrails
- runtime config, policy decisions, legal coverage, i18n, partner, and admin-export paths all depend on schema-backed state

## Migration Path

1. change the correct `shared/schema.pg.*.ts` file
2. generate SQL with `npm run db:generate`
3. apply with `npm run db:migrate:drizzle`
4. validate with `npm run db:audit`

`scripts/drizzleMigrate.ts` is not a thin shell. It ensures `drizzle.__drizzle_migrations` exists, computes missing hashes from `db/migrations/`, and applies each missing migration transactionally.

## Gold-Standard Rules

- do not collapse domain files back into one schema dumping ground
- treat schema changes as contract changes when web/mobile/server consumers rely on them
- when the table affects trading, audit, identity, or legal state, verify the adjacent runtime invariants explicitly
