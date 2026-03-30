# Adding a Database Table

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `PROJECT_STRUCTURE.md` §Adding a Database Table, `db/AGENTS.md`

---

## Steps

### 1. Define the Schema

Add the Drizzle table definition in the appropriate domain schema file:

| Domain | File |
|---|---|
| Core (users, trades, accounts) | `shared/schema.pg.base.ts` |
| Audit trails | `shared/schema.pg.audit.ts` |
| Anti-fraud | `shared/schema.pg.grift.ts` |
| Identity/KYC | `shared/schema.pg.identity.ts` |
| Legal compliance | `shared/schema.pg.legal.ts` |
| Recruitment/challenges | `shared/schema.pg.recruitment.ts` |

```ts
export const myNewTable = pgTable("my_new_table", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 2. Re-export from Aggregator

Ensure the table is exported from `shared/schema.pg.ts` and `shared/schema.ts`.

### 3. Generate Migration SQL

```bash
npm run db:generate
```

This creates a new SQL file in `db/migrations/` and updates `db/migrations/meta/_journal.json`.

### 4. Review the Migration

Check the generated SQL in `db/migrations/NNNN_*.sql`. Verify:
- Column types match intent
- Indexes cover query predicates
- No destructive changes without explicit approval

### 5. Apply Migration

```bash
npm run db:migrate:drizzle
```

### 6. Verify Schema Integrity

```bash
npm run db:audit
```

This CI-enforced check verifies migration parity between the schema definition and the live database.

### 7. Add Storage Queries

Add data access functions in `server/storage.ts` or a domain-specific storage module.

---

## Related Pages

- [Database Layer →](../02_Architecture_Reference/03_Database_Layer.md)
- [Adding an API Endpoint →](01_Adding_API_Endpoint.md)
- [Definition of Done →](07_Definition_of_Done.md)
