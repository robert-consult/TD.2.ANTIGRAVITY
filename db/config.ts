export type DbDialect = "sqlite" | "postgres";

const normalizeDialect = (value: string | undefined): DbDialect => {
  const raw = (value ?? "").toLowerCase();
  if (raw === "postgres" || raw === "postgresql") return "postgres";
  return "sqlite";
};

export const dbDialect: DbDialect = normalizeDialect(process.env.DB_DIALECT ?? "postgres");
if (dbDialect !== "postgres") {
  throw new Error("SQLite is no longer supported. Set DB_DIALECT=postgres.");
}

export const isPostgres = dbDialect === "postgres";
export const databaseUrl = process.env.DATABASE_URL ?? "";
