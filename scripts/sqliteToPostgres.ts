import { Client } from "pg";
import { resolveLegacySqliteSource } from "../db/legacySqliteSource";

const BATCH_SIZE = Number(process.env.MIGRATE_BATCH_SIZE ?? 500);
const DRY_RUN = process.env.MIGRATE_DRY_RUN === "1";

const EXCLUDED_TABLES = new Set<string>([
  "sqlite_sequence",
  "__drizzle_migrations",
  "migration_export_jobs",
  "migration_import_jobs",
  "migration_job_logs",
  "migration_id_map",
  "migration_integrity_checks",
]);

const TABLE_ORDER = [
  "users",
  "user_settings",
  "user_verification",
  "user_mfa",
  "user_kyc_profiles",
  "user_payout_profiles",
  "user_sessions",
  "user_login_history",
  "user_account_events",
  "user_admin_notes",
  "trader_journal",
  "user_equity_daily",
  "email_verification_tokens",
  "sms_otp_tokens",
  "signup_fingerprints",
  "signup_jurisdiction_blocks",
  "symbol_configs",
  "global_settings",
  "system_config",
  "trades",
  "trade_audit",
  "order_intent_audit",
  "daily_fx_closes",
  "daily_closes",
  "daily_prices",
  "price_history",
  "price_references",
  "reference_prices",
  "market_daily_close",
  "prev_close_cache",
  "quotes",
  "admin_actions",
  "identity_audit",
  "legal_documents",
  "legal_doc_targets",
  "legal_doc_pointers",
  "legal_doc_change_audit",
  "legal_doc_change_audit_chain",
  "legal_acceptances",
  "legal_reaccept_requirements",
  "grift_config",
  "grift_devices",
  "grift_device_users",
  "grift_identity_links",
  "grift_user_scores",
  "grift_user_risk",
  "grift_signals",
  "grift_observations",
  "grift_alerts",
  "grift_cases",
  "grift_case_signals",
  "grift_case_notes",
  "grift_case_links",
  "grift_user_enforcements",
  "grift_enforcement_log",
  "grift_admin_actions",
  "grift_ip_asn_dataset_meta",
  "grift_ip_asn_ranges",
  "grift_ip_asn_cache",
  "grift_trade_observations",
  "grift_linked_account_edges",
];

function log(message: string) {
  console.log(`[sqlite->pg] ${message}`);
}

async function loadBetterSqlite3(): Promise<any> {
  try {
    const mod = await import("better-sqlite3");
    return (mod as any).default ?? mod;
  } catch {
    throw new Error(
      "Missing optional dependency 'better-sqlite3'. Install it temporarily to run this migration: npm i -D better-sqlite3",
    );
  }
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function normalizeBoolean(value: any) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "t" || v === "yes") return true;
    if (v === "0" || v === "false" || v === "f" || v === "no") return false;
  }
  return value;
}

function normalizeInteger(value: any) {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return Math.floor(parsed / 1000);
      }
    }
    return value;
  }
  if (num > 2_147_483_647) {
    if (num > 1_000_000_000_000) {
      return Math.floor(num / 1000);
    }
  }
  return Math.trunc(num);
}

function getSqliteTables(db: any) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return rows
    .map((r: any) => String(r.name))
    .filter((name: string) => !name.startsWith("sqlite_") && !EXCLUDED_TABLES.has(name));
}

async function getPostgresTables(client: Client) {
  const res = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
  );
  return new Set(res.rows.map((r) => String(r.table_name)));
}

async function getPostgresColumns(client: Client, table: string) {
  const res = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => ({
    name: String(r.column_name),
    type: String(r.data_type),
  }));
}

function getSqliteColumns(db: any, table: string) {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  return rows.map((r: any) => String(r.name));
}

async function resetSequence(client: Client, table: string) {
  try {
    const seqRes = await client.query(
      "SELECT pg_get_serial_sequence($1, 'id') AS seq",
      [`public.${table}`],
    );
    const seq = seqRes.rows[0]?.seq;
    if (!seq) return;
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1), true)`,
      [seq],
    );
  } catch (err) {
    log(`Sequence reset skipped for ${table}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const sqliteSource = resolveLegacySqliteSource({ purpose: "SQLite -> Postgres migration" });
  const sqlitePath = sqliteSource.sqlitePath;

  const BetterSqlite3 = await loadBetterSqlite3();
  const sqlite = new BetterSqlite3(sqlitePath, { readonly: true });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const sqliteTables = new Set(getSqliteTables(sqlite));
  const postgresTables = await getPostgresTables(client);

  const ordered = TABLE_ORDER.filter((t) => sqliteTables.has(t) && postgresTables.has(t));
  const extras = [...sqliteTables].filter((t) => postgresTables.has(t) && !TABLE_ORDER.includes(t));
  const tables = [...ordered, ...extras.sort()];

  log(`SQLite: ${sqliteTables.size} tables, Postgres: ${postgresTables.size} tables`);
  log(`Migrating ${tables.length} table(s) from ${sqlitePath} (${sqliteSource.kind})`);

  for (const table of tables) {
    const pgColumns = await getPostgresColumns(client, table);
    const sqliteColumns = getSqliteColumns(sqlite, table);
    const columns = pgColumns.map((c) => c.name).filter((c) => sqliteColumns.includes(c));

    if (!columns.length) {
      log(`Skip ${table}: no shared columns`);
      continue;
    }

    const typeByColumn = new Map(pgColumns.map((c) => [c.name, c.type]));
    const selectSql = `SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}`;
    let stmt: any;
    try {
      stmt = sqlite.prepare(selectSql);
    } catch (err) {
      log(`Skip ${table}: sqlite prepare failed (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }

    let inserted = 0;
    let batch: any[] = [];

    const flush = async () => {
      if (!batch.length) return;
      if (DRY_RUN) {
        inserted += batch.length;
        batch = [];
        return;
      }

      const values: any[] = [];
      const valueGroups: string[] = [];

      for (const row of batch) {
        const rowValues = columns.map((col) => {
          const type = typeByColumn.get(col) ?? "";
          const value = row[col];
          if (type === "boolean") return normalizeBoolean(value);
          if (type === "integer") return normalizeInteger(value);
          return value;
        });
        values.push(...rowValues);
        const offset = values.length - rowValues.length;
        const placeholders = rowValues.map((_, i) => `$${offset + i + 1}`).join(", ");
        valueGroups.push(`(${placeholders})`);
      }

      const sql = `INSERT INTO ${quoteIdent(table)} (${columns
        .map(quoteIdent)
        .join(", ")}) VALUES ${valueGroups.join(", ")} ON CONFLICT DO NOTHING`;
      await client.query(sql, values);
      inserted += batch.length;
      batch = [];
    };

    try {
      for (const row of stmt.iterate()) {
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          await flush();
        }
      }
      await flush();
      await resetSequence(client, table);
      log(`${table}: ${inserted} row(s)`);
    } catch (err) {
      log(`Skip ${table}: sqlite read failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  await client.end();
  sqlite.close();
  log(DRY_RUN ? "Dry run complete." : "Migration complete.");
}

main().catch((err) => {
  console.error(`[sqlite->pg] FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
