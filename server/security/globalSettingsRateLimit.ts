import { getValkey } from "../services/valkey";

const GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS = normalizeInt(
  process.env.ADMIN_GLOBAL_SETTINGS_MIN_INTERVAL_MS,
  500,
  100,
  30_000,
);

type LocalRateEntry = {
  resetAtMs: number;
};

const localRateLimitByAdminId = new Map<number, LocalRateEntry>();
const localCleanupTimer = setInterval(() => {
  const nowMs = Date.now();
  for (const [adminId, entry] of localRateLimitByAdminId.entries()) {
    if (!entry || entry.resetAtMs <= nowMs) {
      localRateLimitByAdminId.delete(adminId);
    }
  }
}, Math.min(60_000, GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS));
localCleanupTimer.unref?.();

function normalizeInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function consumeLocal(adminId: number): { allowed: boolean; retryAfterSec: number } {
  const nowMs = Date.now();
  const current = localRateLimitByAdminId.get(adminId);

  if (!current || current.resetAtMs <= nowMs) {
    localRateLimitByAdminId.set(adminId, {
      resetAtMs: nowMs + GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS,
    });
    return {
      allowed: true,
      retryAfterSec: Math.max(1, Math.ceil(GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS / 1000)),
    };
  }

  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000)),
  };
}

export async function consumeGlobalSettingsUpdateRateLimit(
  adminId: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!Number.isFinite(adminId) || adminId <= 0) {
    return { allowed: true, retryAfterSec: 1 };
  }

  const key = `admin:global-settings:update:${Math.trunc(adminId)}`;
  const valkey = getValkey();

  if (valkey) {
    try {
      const setResult = await valkey.set(
        key,
        String(Date.now()),
        "PX",
        GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS,
        "NX",
      );

      if (setResult === "OK") {
        return {
          allowed: true,
          retryAfterSec: Math.max(1, Math.ceil(GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS / 1000)),
        };
      }

      const pttlMs = await valkey.pttl(key);
      const retryAfterMs = pttlMs > 0 ? pttlMs : GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    } catch {
      // Fall through to local limiter if cache is unavailable.
    }
  }

  return consumeLocal(Math.trunc(adminId));
}
