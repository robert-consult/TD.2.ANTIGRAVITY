import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getPetascaleRuntimeConfig } from "./petascaleEnv";

let client: ClickHouseClient | null = null;
let warnedDisabled = false;
let warnedFailed = false;

export function getClickHouseClient(): ClickHouseClient | null {
  const cfg = getPetascaleRuntimeConfig();
  if (!cfg.clickhouseEnabled || !cfg.clickhouseUrl) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.log("[clickhouse] disabled (CLICKHOUSE_ENABLED=0 or CLICKHOUSE_URL missing)");
    }
    return null;
  }

  if (client) return client;

  try {
    client = createClient({
      url: cfg.clickhouseUrl,
      username: cfg.clickhouseUsername || "default",
      password: cfg.clickhousePassword || undefined,
      database: cfg.clickhouseDatabase || "default",
      request_timeout: cfg.clickhouseRequestTimeoutMs,
    });
    return client;
  } catch (err) {
    if (!warnedFailed) {
      warnedFailed = true;
      console.warn("[clickhouse] failed to initialize client:", err);
    }
    client = null;
    return null;
  }
}

export async function queryClickHouseJson<T = Record<string, unknown>>(params: {
  query: string;
  query_params?: Record<string, unknown>;
}): Promise<T[] | null> {
  const ch = getClickHouseClient();
  if (!ch) return null;
  const rs = await ch.query({
    query: params.query,
    query_params: params.query_params,
    format: "JSONEachRow",
  });
  return (await rs.json()) as T[];
}

export async function commandClickHouse(params: {
  query: string;
  query_params?: Record<string, unknown>;
}): Promise<boolean> {
  const ch = getClickHouseClient();
  if (!ch) return false;
  await ch.command({
    query: params.query,
    query_params: params.query_params,
  });
  return true;
}

export async function insertClickHouseJsonRows(
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<boolean> {
  if (!rows.length) return true;
  const ch = getClickHouseClient();
  if (!ch) return false;
  await ch.insert({
    table,
    values: rows,
    format: "JSONEachRow",
  });
  return true;
}
