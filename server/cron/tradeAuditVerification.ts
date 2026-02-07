import { db } from "@db";
import { tradeAudit, trades } from "@shared/schema";
import { asc, gt } from "drizzle-orm";
import { verifyTradeAuditChain } from "../lib/auditWriter";

let started = false;
let running = false;
let auditCursorId = 0;
let sweepTradeCursor = 0;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[TradeAuditVerify] Invalid ${name}=${raw}; using ${fallback}`);
    return fallback;
  }
  return Math.floor(parsed);
}

const ENABLED = String(process.env.TRADE_AUDIT_VERIFY_ENABLED ?? "1") !== "0";
const FAIL_FAST = String(process.env.TRADE_AUDIT_VERIFY_FAIL_FAST ?? "0") === "1";
const INTERVAL_MINUTES = parsePositiveIntEnv("TRADE_AUDIT_VERIFY_INTERVAL_MINUTES", 60);
const START_DELAY_SECONDS = parsePositiveIntEnv("TRADE_AUDIT_VERIFY_START_DELAY_SECONDS", 180);
const INCREMENTAL_ROW_BATCH = parsePositiveIntEnv("TRADE_AUDIT_VERIFY_INCREMENTAL_ROW_BATCH", 1000);
const SWEEP_BATCH_TRADES = parsePositiveIntEnv("TRADE_AUDIT_VERIFY_SWEEP_BATCH_TRADES", 50);

async function fetchIncrementalTradeIds(): Promise<{ tradeIds: number[]; nextCursorId: number }> {
  const rows = await db
    .select({
      id: tradeAudit.id,
      tradeId: tradeAudit.tradeId,
    })
    .from(tradeAudit)
    .where(gt(tradeAudit.id, auditCursorId))
    .orderBy(asc(tradeAudit.id))
    .limit(INCREMENTAL_ROW_BATCH);

  if (!rows.length) {
    return { tradeIds: [], nextCursorId: auditCursorId };
  }

  const tradeIds = Array.from(new Set(rows.map((r) => Number(r.tradeId)).filter((id) => Number.isInteger(id) && id > 0)));
  const nextCursorId = Number(rows[rows.length - 1]?.id ?? auditCursorId);
  return { tradeIds, nextCursorId };
}

async function fetchSweepTradeIds(): Promise<number[]> {
  const fetchFromCursor = async (cursor: number) =>
    db
      .select({ id: trades.id })
      .from(trades)
      .where(gt(trades.id, cursor))
      .orderBy(asc(trades.id))
      .limit(SWEEP_BATCH_TRADES);

  let rows = await fetchFromCursor(sweepTradeCursor);
  if (!rows.length && sweepTradeCursor > 0) {
    sweepTradeCursor = 0;
    rows = await fetchFromCursor(0);
  }

  if (!rows.length) return [];

  sweepTradeCursor = Number(rows[rows.length - 1]?.id ?? sweepTradeCursor);
  return rows.map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0);
}

export async function runTradeAuditVerificationPass(): Promise<void> {
  if (!ENABLED) return;
  if (running) {
    console.warn("[TradeAuditVerify] Previous pass still running; skipping overlap.");
    return;
  }

  running = true;
  const startedAt = Date.now();
  try {
    const { tradeIds: incrementalTradeIds, nextCursorId } = await fetchIncrementalTradeIds();
    const sweepTradeIds = await fetchSweepTradeIds();

    const tradeIds = Array.from(new Set([...incrementalTradeIds, ...sweepTradeIds]));
    if (!tradeIds.length) {
      console.log("[TradeAuditVerify] No trade IDs available for verification.");
      return;
    }

    const verification = await verifyTradeAuditChain(tradeIds);
    auditCursorId = nextCursorId;

    const tookMs = Date.now() - startedAt;
    if (verification.valid) {
      console.log(
        `[TradeAuditVerify] PASS verified=${tradeIds.length} incremental=${incrementalTradeIds.length} sweep=${sweepTradeIds.length} took=${tookMs}ms`,
      );
      return;
    }

    console.error(
      `[TradeAuditVerify] FAIL verified=${tradeIds.length} errors=${verification.errors.length} took=${tookMs}ms`,
    );
    for (const err of verification.errors.slice(0, 10)) {
      console.error(`[TradeAuditVerify] ${err}`);
    }

    if (FAIL_FAST) {
      console.error("[TradeAuditVerify] Failing fast due to detected audit-chain mismatch.");
      process.exit(1);
    }
  } catch (err) {
    console.error("[TradeAuditVerify] Verification pass failed:", err);
  } finally {
    running = false;
  }
}

export function startTradeAuditVerificationCron(): void {
  if (started) return;
  started = true;

  if (!ENABLED) {
    console.log("[TradeAuditVerify] Disabled via TRADE_AUDIT_VERIFY_ENABLED=0");
    return;
  }

  const intervalMs = INTERVAL_MINUTES * 60 * 1000;
  const startDelayMs = START_DELAY_SECONDS * 1000;

  console.log(
    `[TradeAuditVerify] Starting cron (every ${INTERVAL_MINUTES}m, delay ${START_DELAY_SECONDS}s, incremental_batch=${INCREMENTAL_ROW_BATCH}, sweep_batch=${SWEEP_BATCH_TRADES})`,
  );

  setTimeout(() => {
    void runTradeAuditVerificationPass();
  }, startDelayMs);

  intervalHandle = setInterval(() => {
    void runTradeAuditVerificationPass();
  }, intervalMs);
}

export function stopTradeAuditVerificationCron(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
}
