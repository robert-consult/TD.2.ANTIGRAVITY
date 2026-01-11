import { defineConfig } from "drizzle-kit";

const sqliteUrl = process.env.SQLITE_DB_PATH ?? "./trading_app.db";

export default defineConfig({
  out: "./db/migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: sqliteUrl,
  },
  verbose: true,
});
