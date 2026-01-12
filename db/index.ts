import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { databaseUrl } from "./config";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres.");
}

const pool = new Pool({ connectionString: databaseUrl });

export const dbClient = pool;
export const db = drizzle(pool, { schema });
