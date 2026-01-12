export type DbDialect = "sqlite" | "postgres";

const normalizeDialect = (value: string | undefined): DbDialect => {
  const raw = (value ?? "").toLowerCase();
  if (raw === "postgres" || raw === "postgresql") return "postgres";
  return "sqlite";
};

export const dbDialect: DbDialect = normalizeDialect(process.env.DB_DIALECT ?? "sqlite");

export const isPostgres = dbDialect === "postgres";
export const databaseUrl = process.env.DATABASE_URL ?? "";
export const sqlitePath = process.env.SQLITE_DB_PATH ?? "trading_app.db";
