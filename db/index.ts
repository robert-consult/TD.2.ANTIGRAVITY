import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from "@shared/schema";

// Create a SQLite database file at the project root
const sqlite = new Database('trading_app.db');
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
export const db = drizzle(sqlite, { schema });
