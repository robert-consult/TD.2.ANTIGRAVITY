import path from "node:path";

type TableColumns = Map<string, Set<string>>;

const REQUIRED_TRADE_GUARD_TRIGGERS = [
  "tradequip_no_delete_trades",
  "tradequip_no_truncate_trades",
  "tradequip_no_delete_trade_audit",
  "tradequip_no_truncate_trade_audit",
  "tradequip_no_delete_order_intent_audit",
  "tradequip_no_truncate_order_intent_audit",
] as const;

const REQUIRED_TRADE_INDEXES = [
  "trades_user_opened_at_idx",
  "trades_user_status_opened_at_idx",
  "trades_symbol_status_opened_at_idx",
  "trades_user_closed_at_history_idx",
  "trades_open_opened_at_idx",
] as const;

function diff(expected: Set<string>, actual: Set<string>): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const extra: string[] = [];

  for (const c of expected) if (!actual.has(c)) missing.push(c);
  for (const c of actual) if (!expected.has(c)) extra.push(c);

  missing.sort();
  extra.sort();
  return { missing, extra };
}

function audit(expected: TableColumns, actual: TableColumns, label: string): number {
  let issues = 0;

  const expectedTables = [...expected.keys()].sort();
  const actualTables = new Set(actual.keys());

  const missingTables = expectedTables.filter((t) => !actualTables.has(t));
  if (missingTables.length) {
    issues += missingTables.length;
    console.error(`[audit] Missing tables in ${label}:`);
    for (const t of missingTables) console.error(`  - ${t}`);
  }

  const extraTables = [...actual.keys()].filter((t) => !expected.has(t)).sort();
  if (extraTables.length) {
    console.warn(`[audit] Extra tables in ${label} (not in code schema):`);
    for (const t of extraTables) console.warn(`  - ${t}`);
  }

  for (const t of expectedTables) {
    const expectedCols = expected.get(t);
    const actualCols = actual.get(t);
    if (!expectedCols || !actualCols) continue;
    const { missing, extra } = diff(expectedCols, actualCols);
    if (missing.length || extra.length) {
      issues += missing.length;
      if (missing.length) {
        console.error(`[audit] Missing columns for table ${t} in ${label}:`);
        console.error(`  ${missing.join(", ")}`);
      }
      if (extra.length) {
        console.warn(`[audit] Extra columns for table ${t} in ${label}:`);
        console.warn(`  ${extra.join(", ")}`);
      }
    }
  }

  return issues;
}

async function collectCodeColumnsPg(): Promise<TableColumns> {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const codeSchema = await import("../shared/schema.pg");

  const out: TableColumns = new Map();
  for (const exported of Object.values(codeSchema)) {
    try {
      const cfg = getTableConfig(exported as any);
      const tableName = cfg.name;
      const columnNames = Object.values(cfg.columns).map((c: any) => c.name);
      out.set(tableName, new Set(columnNames));
    } catch {
      // Not a Drizzle table export; ignore.
    }
  }
  return out;
}

async function collectDbColumnsPg(): Promise<TableColumns> {
  const { dbClient } = await import("../db");

  const tablesRes = await dbClient.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
    `,
  );
  const tables = tablesRes.rows.map((r: any) => String(r.table_name));
  if (!tables.length) return new Map();

  const colsRes = await dbClient.query(
    `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    ORDER BY table_name, ordinal_position
    `,
    [tables],
  );

  const out: TableColumns = new Map();
  for (const t of tables) out.set(t, new Set());
  for (const row of colsRes.rows) {
    const t = String(row.table_name);
    const c = String(row.column_name);
    if (!out.has(t)) out.set(t, new Set());
    out.get(t)!.add(c);
  }

  return out;
}

async function verifyTradeGuardrailsPg(): Promise<number> {
  const { dbClient } = await import("../db");
  let issues = 0;

  try {
    const trigRes = await dbClient.query(
      `
      SELECT tgname, tgenabled
      FROM pg_trigger
      WHERE NOT tgisinternal AND tgname = ANY($1::text[])
      `,
      [REQUIRED_TRADE_GUARD_TRIGGERS],
    );
    const enabledByName = new Map<string, string>();
    for (const row of trigRes.rows) {
      enabledByName.set(String(row.tgname), String(row.tgenabled));
    }

    for (const name of REQUIRED_TRADE_GUARD_TRIGGERS) {
      const state = enabledByName.get(name);
      if (!state) {
        issues += 1;
        console.error(`[audit] Missing required trade guard trigger: ${name}`);
        continue;
      }
      if (state === "D") {
        issues += 1;
        console.error(`[audit] Trade guard trigger is disabled: ${name}`);
      }
    }

    const idxRes = await dbClient.query(
      `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname='public' AND tablename='trades' AND indexname = ANY($1::text[])
      `,
      [REQUIRED_TRADE_INDEXES],
    );
    const foundIndexes = new Set(idxRes.rows.map((r: any) => String(r.indexname)));
    for (const name of REQUIRED_TRADE_INDEXES) {
      if (foundIndexes.has(name)) continue;
      issues += 1;
      console.error(`[audit] Missing required trades index: ${name}`);
    }
  } catch (err) {
    issues += 1;
    console.error(
      `[audit] Failed to verify trade guardrails/indexes: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return issues;
}

async function main() {
  const { dbClient } = await import("../db");

  try {
    const codeColumns = await collectCodeColumnsPg();
    const dbColumns = await collectDbColumnsPg();

    console.log(`[audit] Tables in code schema: ${codeColumns.size}`);
    console.log(`[audit] Tables in Postgres (public): ${dbColumns.size}`);
    const schemaIssues = audit(codeColumns, dbColumns, "postgres");
    const hardeningIssues = await verifyTradeGuardrailsPg();
    const issues = schemaIssues + hardeningIssues;

    if (issues === 0) {
      console.log("[audit] OK");
    } else {
      console.error(`[audit] Found ${issues} issue(s)`);
      process.exitCode = 1;
    }
  } finally {
    await dbClient.end();
  }
}

void main();
