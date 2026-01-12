import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import Database from "better-sqlite3";
import { Pool } from "pg";
import * as sqliteSchema from "@shared/schema";
import * as pgSchema from "@shared/schema.pg";
import { databaseUrl, isPostgres, sqlitePath } from "./config";

let dbClient: Database | Pool;
let db: ReturnType<typeof sqliteDrizzle> | ReturnType<typeof pgDrizzle>;

if (isPostgres) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when DB_DIALECT=postgres.");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  dbClient = pool;
  db = pgDrizzle(pool, { schema: pgSchema });
} else {
  // Create a SQLite database file at the project root
  const sqlite = new Database(sqlitePath);
  // Improve concurrency for background audit logging + grift telemetry.
  try {
    sqlite.pragma("journal_mode = WAL");
  } catch {}
  try {
    sqlite.pragma("busy_timeout = 5000");
  } catch {}
  try {
    sqlite.pragma("foreign_keys = ON");
  } catch {}
  dbClient = sqlite;
  db = sqliteDrizzle(sqlite, { schema: sqliteSchema });
}

export { db, dbClient };
