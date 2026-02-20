import crypto from "crypto";
import { getValkey, valkeyIncrWithTtl } from "../services/valkey";

type LoginRateLimitScope = "IP" | "IP_EMAIL";

export type LoginRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number; scope: LoginRateLimitScope };

type LocalRateEntry = {
  count: number;
  resetAtMs: number;
};

const LOGIN_RATE_LIMIT_WINDOW_SEC = normalizePositiveInt(
  process.env.LOGIN_RATE_LIMIT_WINDOW_SEC,
  10 * 60,
  30,
  60 * 60,
);
const LOGIN_RATE_LIMIT_WINDOW_MS = LOGIN_RATE_LIMIT_WINDOW_SEC * 1000;
const LOGIN_RATE_LIMIT_IP_MAX = normalizePositiveInt(
  process.env.LOGIN_RATE_LIMIT_IP_MAX_ATTEMPTS,
  500,
  5,
  500,
);
const LOGIN_RATE_LIMIT_IP_EMAIL_MAX = normalizePositiveInt(
  process.env.LOGIN_RATE_LIMIT_IP_EMAIL_MAX_ATTEMPTS,
  30,
  3,
  100,
);

const localRateLimits = new Map<string, LocalRateEntry>();
const localRateLimitCleanupTimer = setInterval(() => {
  const nowMs = Date.now();
  for (const [key, entry] of localRateLimits.entries()) {
    if (!entry || entry.resetAtMs <= nowMs) {
      localRateLimits.delete(key);
    }
  }
}, Math.min(LOGIN_RATE_LIMIT_WINDOW_MS, 60 * 1000));
localRateLimitCleanupTimer.unref?.();

function normalizePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function normalizeIp(ip: string | null | undefined): string {
  const value = String(ip || "").trim().toLowerCase();
  return value || "unknown";
}

function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function consumeLocalLimit(key: string, limit: number): LoginRateLimitDecision {
  const nowMs = Date.now();
  const existing = localRateLimits.get(key);

  if (!existing || existing.resetAtMs <= nowMs) {
    localRateLimits.set(key, { count: 1, resetAtMs: nowMs + LOGIN_RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  existing.count += 1;
  if (existing.count <= limit) {
    return { allowed: true };
  }

  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
  return { allowed: false, retryAfterSec, scope: "IP" };
}

async function consumeLimit(
  key: string,
  limit: number,
  scope: LoginRateLimitScope,
): Promise<LoginRateLimitDecision> {
  const count = await valkeyIncrWithTtl(key, LOGIN_RATE_LIMIT_WINDOW_SEC);
  if (count != null) {
    if (count <= limit) return { allowed: true };

    let retryAfterSec = LOGIN_RATE_LIMIT_WINDOW_SEC;
    const valkey = getValkey();
    if (valkey) {
      try {
        const ttl = await valkey.ttl(key);
        if (ttl > 0) retryAfterSec = ttl;
      } catch {
        // keep default retryAfterSec
      }
    }
    return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec), scope };
  }

  const localDecision = consumeLocalLimit(key, limit);
  if (!localDecision.allowed) {
    return { allowed: false, retryAfterSec: localDecision.retryAfterSec, scope };
  }
  return { allowed: true };
}

export async function enforceLoginRateLimit(params: {
  ip: string | null | undefined;
  email: string;
}): Promise<LoginRateLimitDecision> {
  const ipNorm = normalizeIp(params.ip);
  const emailNorm = normalizeEmail(params.email);

  const ipKey = `auth:login:ip:${hashKey(ipNorm)}`;
  const ipDecision = await consumeLimit(ipKey, LOGIN_RATE_LIMIT_IP_MAX, "IP");
  if (!ipDecision.allowed) return ipDecision;

  const pairKey = `auth:login:pair:${hashKey(`${ipNorm}|${emailNorm}`)}`;
  const pairDecision = await consumeLimit(pairKey, LOGIN_RATE_LIMIT_IP_EMAIL_MAX, "IP_EMAIL");
  if (!pairDecision.allowed) return pairDecision;

  return { allowed: true };
}

export async function clearLoginRateLimit(params: {
  ip: string | null | undefined;
  email: string;
}): Promise<void> {
  const ipNorm = normalizeIp(params.ip);
  const emailNorm = normalizeEmail(params.email);
  const pairKey = `auth:login:pair:${hashKey(`${ipNorm}|${emailNorm}`)}`;

  localRateLimits.delete(pairKey);

  const valkey = getValkey();
  if (!valkey) return;
  try {
    await valkey.del(pairKey);
  } catch {
    // ignore cache clear errors
  }
}
