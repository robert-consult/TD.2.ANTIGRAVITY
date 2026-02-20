import crypto from "crypto";

const MIN_SMS_OTP_SECRET_LENGTH = 32;

function resolveSmsOtpSecret(): string {
  const secret = String(process.env.SMS_OTP_SECRET || process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (secret.length < MIN_SMS_OTP_SECRET_LENGTH) {
    throw new Error("SMS_OTP_SECRET_MISSING");
  }
  return secret;
}

export function hashSmsOtpCode(code: string): string {
  return crypto.createHmac("sha256", resolveSmsOtpSecret()).update(code).digest("hex");
}

export function timingSafeHashEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(String(leftHex || ""), "hex");
  const right = Buffer.from(String(rightHex || ""), "hex");
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

