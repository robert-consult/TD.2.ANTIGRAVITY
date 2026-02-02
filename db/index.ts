import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { databaseUrl } from "./config";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres.");
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

const poolMax = envInt("PG_POOL_MAX");
const idleTimeoutMillis = envInt("PG_POOL_IDLE_TIMEOUT_MS");
const connectionTimeoutMillis = envInt("PG_POOL_CONNECTION_TIMEOUT_MS");

const pool = new Pool({
  connectionString: databaseUrl,
  ...(poolMax ? { max: poolMax } : {}),
  ...(idleTimeoutMillis ? { idleTimeoutMillis } : {}),
  ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {}),
});

export const dbClient = pool;
export const db = drizzle(pool, { schema });
