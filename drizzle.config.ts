import { defineConfig } from "drizzle-kit";

const sqliteUrl = process.env.SQLITE_DB_PATH ?? "./trading_app.db";
const databaseUrl = process.env.DATABASE_URL ?? "";
const dbDialect = (process.env.DB_DIALECT ?? "postgres").toLowerCase();
const isPostgres = dbDialect === "postgres" || dbDialect === "postgresql";

export default defineConfig({
  out: "./db/migrations",
  schema: isPostgres ? "./shared/schema.pg.ts" : "./shared/schema.ts",
  dialect: isPostgres ? "postgresql" : "sqlite",
  dbCredentials: {
    url: isPostgres ? databaseUrl : sqliteUrl,
  },
  verbose: true,
});
