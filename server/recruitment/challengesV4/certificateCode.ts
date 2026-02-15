import crypto from "crypto";

export type CertificateVerificationBundle = {
  nonce: string;
  keyId: string;
  publicCode: string;
  hmac: string;
};

function sanitizeKeyId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "v1";
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 32)
    .toLowerCase();
  return cleaned || "v1";
}

function resolveBaseSecret(): string {
  const challengeSecret = String(process.env.CHALLENGE_CERT_VERIFICATION_SECRET || "").trim();
  if (challengeSecret.length >= 16) return challengeSecret;

  const legalSecret = String(process.env.LEGAL_TERMS_HMAC_SECRET || "").trim();
  if (legalSecret.length >= 16) return legalSecret;

  const sessionSecret = String(process.env.SESSION_SECRET || "").trim();
  if (sessionSecret.length >= 16) return sessionSecret;

  return "tradequip-dev-challenge-cert-secret";
}

function deriveScopedSecret(keyId: string): Buffer {
  const material = `${resolveBaseSecret()}|challenge-cert|${sanitizeKeyId(keyId)}`;
  return crypto.createHash("sha256").update(material, "utf8").digest();
}

function buildPublicCodeFromNonce(nonce: string, keyId: string): string {
  const digest = crypto
    .createHmac("sha256", deriveScopedSecret(keyId))
    .update(`public:${nonce}`, "utf8")
    .digest("hex")
    .toUpperCase();
  return `CHC-${sanitizeKeyId(keyId).toUpperCase()}-${digest.slice(0, 24)}`;
}

export function computeVerificationCodeHmac(publicCode: string, keyId: string): string {
  return crypto
    .createHmac("sha256", deriveScopedSecret(keyId))
    .update(`verify:${String(publicCode).trim().toUpperCase()}`, "utf8")
    .digest("hex");
}

export function generateCertificateVerificationBundle(keyIdRaw: string): CertificateVerificationBundle {
  const keyId = sanitizeKeyId(keyIdRaw);
  const nonce = crypto.randomBytes(16).toString("hex");
  const publicCode = buildPublicCodeFromNonce(nonce, keyId);
  const hmac = computeVerificationCodeHmac(publicCode, keyId);
  return { nonce, keyId, publicCode, hmac };
}

export function deriveCertificatePublicCode(args: {
  verificationCodeNonce?: string | null;
  verificationHmacKeyId?: string | null;
  verificationCodeHmac: string;
}): string {
  const nonce = String(args.verificationCodeNonce ?? "").trim();
  const keyId = sanitizeKeyId(args.verificationHmacKeyId);
  if (!nonce) return String(args.verificationCodeHmac ?? "");
  return buildPublicCodeFromNonce(nonce, keyId);
}

export function parseVerificationCodeKeyId(codeRaw: string): string | null {
  const code = String(codeRaw || "").trim().toUpperCase();
  const match = /^CHC-([A-Z0-9._-]{1,32})-[A-F0-9]{8,64}$/.exec(code);
  if (!match) return null;
  return sanitizeKeyId(match[1]);
}
