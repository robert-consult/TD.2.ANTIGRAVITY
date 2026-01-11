import Database from "better-sqlite3";
import fs from "node:fs";

const I18N_DB_PATH = "./i18n.db";
const MAIN_DB_PATH = "./trading_app.db";

export function getI18nDb() {
  // Use separate i18n.db if it exists and is valid, otherwise fall back to main db
  const dbPath = fs.existsSync(I18N_DB_PATH) ? I18N_DB_PATH : MAIN_DB_PATH;
  const db = new Database(dbPath);
  try {
    db.pragma("busy_timeout = 5000");
  } catch {}
  return db;
}

export function withI18nDb<T>(fn: (db: Database.Database) => T): T {
  const db = getI18nDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export async function withI18nDbAsync<T>(fn: (db: Database.Database) => Promise<T>): Promise<T> {
  const db = getI18nDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}
