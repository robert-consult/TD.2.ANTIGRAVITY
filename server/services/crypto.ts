import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function parseEncryptionKeyHex(value: unknown): Buffer | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) return null;
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) return null;
  return buf;
}

function getEncryptionKey(): Buffer {
  const parsed = parseEncryptionKeyHex(process.env.ENCRYPTION_KEY);
  if (parsed) return parsed;

  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY must be configured as exactly 64 hex characters in production");
  }

  if (process.env.ENCRYPTION_KEY) {
    console.warn("[CRYPTO] ENCRYPTION_KEY is invalid. Falling back to development key.");
  } else {
    console.warn("[CRYPTO] Using development encryption key - NOT for production!");
  }
  return crypto.scryptSync("dev-only-key-tradequip-" + (process.env.REPL_SLUG || "local"), "salt-dev", 32);
}

export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function randomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("hex");
}

export function encryptString(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

export function decryptString(ciphertext: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(ciphertext, "base64");
  
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  
  return decrypted.toString("utf8");
}
