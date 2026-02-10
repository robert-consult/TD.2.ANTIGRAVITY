import { syncPartnerAllocationsPass } from "../recruitment/engines";

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

const ENABLED = String(process.env.PARTNER_ALLOC_SYNC_ENABLED ?? "1") !== "0";
const INTERVAL_MINUTES = parsePositiveInt("PARTNER_ALLOC_SYNC_INTERVAL_MINUTES", 60);
const START_DELAY_SEC = parsePositiveInt("PARTNER_ALLOC_SYNC_START_DELAY_SEC", 150);
const MAX_ROWS = parsePositiveInt("PARTNER_ALLOC_SYNC_MAX_ROWS", 500);

export async function runPartnerAllocationSyncPassNow() {
  if (!ENABLED || running) return;
  running = true;
  try {
    const out = await syncPartnerAllocationsPass({ maxRows: MAX_ROWS });
    console.log(`[PartnerAllocSync] PASS processed=${out.processed} stopped=${out.stopped} maxRows=${MAX_ROWS}`);
  } catch (error) {
    console.error("[PartnerAllocSync] PASS failed:", error);
  } finally {
    running = false;
  }
}

export function startPartnerAllocationSyncCron() {
  if (started) return;
  started = true;
  if (!ENABLED) {
    console.log("[PartnerAllocSync] Disabled via PARTNER_ALLOC_SYNC_ENABLED=0");
    return;
  }

  console.log(
    `[PartnerAllocSync] Starting scheduler every ${INTERVAL_MINUTES}m (delay ${START_DELAY_SEC}s)`,
  );
  setTimeout(() => {
    void runPartnerAllocationSyncPassNow();
  }, START_DELAY_SEC * 1000);

  handle = setInterval(() => {
    void runPartnerAllocationSyncPassNow();
  }, INTERVAL_MINUTES * 60 * 1000);
  (handle as any)?.unref?.();
}

export function stopPartnerAllocationSyncCron() {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  started = false;
}
