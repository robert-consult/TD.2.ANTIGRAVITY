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
  - db/
  - scripts/drizzleMigrate.ts
last_verified: 2026-03-30
status: maintained
---

# Adding A Database Table

## Current Workflow

1. add the table to the correct schema domain file under `shared/schema.pg.*.ts`
2. re-export through `shared/schema.pg.ts` and `shared/schema.ts` when needed
3. generate SQL with `npm run db:generate`
4. apply with `npm run db:migrate:drizzle`
5. validate with `npm run db:audit`

## Current Guardrails

- use the domain split in `shared/schema.pg.*.ts`, not a dumping-ground schema file
- keep schema intent aligned with existing audit, identity, legal, grift, and recruitment domains
- if a table touches critical trade or audit data, confirm trade-ledger guardrails still hold
- update storage or service accessors in the appropriate server domain instead of creating disconnected query paths

## Migration Notes

- `scripts/drizzleMigrate.ts` applies missing migrations transactionally and records hashes in `drizzle.__drizzle_migrations`
- migration SQL belongs in `db/migrations/`
- CI-facing validation is `npm run db:audit`, not only local compile success

## Repo-Grounded Example

```ts
import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

const nowUnix = sql`(extract(epoch from now()))`;

export const partnerSnapshots = pgTable(
  "partner_snapshots",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    userCreatedIdx: index("partner_snapshots_user_created_idx").on(table.userId, table.createdAt),
  }),
);

export const insertPartnerSnapshotSchema = createInsertSchema(partnerSnapshots).pick({
  userId: true,
  snapshotJson: true,
});
```

Add the table to the correct `shared/schema.pg.*.ts` domain file first, then re-export it through `shared/schema.pg.ts` so the rest of the repo keeps a single schema aggregator.
