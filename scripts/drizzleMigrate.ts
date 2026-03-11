import { readMigrationFiles } from "drizzle-orm/migrator";
import { dbClient } from "../db";

const migrationsFolder = "db/migrations";
const migrationsSchema = "drizzle";
const migrationsTable = "__drizzle_migrations";

async function ensureMigrationsTable() {
  await dbClient.query(`CREATE SCHEMA IF NOT EXISTS "${migrationsSchema}"`);
  await dbClient.query(
    `CREATE TABLE IF NOT EXISTS "${migrationsSchema}"."${migrationsTable}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );
}

async function getExistingHashes(): Promise<Set<string>> {
  const { rows } = await dbClient.query(
    `SELECT hash FROM "${migrationsSchema}"."${migrationsTable}"`,
  );
  return new Set(rows.map((row) => String(row.hash)));
}

async function applyMissingMigrations() {
  await ensureMigrationsTable();

  const migrations = readMigrationFiles({ migrationsFolder });
  const existing = await getExistingHashes();
  const missing = migrations.filter((migration) => !existing.has(migration.hash));

  if (missing.length === 0) {
    console.log("[drizzle] No pending migrations");
    return;
  }

  const client = await dbClient.connect();
  try {
    for (const migration of missing) {
      await client.query("BEGIN");
      try {
        for (const statement of migration.sql) {
          const sql = statement.trim();
          if (!sql) continue;
          await client.query(sql);
        }

        await client.query(
          `INSERT INTO "${migrationsSchema}"."${migrationsTable}" (hash, created_at) VALUES ($1, $2)`,
          [migration.hash, migration.folderMillis],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

async function main() {
  try {
    await applyMissingMigrations();
    console.log("[drizzle] Migrations applied");
  } catch (error) {
    console.error("[drizzle] Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await dbClient.end();
  }
}

void main();
