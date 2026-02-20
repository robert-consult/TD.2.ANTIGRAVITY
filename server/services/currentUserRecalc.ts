import { recalcAccount } from "../recalcAccount";

const CURRENT_USER_RECALC_MIN_INTERVAL_MS = (() => {
  const raw = Number(process.env.CURRENT_USER_RECALC_MIN_INTERVAL_MS ?? 30_000);
  if (!Number.isFinite(raw)) return 30_000;
  return Math.max(5_000, Math.min(5 * 60_000, Math.trunc(raw)));
})();

const CURRENT_USER_RECALC_STALE_TTL_MS = Math.max(CURRENT_USER_RECALC_MIN_INTERVAL_MS * 4, 10 * 60_000);
const CURRENT_USER_RECALC_STATE = new Map<
  number,
  {
    lastRunAtMs: number;
    inFlight: Promise<void> | null;
    touchedAtMs: number;
  }
>();

const currentUserRecalcCleanupTimer = setInterval(() => {
  const nowMs = Date.now();
  for (const [userId, state] of CURRENT_USER_RECALC_STATE.entries()) {
    if (!state) {
      CURRENT_USER_RECALC_STATE.delete(userId);
      continue;
    }
    if (!state.inFlight && nowMs - state.touchedAtMs > CURRENT_USER_RECALC_STALE_TTL_MS) {
      CURRENT_USER_RECALC_STATE.delete(userId);
    }
  }
}, Math.min(CURRENT_USER_RECALC_STALE_TTL_MS, 60_000));
currentUserRecalcCleanupTimer.unref?.();

export async function maybeRecalcAccountForCurrentUser(userId: number): Promise<void> {
  const nowMs = Date.now();
  const existing = CURRENT_USER_RECALC_STATE.get(userId);

  if (existing?.inFlight) {
    existing.touchedAtMs = nowMs;
    await existing.inFlight;
    return;
  }

  if (existing && nowMs - existing.lastRunAtMs < CURRENT_USER_RECALC_MIN_INTERVAL_MS) {
    existing.touchedAtMs = nowMs;
    return;
  }

  const inFlight = (async () => {
    await recalcAccount(userId);
  })();

  CURRENT_USER_RECALC_STATE.set(userId, {
    lastRunAtMs: existing?.lastRunAtMs ?? 0,
    inFlight,
    touchedAtMs: nowMs,
  });

  try {
    await inFlight;
    CURRENT_USER_RECALC_STATE.set(userId, {
      lastRunAtMs: Date.now(),
      inFlight: null,
      touchedAtMs: Date.now(),
    });
  } catch (error) {
    CURRENT_USER_RECALC_STATE.set(userId, {
      lastRunAtMs: existing?.lastRunAtMs ?? 0,
      inFlight: null,
      touchedAtMs: Date.now(),
    });
    throw error;
  }
}
