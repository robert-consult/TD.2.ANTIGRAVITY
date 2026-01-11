import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function main() {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const dbPath = path.resolve(repoRoot, "trading_app.db");
  const outPath = path.resolve(repoRoot, "db", "schema.sql");

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
      .all() as Array<{ sql: string }>;

    const normalized = rows
      .map((row) => row.sql.trim())
      .filter((sql) => sql.length > 0)
      .map((sql) => (sql.endsWith(";") ? sql : `${sql};`))
      .join("\n");

    fs.writeFileSync(outPath, normalized + "\n", "utf8");
    console.log(`[schema] Wrote ${path.relative(repoRoot, outPath)}`);
  } finally {
    db.close();
  }
}

main();

