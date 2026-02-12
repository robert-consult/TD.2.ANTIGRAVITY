import {
  E2EE_DATA_ALGO_AES_256_GCM,
  E2EE_KEY_ALGO_RSA_OAEP_256_V1,
} from "@shared/e2ee/envelope";

const E2EE_KEY_ALGO = E2EE_KEY_ALGO_RSA_OAEP_256_V1;
const STORAGE_PREFIX = "tq.mailbox.e2ee.v1";

type RecipientKey = {
  userId: number;
  publicKeyPem: string;
  keyAlgorithm?: string | null;
};

export type MailboxLocalE2eeKeyMaterial = {
  userId: number;
  publicKeyPem: string;
  keyAlgorithm: string;
  fingerprint: string;
  privateKeyJwk: JsonWebKey;
  updatedAt: number;
};

function storageKey(userId: number): string {
  return `${STORAGE_PREFIX}.${userId}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  const buffer = bytes.buffer;
  if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer;
  }
  return bytes.slice().buffer;
}

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return fromBase64(base64);
}

function bytesToPem(bytes: Uint8Array): string {
  const b64 = toBase64(bytes);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  const keyBytes = pemToBytes(publicKeyPem);
  return crypto.subtle.importKey(
    "spki",
    toBufferSource(keyBytes),
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"],
  );
}

async function importPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["decrypt"],
  );
}

function parseStoredKey(userId: number): MailboxLocalE2eeKeyMaterial | null {
  const raw = localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MailboxLocalE2eeKeyMaterial;
    if (!parsed || parsed.userId !== userId) return null;
    if (!parsed.publicKeyPem || !parsed.privateKeyJwk || !parsed.fingerprint) return null;
    return {
      ...parsed,
      keyAlgorithm: parsed.keyAlgorithm || E2EE_KEY_ALGO,
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

export function getStoredMailboxE2eeKey(userId: number): MailboxLocalE2eeKeyMaterial | null {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return parseStoredKey(userId);
}

export function clearStoredMailboxE2eeKey(userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) return;
  localStorage.removeItem(storageKey(userId));
}

function persistMailboxE2eeKey(material: MailboxLocalE2eeKeyMaterial): void {
  localStorage.setItem(storageKey(material.userId), JSON.stringify(material));
}

export async function ensureMailboxE2eeKey(userId: number): Promise<MailboxLocalE2eeKeyMaterial> {
  const existing = getStoredMailboxE2eeKey(userId);
  if (existing) return existing;

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );

  const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKeyJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const publicKeyPem = bytesToPem(new Uint8Array(publicKeySpki));
  const fingerprint = await sha256Hex(publicKeyPem);

  const material: MailboxLocalE2eeKeyMaterial = {
    userId,
    publicKeyPem,
    keyAlgorithm: E2EE_KEY_ALGO,
    fingerprint,
    privateKeyJwk,
    updatedAt: Date.now(),
  };
  persistMailboxE2eeKey(material);
  return material;
}

export async function encryptTextForMailboxRecipients(
  plaintext: string,
  recipients: RecipientKey[],
): Promise<{ envelope: string; bodyDigestSha256: string }> {
  const normalizedText = String(plaintext ?? "");
  const uniqueRecipients = recipients
    .map((row) => ({
      userId: Number(row.userId),
      publicKeyPem: String(row.publicKeyPem ?? "").trim(),
      keyAlgorithm: String(row.keyAlgorithm ?? E2EE_KEY_ALGO).trim().toUpperCase(),
    }))
    .filter((row) => Number.isInteger(row.userId) && row.userId > 0 && row.publicKeyPem.length > 0);

  if (!uniqueRecipients.length) {
    throw new Error("E2EE_RECIPIENT_KEYS_REQUIRED");
  }

  const cek = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt"],
  );

  const plaintextBytes = new TextEncoder().encode(normalizedText);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
      },
      aesKey,
      plaintextBytes,
    ),
  );

  if (encrypted.length <= 16) {
    throw new Error("E2EE_ENCRYPTION_FAILED");
  }

  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  const tag = encrypted.slice(encrypted.length - 16);

  const recipientMap: Record<string, { keyAlgorithm: string; encryptedKey: string }> = {};
  for (const recipient of uniqueRecipients) {
    if (recipient.keyAlgorithm !== E2EE_KEY_ALGO) {
      throw new Error("E2EE_KEY_ALGO_UNSUPPORTED");
    }
    const publicKey = await importPublicKey(recipient.publicKeyPem);
    const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, cek);
    recipientMap[String(recipient.userId)] = {
      keyAlgorithm: E2EE_KEY_ALGO,
      encryptedKey: toBase64(new Uint8Array(wrappedKey)),
    };
  }

  const envelope = JSON.stringify({
    version: 1,
    keyAlgorithm: E2EE_KEY_ALGO,
    dataAlgorithm: E2EE_DATA_ALGO_AES_256_GCM,
    recipients: recipientMap,
    iv: toBase64(iv),
    tag: toBase64(tag),
    ciphertext: toBase64(ciphertext),
    createdAt: Math.floor(Date.now() / 1000),
  });

  return {
    envelope,
    bodyDigestSha256: await sha256Hex(normalizedText),
  };
}

export async function decryptMailboxEnvelopeForUser(input: {
  envelopeJson: string;
  userId: number;
  privateKeyJwk: JsonWebKey;
}): Promise<string | null> {
  const raw = String(input.envelopeJson ?? "").trim();
  if (!raw) return null;

  let envelope: any;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }

  const recipient = envelope?.recipients?.[String(input.userId)];
  const recipientEncryptedKey =
    typeof recipient?.encryptedKey === "string" && recipient.encryptedKey.trim()
      ? recipient.encryptedKey.trim()
      : Number(envelope?.recipientUserId) === Number(input.userId) &&
          typeof envelope?.encryptedKey === "string" &&
          envelope.encryptedKey.trim()
        ? envelope.encryptedKey.trim()
        : "";
  const recipientKeyAlgorithm =
    typeof recipient?.keyAlgorithm === "string" && recipient.keyAlgorithm.trim()
      ? recipient.keyAlgorithm.trim().toUpperCase()
      : typeof envelope?.keyAlgorithm === "string" && envelope.keyAlgorithm.trim()
        ? envelope.keyAlgorithm.trim().toUpperCase()
        : "";

  if (!recipientEncryptedKey || recipientKeyAlgorithm !== E2EE_KEY_ALGO) {
    return null;
  }

  const ivB64 = String(envelope?.iv ?? "");
  const tagB64 = String(envelope?.tag ?? "");
  const ciphertextB64 = String(envelope?.ciphertext ?? "");
  if (!ivB64 || !tagB64 || !ciphertextB64) return null;

  try {
    const privateKey = await importPrivateKey(input.privateKeyJwk);
    const wrappedKey = fromBase64(recipientEncryptedKey);
    const cekRaw = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      toBufferSource(wrappedKey),
    );

    const aesKey = await crypto.subtle.importKey(
      "raw",
      cekRaw,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["decrypt"],
    );

    const ciphertext = fromBase64(ciphertextB64);
    const tag = fromBase64(tagB64);
    const iv = fromBase64(ivB64);
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(iv),
        tagLength: 128,
      },
      aesKey,
      combined,
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
