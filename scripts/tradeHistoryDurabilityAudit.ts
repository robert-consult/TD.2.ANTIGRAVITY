import { execSync } from "node:child_process";
import { dbClient } from "../db";

function log(message: string) {
  console.log(`[audit:trade-history] ${message}`);
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function safeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return "(missing)";
  try {
    const u = new URL(raw);
    const user = u.username ? encodeURIComponent(u.username) : "";
    const host = u.hostname;
    const port = u.port || "(default)";
    const db = u.pathname?.replace(/^\//, "") || "(none)";
    const ssl = u.searchParams.get("sslmode") || u.searchParams.get("ssl") || "";
    const sslPart = ssl ? ` ssl=${ssl}` : "";
    return `${u.protocol}//${user ? `${user}:***@` : ""}${host}:${port}/${db}${sslPart}`;
  } catch {
    // Fallback: avoid printing anything after '@' or any query params.
    const at = raw.lastIndexOf("@");
    if (at !== -1) {
      return `***@${raw.slice(at + 1).split("?")[0]}`;
    }
    return "***";
  }
}

function tryDetectPostgresDataDir(): string | null {
  try {
    const out = execSync("ps -eo args", { encoding: "utf8" });
    const line = out
      .split("\n")
      .find((l) => l.includes("/postgres") && l.includes(" -D ") && l.includes("postgresql.conf"));
    if (!line) return null;
    const parts = line.split(/\s+/);
    const idx = parts.findIndex((p) => p === "-D");
    if (idx === -1) return null;
    const dir = parts[idx + 1];
    return dir ? String(dir) : null;
  } catch {
    return null;
  }
}

async function queryOne<T = any>(sql: string): Promise<T | null> {
  const res = await dbClient.query(sql);
  return (res.rows?.[0] as T) ?? null;
}

function isLocalServerAddr(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = String(addr).trim();
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const strictMode = boolEnv(process.env.TRADE_HISTORY_AUDIT_STRICT, process.env.NODE_ENV === "production");
  const failOnEmpty = boolEnv(process.env.TRADE_HISTORY_AUDIT_FAIL_ON_EMPTY, strictMode);
  const failOnSeqSkew = boolEnv(process.env.TRADE_HISTORY_AUDIT_FAIL_ON_SEQ_SKEW, strictMode);
  const failOnMissingTriggers = boolEnv(process.env.TRADE_HISTORY_AUDIT_FAIL_ON_MISSING_TRIGGERS, strictMode);
  const failOnLikelyEphemeralStorage = boolEnv(
    process.env.TRADE_HISTORY_AUDIT_FAIL_ON_EPHEMERAL_STORAGE,
    strictMode,
  );

  log(`DATABASE_URL=${safeDatabaseUrl(dbUrl)}`);
  log(
    `strictMode=${strictMode} failOnEmpty=${failOnEmpty} failOnSeqSkew=${failOnSeqSkew} failOnMissingTriggers=${failOnMissingTriggers} failOnEphemeralStorage=${failOnLikelyEphemeralStorage}`,
  );

  try {
    const info = await queryOne<{
      db: string;
      user: string;
      server_version: string;
      server_addr: string | null;
      server_port: number | null;
      uptime: string | null;
    }>(`
      SELECT
        current_database() AS db,
        current_user AS "user",
        current_setting('server_version') AS server_version,
        inet_server_addr()::text AS server_addr,
        inet_server_port() AS server_port,
        (now() - pg_postmaster_start_time())::text AS uptime
    `);

    log(
      `db=${info?.db ?? "?"} user=${info?.user ?? "?"} server=${(info?.server_addr ?? "unknown") + ":" + String(info?.server_port ?? "?")} uptime=${info?.uptime ?? "?"}`,
    );

    // Best-effort: detect local Postgres data dir only when we're actually connected to a local server addr.
    const dataDir = isLocalServerAddr(info?.server_addr) ? tryDetectPostgresDataDir() : null;
    if (dataDir) {
      log(`postgres.dataDir=${dataDir}`);
    } else {
      log("postgres.dataDir=(unavailable)");
    }

    const tradesCountsRes = await dbClient.query(
      "SELECT status, count(*)::int AS count FROM trades GROUP BY status ORDER BY status",
    );
    const counts = (tradesCountsRes.rows ?? []) as Array<{ status: string; count: number }>;
    const countsStr = counts.length
      ? counts.map((r) => `${String(r.status)}=${Number(r.count)}`).join(" ")
      : "(no rows)";
    log(`trades.byStatus=${countsStr}`);

    const seq = await queryOne<{ last_value: string }>("SELECT last_value::text FROM trades_id_seq");
    if (seq?.last_value) {
      log(`trades.idSeq.lastValue=${seq.last_value}`);
    }

    const triggers = await dbClient.query(
      "SELECT tgname FROM pg_trigger WHERE tgname LIKE 'tradequip_no_%' ORDER BY tgname",
    );
    const triggerNames = (triggers.rows ?? []).map((r: any) => String(r.tgname ?? "")).filter(Boolean);
    log(`tradeGuard.triggers=${triggerNames.length ? triggerNames.join(",") : "(missing)"}`);

    const stats = await dbClient.query(
      `
        SELECT relname, n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup
        FROM pg_stat_user_tables
        WHERE relname IN ('trades','trade_audit','order_intent_audit')
        ORDER BY relname
      `,
    );
    for (const row of stats.rows as any[]) {
      log(
        `pgStat.${row.relname}: ins=${row.n_tup_ins} upd=${row.n_tup_upd} del=${row.n_tup_del} live=${row.n_live_tup} dead=${row.n_dead_tup}`,
      );
    }

    // Heuristic warnings
    const totalTrades = counts.reduce((sum, r) => sum + Number(r.count || 0), 0);
    const hardFailures: string[] = [];
    if (totalTrades === 0) {
      const msg =
        "WARN: trades table is empty. If history disappears after a host shutdown, your Postgres storage may be ephemeral or you're pointing at a different DATABASE_URL.";
      log(msg);
      if (failOnEmpty) hardFailures.push("EMPTY_TRADES_TABLE");
    } else if (seq?.last_value && Number(seq.last_value) > totalTrades * 10 && Number(seq.last_value) > 100) {
      const msg =
        "WARN: trades_id_seq is far ahead of row count; this often indicates prior DELETE/TRUNCATE/reset events (history may have been wiped).";
      log(msg);
      if (failOnSeqSkew) hardFailures.push("TRADES_SEQUENCE_SKEW");
    }

    if (triggerNames.length < 6) {
      const msg =
        "WARN: trade anti-wipe triggers are missing or incomplete. Run `npm run db:migrate:drizzle` and `npm run db:audit` to restore guardrails.";
      log(msg);
      if (failOnMissingTriggers) hardFailures.push("MISSING_ANTIWIPE_TRIGGERS");
    }

    if (dataDir && dataDir.startsWith("/var/lib/postgresql")) {
      const msg =
        "WARN: Postgres data directory is under /var/lib/postgresql. On some hosts this is not persisted across shutdown/redeploy. Use a persistent volume/bind mount for PGDATA (e.g. docker compose with a bind-mounted data dir).";
      log(msg);
      if (failOnLikelyEphemeralStorage) hardFailures.push("LIKELY_EPHEMERAL_PGDATA");
    }

    if (hardFailures.length > 0) {
      log(`FAIL: durability guard(s) triggered: ${hardFailures.join(",")}`);
      process.exitCode = 1;
      return;
    }

    log("Done.");
  } catch (e) {
    log(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await dbClient.end();
  }
}

void main();
