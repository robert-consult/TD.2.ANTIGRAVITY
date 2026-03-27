import { createHash } from "crypto";
import { trace } from "@opentelemetry/api";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { withObservedSpan } from "../server/observability/tracing";
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

function extractQueryText(args: unknown[]): string | null {
  const [query] = args;
  if (typeof query === "string") return query;
  if (query && typeof query === "object" && "text" in query && typeof (query as { text?: unknown }).text === "string") {
    return (query as { text: string }).text;
  }
  return null;
}

function summarizeQuery(text: string | null): { operation: string; statementHash: string } {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      operation: "UNKNOWN",
      statementHash: "unknown",
    };
  }

  const normalized = raw
    .replace(/'(?:''|[^'])*'/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
  const operation = normalized.split(" ", 1)[0]?.toUpperCase() || "UNKNOWN";
  const statementHash = createHash("sha1").update(normalized).digest("hex").slice(0, 16);

  return { operation, statementHash };
}

const originalQuery = pool.query.bind(pool);
function runPromiseQuery(args: unknown[]): Promise<unknown> {
  return originalQuery(...(args as Parameters<typeof pool.query>)) as unknown as Promise<unknown>;
}

pool.query = ((...args: unknown[]) => {
  const callback = args[args.length - 1];
  if (typeof callback === "function") {
    return originalQuery(...(args as Parameters<typeof pool.query>));
  }

  const activeSpan = trace.getActiveSpan();
  if (!activeSpan?.isRecording()) {
    return runPromiseQuery(args);
  }

  const summary = summarizeQuery(extractQueryText(args));
  return withObservedSpan({
    name: `db.${summary.operation.toLowerCase()}`,
    attributes: {
      "db.system": "postgresql",
      "db.operation": summary.operation,
      "tradehub.db.statement_hash": summary.statementHash,
    },
    fn: () => runPromiseQuery(args),
  });
}) as typeof pool.query;

export const dbClient = pool;
export const db = drizzle(pool, { schema });
