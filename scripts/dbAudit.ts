import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as codeSchema from "../shared/schema";

type TableColumns = Map<string, Set<string>>;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function getDbTableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function getDbTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name).filter((name) => !name.startsWith("sqlite_"));
}

function collectDbColumns(db: Database.Database): TableColumns {
  const tables = getDbTables(db);
  const out: TableColumns = new Map();
  for (const t of tables) out.set(t, getDbTableColumns(db, t));
  return out;
}

function collectCodeColumns(): TableColumns {
  const out: TableColumns = new Map();

  for (const exported of Object.values(codeSchema)) {
    try {
      const cfg = getTableConfig(exported as any);
      const tableName = cfg.name;
      const columnNames = Object.values(cfg.columns).map((c) => c.name);
      out.set(tableName, new Set(columnNames));
    } catch {
      // Not a Drizzle table export; ignore.
    }
  }

  return out;
}

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

function buildSchemaDumpDb(dumpSql: string): Database.Database {
  const mem = new Database(":memory:");
  try {
    mem.pragma("foreign_keys = ON");
  } catch {}

  // sqlite_sequence is an internal table and cannot be created directly.
  const sanitized = dumpSql.replace(/^CREATE TABLE sqlite_sequence\(name,seq\);\s*$/gm, "");
  mem.exec(sanitized);
  return mem;
}

function main() {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const dbPath = path.resolve(repoRoot, "trading_app.db");
  const schemaDumpPath = path.resolve(repoRoot, "db", "schema.sql");

  const codeColumns = collectCodeColumns();

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const dbColumns = collectDbColumns(db);

    console.log(`[audit] Tables in code schema: ${codeColumns.size}`);
    console.log(`[audit] Tables in trading_app.db: ${dbColumns.size}`);

    let issues = 0;
    issues += audit(codeColumns, dbColumns, "trading_app.db");

    if (fs.existsSync(schemaDumpPath)) {
      const dumpSql = fs.readFileSync(schemaDumpPath, "utf8");
      let dumpDb: Database.Database | null = null;
      try {
        dumpDb = buildSchemaDumpDb(dumpSql);
        const dumpColumns = collectDbColumns(dumpDb);
        console.log(`[audit] Tables in db/schema.sql: ${dumpColumns.size}`);
        issues += audit(dbColumns, dumpColumns, "db/schema.sql");
      } catch (e) {
        issues += 1;
        console.error("[audit] Failed to load db/schema.sql into SQLite:", e);
      } finally {
        dumpDb?.close();
      }
    } else {
      console.warn("[audit] db/schema.sql not found; skipping schema dump check");
    }

    if (issues === 0) {
      console.log("[audit] OK");
    } else {
      console.error(`[audit] Found ${issues} issue(s)`);
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main();
