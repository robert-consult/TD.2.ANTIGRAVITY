export const E2EE_ENVELOPE_VERSION = 1;
export const E2EE_KEY_ALGO_RSA_OAEP_256_V1 = "RSA_OAEP_256_V1";
export const E2EE_DATA_ALGO_AES_256_GCM = "AES_256_GCM";

export const MAX_E2EE_ENVELOPE_BYTES = 1_500_000;
export const E2EE_ENVELOPE_MAX_CREATED_AT_FUTURE_SKEW_SEC = 10 * 60;
export const E2EE_ENCRYPTED_KEY_BASE64_MIN_LEN = 128;
export const E2EE_ENCRYPTED_KEY_BASE64_MAX_LEN = 8192;
export const E2EE_IV_BASE64_MIN_LEN = 16;
export const E2EE_IV_BASE64_MAX_LEN = 128;
export const E2EE_TAG_BASE64_MIN_LEN = 16;
export const E2EE_TAG_BASE64_MAX_LEN = 128;
export const E2EE_CIPHERTEXT_BASE64_MIN_LEN = 4;
export const E2EE_CIPHERTEXT_BASE64_MAX_LEN = 1_400_000;

const BASE64_FIELD_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function normalizeHexSha256(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : null;
}

export function normalizeBase64Field(value: unknown, minLen: number, maxLen: number): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length < minLen || text.length > maxLen) return null;
  if (text.length % 4 !== 0) return null;
  if (!BASE64_FIELD_PATTERN.test(text)) return null;
  return text;
}

function utf8Length(text: string): number {
  if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
    return Buffer.byteLength(text, "utf8");
  }
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).byteLength;
  }
  return text.length;
}

function dedupePositiveIntIds(values: number[]): number[] {
  const set = new Set<number>();
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) continue;
    set.add(n);
  }
  return Array.from(set.values());
}

