import { runCalcScoutMetricsPass } from "../scout/calcScoutMetrics";

let started = false;
let running = false;
let handle: ReturnType<typeof setInterval> | null = null;

function parsePositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

const ENABLED = String(process.env.SCOUT_METRICS_ENABLED ?? "1") !== "0";
const INTERVAL_HOURS = parsePositiveInt("SCOUT_METRICS_INTERVAL_HOURS", 24);
const START_DELAY_SEC = parsePositiveInt("SCOUT_METRICS_START_DELAY_SEC", 180);
const WINDOW_DAYS = parsePositiveInt("SCOUT_METRICS_WINDOW_DAYS", 90);
const MIN_TRADES = parsePositiveInt("SCOUT_METRICS_MIN_TRADES", 20);
const MAX_USERS = parsePositiveInt("SCOUT_METRICS_MAX_USERS", 1000);

export async function runScoutMetricsPassNow() {
  if (!ENABLED) return;
  if (running) return;
  running = true;
  try {
    const out = await runCalcScoutMetricsPass({
      windowDays: WINDOW_DAYS,
      minTrades: MIN_TRADES,
      maxUsers: MAX_USERS,
    });
    console.log(
      `[ScoutMetrics] PASS processed=${out.processed} windowDays=${WINDOW_DAYS} minTrades=${MIN_TRADES} maxUsers=${MAX_USERS} at=${new Date(out.updatedAt * 1000).toISOString()}`,
    );
  } catch (error) {
    console.error("[ScoutMetrics] PASS failed:", error);
  } finally {
    running = false;
  }
}

export function startScoutMetricsCron() {
  if (started) return;
  started = true;
  if (!ENABLED) {
    console.log("[ScoutMetrics] Disabled via SCOUT_METRICS_ENABLED=0");
    return;
  }

  const intervalMs = INTERVAL_HOURS * 3600 * 1000;
  console.log(`[ScoutMetrics] Starting scheduler: every ${INTERVAL_HOURS}h (delay ${START_DELAY_SEC}s)`);

  setTimeout(() => {
    void runScoutMetricsPassNow();
  }, START_DELAY_SEC * 1000);

  handle = setInterval(() => {
    void runScoutMetricsPassNow();
  }, intervalMs);
  (handle as any)?.unref?.();
}

export function stopScoutMetricsCron() {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  started = false;
}
