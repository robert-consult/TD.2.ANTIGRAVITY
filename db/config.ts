export const dbDialect = "postgres" as const;
export const isPostgres = true as const;
export const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres.");
}
