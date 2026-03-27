# Database Layer

> **Diátaxis quadrant:** Reference
> **Sources:** `.agents/deep-context.md` §Database, `db/` directory, `shared/schema.pg.*.ts`, `MIGRATION_REVIEW.md`

---

## Technology

- **ORM:** Drizzle ORM (TypeScript-first, SQL-native)
- **Database:** PostgreSQL (via `pg` driver + PgBouncer for connection pooling in production)
- **Migrations:** SQL-based, managed via Drizzle Kit
- **Legacy:** SQLite (`trading_app.db`, ~90MB) — used only for migration source data

---

## Schema Domain Files

| File | Domain | Size |
|---|---|---|
| `shared/schema.pg.base.ts` | Core tables (users, trades, accounts, instruments, quotes) | ~50KB |
| `shared/schema.pg.audit.ts` | Audit trail tables | ~19KB |
| `shared/schema.pg.grift.ts` | Anti-fraud detection tables | ~19KB |
| `shared/schema.pg.identity.ts` | Identity/KYC verification | ~8KB |
| `shared/schema.pg.legal.ts` | Legal terms and acceptances | ~12KB |
| `shared/schema.pg.recruitment.ts` | Recruitment/scouting/challenges | ~38KB |
| `shared/schema.pg.ts` | Aggregator (re-exports all domain schemas) | — |
| `shared/schema.ts` | Top-level re-export hub | — |

---

## Migration Workflow

```bash
# 1. Define schema changes in shared/schema.pg.*.ts
# 2. Generate SQL migration
npm run db:generate

# 3. Review generated SQL in db/migrations/
# 4. Apply migration
npm run db:migrate          # alias: db:migrate:drizzle

# 5. Verify schema integrity
npm run db:audit
```

There are currently **47 migration files** in `db/migrations/`.

---

## Key DB Files

| File | Purpose |
|---|---|
| `db/index.ts` | DB connection and pool |
| `db/config.ts` | DB configuration (dialect, URL) |
| `db/migrate.ts` | Migration runner |
| `db/seed.ts` | Seed data (~11KB) |
| `db/schema.pg.sql` | Full PostgreSQL DDL (~203KB) |
| `server/storage.ts` | Data access layer (~57KB) |

---

## Trade Ledger Guardrails

PostgreSQL triggers prevent accidental deletion/truncation of critical trade data:

- `tradequip_no_delete_trades`
- `tradequip_no_truncate_trades`
- `tradequip_no_delete_trade_audit`
- `tradequip_no_truncate_trade_audit`
- `tradequip_no_delete_order_intent_audit`
- `tradequip_no_truncate_order_intent_audit`

The server **refuses to start** if any of these triggers are missing or disabled.

---

## Related Pages

- [Adding a Database Table →](../01_Development_Guides/02_Adding_Database_Table.md)
- [Shared Contracts →](04_Shared_Contracts.md)
- [Server Backend →](02_Server_Backend.md)
