import crypto from "crypto";

function requirePartnerAnonSecret(): string {
  const explicit = String(process.env.PARTNER_ANON_SALT || "").trim();
  if (explicit.length >= 16) return explicit;

  const legal = String(process.env.LEGAL_TERMS_HMAC_SECRET || "").trim();
  if (legal.length >= 16) return legal;

  const session = String(process.env.SESSION_SECRET || "").trim();
  if (session.length >= 16) return session;

  // Non-prod fallback only to keep local development usable.
  if (process.env.NODE_ENV !== "production") {
    return "partner-anon-dev-secret-change-me";
  }
  throw new Error("PARTNER_ANON_SALT missing (or fallback secrets unavailable)");
}

export function anonymizeUserId(userId: number): string {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("INVALID_USER_ID");
  }
  const secret = requirePartnerAnonSecret();
  const digest = crypto.createHmac("sha256", secret).update(String(id), "utf8").digest("hex");
  return `User-${digest.slice(0, 8).toUpperCase()}`;
}

export function resolveUserIdFromHash(hashId: string, candidateUserIds: number[]): number | null {
  const target = String(hashId || "").trim();
  if (!target) return null;
  for (const id of candidateUserIds) {
    try {
      if (anonymizeUserId(id) === target) return id;
    } catch {
      // skip invalid ids
    }
  }
  return null;
}
