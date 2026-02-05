import crypto from 'crypto';

let cachedSecret: string | null = null;

function requireSecret(): string {
  if (cachedSecret) return cachedSecret;
  
  const s = process.env.LEGAL_TERMS_HMAC_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "CRITICAL: LEGAL_TERMS_HMAC_SECRET environment variable is missing or too short (min 32 chars). " +
      "This secret is required for tamper-evident legal token signing. " +
      "Generate with: openssl rand -hex 32"
    );
  }
  cachedSecret = s;
  return s;
}

export function validateSecretAtStartup(): void {
  requireSecret();
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function base64UrlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function base64UrlDecode(str: string): string {
  const padLen = (4 - (str.length % 4)) % 4;
  const padded = str + "=".repeat(padLen);
  const b64 = padded.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function hmacSign(data: string, secret?: string): string {
  const s = secret ?? requireSecret();
  return crypto.createHmac('sha256', s).update(data).digest('hex');
}

export function hmacVerify(data: string, signature: string, secret?: string): boolean {
  const s = secret ?? requireSecret();
  const expected = hmacSign(data, s);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function generateTermsToken(params: {
  docId: number;
  docVersion: string;
  contentHash: string;
  userId: number;
  timestamp: number;
}): string {
  const payload = `${params.docId}:${params.docVersion}:${params.contentHash}:${params.userId}:${params.timestamp}`;
  const signature = hmacSign(payload);
  return `${payload}.${signature}`;
}

export function verifyTermsToken(token: string): {
  valid: boolean;
  docId?: number;
  docVersion?: string;
  contentHash?: string;
  userId?: number;
  timestamp?: number;
} {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return { valid: false };
    
    if (!hmacVerify(payload, signature)) return { valid: false };
    
    const [docId, docVersion, contentHash, userId, timestamp] = payload.split(':');
    return {
      valid: true,
      docId: parseInt(docId, 10),
      docVersion,
      contentHash,
      userId: parseInt(userId, 10),
      timestamp: parseInt(timestamp, 10),
    };
  } catch {
    return { valid: false };
  }
}

export function computeRecordHash(params: {
  userId: number;
  docId: number;
  docVersion: string;
  docContentHash: string;
  acceptedAt: number;
  prevHash: string | null;
}): string {
  const data = stableStringify({
    userId: params.userId,
    docId: params.docId,
    docVersion: params.docVersion,
    docContentHash: params.docContentHash,
    acceptedAt: params.acceptedAt,
    prevHash: params.prevHash || 'GENESIS',
  });
  return sha256(data);
}

export type Doc1TermsTokenPayload = {
  v: 1;
  ts: number;
  countryIso2: string;
  regionKey: string | null;

  global: { id: number; version: string; sha256: string };
  addendum: { id: number; version: string; sha256: string } | null;

  combinedSha256: string;
};

export function generateDoc1TermsToken(payload: Doc1TermsTokenPayload): string {
  const payloadJson = stableStringify(payload);
  const payloadB64 = base64UrlEncode(payloadJson);
  const sigHex = hmacSha256Hex(requireSecret(), payloadB64);
  return `${payloadB64}.${sigHex}`;
}

export function verifyDoc1TermsToken(
  token: string,
  opts?: { expectedCountryIso2?: string; maxAgeMs?: number },
): { ok: true; payload: Doc1TermsTokenPayload } | { ok: false; error: string } {
  if (!token || typeof token !== "string") return { ok: false, error: "TOKEN_MISSING" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "TOKEN_FORMAT_INVALID" };

  const [payloadB64, sigHex] = parts;
  if (!payloadB64 || !sigHex) return { ok: false, error: "TOKEN_FORMAT_INVALID" };

  const expected = hmacSha256Hex(requireSecret(), payloadB64);
  if (!timingSafeEqualHex(expected, sigHex)) return { ok: false, error: "TOKEN_SIGNATURE_INVALID" };

  let payload: any;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { ok: false, error: "TOKEN_PAYLOAD_INVALID" };
  }

  if (payload?.v !== 1) return { ok: false, error: "TOKEN_VERSION_UNSUPPORTED" };
  if (!payload?.countryIso2) return { ok: false, error: "TOKEN_COUNTRY_MISSING" };
  if (!payload?.combinedSha256) return { ok: false, error: "TOKEN_COMBINED_SHA_MISSING" };
  if (!payload?.ts || typeof payload.ts !== "number") return { ok: false, error: "TOKEN_TS_INVALID" };

  if (opts?.expectedCountryIso2 && payload.countryIso2 !== opts.expectedCountryIso2) {
    return { ok: false, error: "TOKEN_COUNTRY_MISMATCH" };
  }

  if (opts?.maxAgeMs) {
    const now = Date.now();
    // Backward-compat + robustness:
    // - tolerate small clock skew (NTP adjustments can move time slightly backwards)
    // - accept legacy seconds-based timestamps by normalizing to ms when the value is too small
    const ts = typeof payload.ts === "number" ? payload.ts : Number(payload.ts);
    if (!Number.isFinite(ts) || ts <= 0) return { ok: false, error: "TOKEN_TS_INVALID" };

    // Heuristic: anything < 10^11 is very likely epoch seconds (or an invalid ms timestamp).
    const normalizedTs = ts < 100_000_000_000 ? ts * 1000 : ts;

    const age = now - normalizedTs;
    const CLOCK_SKEW_MS = 5 * 60 * 1000;

    if (age < -CLOCK_SKEW_MS || age > opts.maxAgeMs + CLOCK_SKEW_MS) return { ok: false, error: "TOKEN_EXPIRED" };
  }

  return { ok: true, payload: payload as Doc1TermsTokenPayload };
}

export { requireSecret };
