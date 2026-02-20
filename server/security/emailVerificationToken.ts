import crypto from "crypto";

const MIN_EMAIL_VERIFY_SECRET_LEN = 32;

function getEmailVerifyTokenSecret(): string {
  const secret = String(process.env.EMAIL_VERIFY_TOKEN_SECRET ?? "").trim();
  if (!secret) {
    throw new Error("EMAIL_VERIFY_TOKEN_SECRET_MISSING");
  }
  if (secret.length < MIN_EMAIL_VERIFY_SECRET_LEN) {
    throw new Error("EMAIL_VERIFY_TOKEN_SECRET_TOO_SHORT");
  }
  return secret;
}

export function hashEmailVerificationToken(rawToken: string): string {
  return crypto.createHmac("sha256", getEmailVerifyTokenSecret()).update(rawToken).digest("hex");
}

