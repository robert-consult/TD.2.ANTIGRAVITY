import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { resolveLegacySqliteSource } from "../db/legacySqliteSource";

const RECOVER_EMAIL = process.env.RECOVER_EMAIL ?? "";
const APPLY = process.env.RECOVER_APPLY === "1";
const INCLUDE_OPEN = process.env.RECOVER_INCLUDE_OPEN === "1";

function log(message: string) {
  console.log(`[recover:sqlite-trades] ${message}`);
}

function die(message: string): never {
  console.error(`[recover:sqlite-trades] FAIL: ${message}`);
  process.exit(1);
}

function sqliteStringLiteral(value: string): string {
  // SQLite uses '' to escape single quotes inside string literals.
  return `'${value.replace(/'/g, "''")}'`;
}

function sqliteJson(dbPath: string, sql: string): any[] {
  const res = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(res.stderr || `sqlite3 exited with status ${res.status}`);
  }
  const raw = (res.stdout ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    throw new Error(`Failed to parse sqlite3 JSON output (${err instanceof Error ? err.message : String(err)})`);
  }
}

const TRADES_COLUMNS = [
  "id",
  "user_id",
  "symbol_id",
  "type",
  "order_type",
  "size",
  "lots",
  "open_price",
  "close_price",
  "take_profit",
  "stop_loss",
  "limit_price",
  "stop_price",
  "profit",
  "status",
  "opened_at",
  "executed_at",
  "closed_at",
  "close_reason",
  "close_quote_ts",
  "close_source",
  "close_bid",
  "close_ask",
  "close_mid",
  "close_spread",
  "correlation_id",
  "order_id",
  "position_id",
  "last_execution_id",
  "last_actor_user_id",
  "last_actor_session_id",
  "last_actor_ip",
  "last_actor_user_agent",
  "last_actor_type",
  "last_actor_device_id",
] as const;

const TRADE_AUDIT_COLUMNS = [
  "id",
  "trade_id",
  "event_type",
  "event_category",
  "event_at",
  "event_at_ms",
  "correlation_id",
  "order_id",
  "execution_id",
  "position_id",
  "actor_type",
  "actor_user_id",
  "session_id",
  "ip",
  "user_agent",
  "symbol",
  "side",
  "order_type",
  "time_in_force",
  "qty_lots",
  "requested_price",
  "trigger_price",
  "limit_price",
  "stop_price",
  "fill_price",
  "avg_fill_price",
  "quote_ts",
  "quote_source",
  "quote_bid",
  "quote_ask",
  "quote_mid",
  "quote_spread",
  "spread_pips",
  "slippage",
  "slippage_pips",
  "slippage_reference",
  "latency_ms",
  "risk_check_name",
  "risk_limit_value",
  "risk_observed_value",
  "risk_result",
  "reason_code",
  "payload_json",
  "prev_hash",
  "event_hash",
  "note",
] as const;

