import path from "node:path";

type TableColumns = Map<string, Set<string>>;

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

  await dbClient.end();
  return out;
}

async function main() {
  const codeColumns = await collectCodeColumnsPg();
  const dbColumns = await collectDbColumnsPg();

  console.log(`[audit] Tables in code schema: ${codeColumns.size}`);
  console.log(`[audit] Tables in Postgres (public): ${dbColumns.size}`);
  const issues = audit(codeColumns, dbColumns, "postgres");

  if (issues === 0) {
    console.log("[audit] OK");
  } else {
    console.error(`[audit] Found ${issues} issue(s)`);
    process.exitCode = 1;
  }
}

void main();
