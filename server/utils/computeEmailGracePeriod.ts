import { toUnixMs } from "../lib/priceUtils";

const EMAIL_VERIFICATION_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

export function computeEmailGracePeriod(createdAt: unknown, emailVerified: boolean): {
  inGracePeriod: boolean;
  gracePeriodEndsAt: number | null;
} {
  const nowMs = Date.now();
  const createdAtMs = toUnixMs(createdAt, nowMs);
  const gracePeriodEndsAt = createdAtMs + EMAIL_VERIFICATION_GRACE_PERIOD_MS;
  const inGracePeriod = !emailVerified && nowMs < gracePeriodEndsAt;
  return {
    inGracePeriod,
    gracePeriodEndsAt: inGracePeriod ? gracePeriodEndsAt : null,
  };
}