async function insertRows(
  client: Client,
  table: string,
  columns: readonly string[],
  rows: Record<string, any>[],
) {
  if (!rows.length) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const values = columns.map((c) => (row[c] === undefined ? null : row[c]));
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
      VALUES (${placeholders})
      ON CONFLICT ("id") DO NOTHING`;
    const res = await client.query(sql, values);
    if (res.rowCount === 1) inserted += 1;
    else skipped += 1;
  }

  return { inserted, skipped };
}

async function main() {
  if (!RECOVER_EMAIL.trim()) {
    die("RECOVER_EMAIL is required (e.g. RECOVER_EMAIL=user@example.com)");
  }
  if (!process.env.DATABASE_URL) {
    die("DATABASE_URL is required for Postgres.");
  }

  const sqlitePath = resolveLegacySqliteSource({
    purpose: "trade recovery from SQLite",
  }).sqlitePath;

  const emailLit = sqliteStringLiteral(RECOVER_EMAIL.trim());
  const sqliteUser = sqliteJson(
    sqlitePath,
    `SELECT id,email,username,is_admin FROM users WHERE lower(email)=lower(${emailLit}) LIMIT 1`,
  )[0];
  if (!sqliteUser) {
    die(`No SQLite user found for ${RECOVER_EMAIL}`);
  }

  const statusClause = INCLUDE_OPEN ? "" : " AND status IN ('CLOSED','CANCELED')";
  const sqliteTrades = sqliteJson(
    sqlitePath,
    `SELECT
      id,
      user_id,
      symbol_id,
      type,
      order_type,
      size,
      CASE WHEN lots IS NULL THEN NULL ELSE CAST(lots AS INTEGER) END AS lots,
      open_price,
      close_price,
      take_profit,
      stop_loss,
      limit_price,
      stop_price,
      profit,
      status,
      opened_at,
      executed_at,
      closed_at,
      close_reason,
      close_quote_ts,
      close_source,
      close_bid,
      close_ask,
      close_mid,
      close_spread,
      correlation_id,
      order_id,
      position_id,
      last_execution_id,
      last_actor_user_id,
      last_actor_session_id,
      last_actor_ip,
      last_actor_user_agent,
      last_actor_type,
      last_actor_device_id
    FROM trades
    WHERE user_id=${Number(sqliteUser.id)}${statusClause}
    ORDER BY id`,
  );

  log(`SQLite source: ${sqlitePath}`);
  log(`SQLite user id=${sqliteUser.id} email=${sqliteUser.email} username=${sqliteUser.username}`);
  log(`SQLite trades selected: ${sqliteTrades.length} (includeOpen=${INCLUDE_OPEN ? "yes" : "no"})`);

  if (!sqliteTrades.length) {
    log("Nothing to import.");
    return;
  }

  const tradeIds = sqliteTrades.map((t) => Number(t.id)).filter((id) => Number.isFinite(id));
  const distinctTradeIds = [...new Set(tradeIds)];
  if (distinctTradeIds.length !== tradeIds.length) {
    die("SQLite returned duplicate trade IDs; aborting.");
  }

  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();

  try {
    const pgInfo = await pg.query(
      "select current_database() as db, current_user as user",
    );
    log(`Postgres target: db=${pgInfo.rows[0]?.db} user=${pgInfo.rows[0]?.user}`);

    const pgUserRes = await pg.query(
      "select id,email,username,is_admin from users where lower(email)=lower($1) limit 1",
      [RECOVER_EMAIL.trim()],
    );
    const pgUser = pgUserRes.rows[0];
    if (!pgUser) {
      die(`No Postgres user found for ${RECOVER_EMAIL}. Import users first so IDs stay consistent.`);
    }

    if (Number(pgUser.id) !== Number(sqliteUser.id)) {
      die(
        `User ID mismatch: SQLite user id=${sqliteUser.id} but Postgres user id=${pgUser.id}. ` +
          "Import users with preserved IDs (fresh DB) before importing trades to avoid mis-attribution.",
      );
    }

    const symbolIds = [...new Set(sqliteTrades.map((t) => Number(t.symbol_id)).filter((n) => Number.isFinite(n)))];
    if (symbolIds.length) {
      const symRes = await pg.query("select id from symbol_configs where id = any($1::int[])", [symbolIds]);
      const found = new Set(symRes.rows.map((r) => Number(r.id)));
      const missing = symbolIds.filter((id) => !found.has(id));
      if (missing.length) {
        die(
          `Missing symbol_configs in Postgres for id(s): ${missing.join(", ")}. ` +
            "Import symbol_configs first so trade symbol_id references resolve.",
        );
      }
    }

    const tradeConflict = await pg.query("select id from trades where id = any($1::int[])", [distinctTradeIds]);
    if (tradeConflict.rowCount > 0) {
      const ids = tradeConflict.rows.map((r) => r.id).slice(0, 20);
      die(
        `Refusing to import: ${tradeConflict.rowCount} trade id(s) already exist in Postgres (e.g. ${ids.join(
          ", ",
        )}). Import into a fresh DB or remove conflicting trade rows first.`,
      );
    }

    const auditSql = `SELECT
      ${TRADE_AUDIT_COLUMNS.map((c) => c).join(", ")}
    FROM trade_audit
    WHERE trade_id IN (${distinctTradeIds.map((id) => String(id)).join(",")})
    ORDER BY id`;
    const sqliteAudit = sqliteJson(sqlitePath, auditSql);
    log(`SQLite trade_audit selected: ${sqliteAudit.length}`);

    if (!APPLY) {
      log("Dry run mode (no writes). Re-run with RECOVER_APPLY=1 to apply.");
      return;
    }

    await pg.query("begin");
    try {
      const tradesToInsert = sqliteTrades.map((t) => {
        const out: Record<string, any> = {};
        for (const c of TRADES_COLUMNS) out[c] = t[c];
        return out;
      });
      const auditToInsert = sqliteAudit.map((a) => {
        const out: Record<string, any> = {};
        for (const c of TRADE_AUDIT_COLUMNS) out[c] = a[c];
        return out;
      });

      const tradesInsert = await insertRows(pg, "trades", TRADES_COLUMNS, tradesToInsert);
      if (tradesInsert.skipped) {
        throw new Error(`Trade insert skipped ${tradesInsert.skipped} row(s) due to conflicts`);
      }
      log(`Inserted trades: ${tradesInsert.inserted}`);

      if (auditToInsert.length) {
        const auditConflict = await pg.query("select id from trade_audit where id = any($1::int[])", [
          auditToInsert.map((r) => Number(r.id)),
        ]);
        if (auditConflict.rowCount > 0) {
          const ids = auditConflict.rows.map((r) => r.id).slice(0, 20);
          throw new Error(
            `Refusing to import: ${auditConflict.rowCount} trade_audit id(s) already exist in Postgres (e.g. ${ids.join(
              ", ",
            )})`,
          );
        }

        const auditInsert = await insertRows(pg, "trade_audit", TRADE_AUDIT_COLUMNS, auditToInsert);
        if (auditInsert.skipped) {
          throw new Error(`Trade audit insert skipped ${auditInsert.skipped} row(s) due to conflicts`);
        }
        log(`Inserted trade_audit: ${auditInsert.inserted}`);
      }

      await pg.query(
        "select setval(pg_get_serial_sequence('public.trades','id'), greatest(coalesce((select max(id) from trades), 1), 1), true)",
      );
      await pg.query(
        "select setval(pg_get_serial_sequence('public.trade_audit','id'), greatest(coalesce((select max(id) from trade_audit), 1), 1), true)",
      );

      await pg.query("commit");
    } catch (err) {
      await pg.query("rollback");
      throw err;
    }

    const verify = await pg.query(
      "select status, count(*)::int as count from trades where user_id=$1 group by status order by status",
      [Number(sqliteUser.id)],
    );
    log(`Postgres user trade counts now: ${verify.rows.map((r) => `${r.status}:${r.count}`).join(" ") || "(none)"}`);
    log("Done.");
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  die(err instanceof Error ? err.message : String(err));
});