export function parseAndValidateE2eeEnvelope(
  rawEnvelope: string,
  recipientUserIds: number[],
  nowSec: number,
): string {
  const trimmed = String(rawEnvelope ?? "").trim();
  if (!trimmed) throw new Error("E2EE_ENVELOPE_REQUIRED");
  if (utf8Length(trimmed) > MAX_E2EE_ENVELOPE_BYTES) {
    throw new Error("E2EE_ENVELOPE_TOO_LARGE");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("E2EE_ENVELOPE_INVALID");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("E2EE_ENVELOPE_INVALID");
  const recipients = parsed.recipients;
  if (!recipients || typeof recipients !== "object") throw new Error("E2EE_ENVELOPE_RECIPIENTS_INVALID");
  if (Array.isArray(recipients)) throw new Error("E2EE_ENVELOPE_RECIPIENTS_INVALID");

  const version = Number(parsed.version);
  if (!Number.isInteger(version) || version !== E2EE_ENVELOPE_VERSION) {
    throw new Error("E2EE_ENVELOPE_VERSION_INVALID");
  }

  const keyAlgorithm = String(parsed.keyAlgorithm ?? "").trim().toUpperCase();
  if (keyAlgorithm !== E2EE_KEY_ALGO_RSA_OAEP_256_V1) {
    throw new Error("E2EE_ENVELOPE_KEY_ALGO_INVALID");
  }

  const dataAlgorithm = String(parsed.dataAlgorithm ?? "").trim().toUpperCase();
  if (dataAlgorithm !== E2EE_DATA_ALGO_AES_256_GCM) {
    throw new Error("E2EE_ENVELOPE_DATA_ALGO_INVALID");
  }

  const createdAt = Number(parsed.createdAt);
  if (!Number.isInteger(createdAt) || createdAt <= 0) {
    throw new Error("E2EE_ENVELOPE_CREATED_AT_INVALID");
  }
  const maxAllowedCreatedAt = nowSec + E2EE_ENVELOPE_MAX_CREATED_AT_FUTURE_SKEW_SEC;
  if (createdAt > maxAllowedCreatedAt) {
    throw new Error("E2EE_ENVELOPE_CREATED_AT_INVALID");
  }

  const iv = normalizeBase64Field(parsed.iv, E2EE_IV_BASE64_MIN_LEN, E2EE_IV_BASE64_MAX_LEN);
  if (!iv) throw new Error("E2EE_ENVELOPE_IV_INVALID");
  const tag = normalizeBase64Field(parsed.tag, E2EE_TAG_BASE64_MIN_LEN, E2EE_TAG_BASE64_MAX_LEN);
  if (!tag) throw new Error("E2EE_ENVELOPE_TAG_INVALID");
  const ciphertext = normalizeBase64Field(
    parsed.ciphertext,
    E2EE_CIPHERTEXT_BASE64_MIN_LEN,
    E2EE_CIPHERTEXT_BASE64_MAX_LEN,
  );
  if (!ciphertext) throw new Error("E2EE_ENVELOPE_CIPHERTEXT_INVALID");

  const expectedRecipientIds = dedupePositiveIntIds(recipientUserIds || []);
  if (!expectedRecipientIds.length) throw new Error("E2EE_ENVELOPE_RECIPIENTS_INVALID");
  const expectedRecipientIdSet = new Set(expectedRecipientIds.map((id) => String(id)));

  const recipientKeys = Object.keys(recipients as Record<string, unknown>);
  if (!recipientKeys.length) throw new Error("E2EE_ENVELOPE_RECIPIENTS_INVALID");
  if (recipientKeys.length !== expectedRecipientIds.length) {
    throw new Error("E2EE_ENVELOPE_RECIPIENT_COUNT_INVALID");
  }
  for (const recipientIdText of recipientKeys) {
    if (!/^\d+$/.test(recipientIdText)) {
      throw new Error("E2EE_ENVELOPE_RECIPIENT_EXTRA");
    }
    if (!expectedRecipientIdSet.has(recipientIdText)) {
      throw new Error("E2EE_ENVELOPE_RECIPIENT_EXTRA");
    }
  }

  const normalizedRecipients: Record<string, { keyAlgorithm: string; encryptedKey: string }> = {};
  for (const recipientId of [...expectedRecipientIds].sort((a, b) => a - b)) {
    const recipientIdText = String(recipientId);
    const recipientEntry = (recipients as Record<string, unknown>)[recipientIdText];
    if (!recipientEntry || typeof recipientEntry !== "object" || Array.isArray(recipientEntry)) {
      throw new Error("E2EE_ENVELOPE_RECIPIENT_INVALID");
    }

    const recipientKeyAlgorithm = String((recipientEntry as any).keyAlgorithm ?? "")
      .trim()
      .toUpperCase();
    if (recipientKeyAlgorithm !== E2EE_KEY_ALGO_RSA_OAEP_256_V1) {
      throw new Error("E2EE_ENVELOPE_RECIPIENT_KEY_ALGO_INVALID");
    }

    const encryptedKey = normalizeBase64Field(
      (recipientEntry as any).encryptedKey,
      E2EE_ENCRYPTED_KEY_BASE64_MIN_LEN,
      E2EE_ENCRYPTED_KEY_BASE64_MAX_LEN,
    );
    if (!encryptedKey) throw new Error("E2EE_ENVELOPE_RECIPIENT_KEY_INVALID");

    normalizedRecipients[recipientIdText] = {
      keyAlgorithm: E2EE_KEY_ALGO_RSA_OAEP_256_V1,
      encryptedKey,
    };
  }

  for (const recipientId of expectedRecipientIds) {
    if (!Object.prototype.hasOwnProperty.call(normalizedRecipients, String(recipientId))) {
      throw new Error("E2EE_ENVELOPE_RECIPIENT_MISSING");
    }
  }

  return JSON.stringify({
    version: E2EE_ENVELOPE_VERSION,
    keyAlgorithm: E2EE_KEY_ALGO_RSA_OAEP_256_V1,
    dataAlgorithm: E2EE_DATA_ALGO_AES_256_GCM,
    recipients: normalizedRecipients,
    iv,
    tag,
    ciphertext,
    createdAt,
  });
}
