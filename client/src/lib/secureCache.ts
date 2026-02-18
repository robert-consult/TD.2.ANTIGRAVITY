const DEFAULT_DB_NAME = "tq-secure-cache-v1";
const DEFAULT_DB_VERSION = 1;
const ENTRY_VERSION = 1;
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH_BYTES = 12;
const STORE_NAMES = ["query-cache", "user-state", "e2ee-keys"] as const;
const DEFAULT_SECRET_SCOPE = "app";
const SEED_STORAGE_KEY = "tq.secure-cache.seed.v1";
const SCOPE_STORAGE_KEY = "tq.secure-cache.scope.v1";
const OWNED_CACHE_PREFIXES = ["tq-"] as const;

export type StoreNames = (typeof STORE_NAMES)[number];

type EncryptedEntry = {
  key: string;
  iv: number[];
  data: number[];
  v: number;
  updatedAt: number;
};

export interface SecureCacheOptions {
  dbName?: string;
  dbVersion?: number;
}

function envFlagEnabled(name: string, fallback: boolean): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function hasWebCrypto(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function randomSeedHex(bytesLength = 32): string {
  if (!hasWebCrypto()) {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return toHex(bytes);
}

function resolveOrigin(): string {
  if (typeof location === "undefined") return "unknown-origin";
  return String(location.origin || "unknown-origin");
}

function getOrCreateSeed(): string {
  if (typeof localStorage === "undefined") return `seedless:${resolveOrigin()}`;
  try {
    const existing = localStorage.getItem(SEED_STORAGE_KEY);
    if (existing) return existing;
    const generated = randomSeedHex(32);
    localStorage.setItem(SEED_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `seedless:${resolveOrigin()}`;
  }
}

function createSecret(scope = DEFAULT_SECRET_SCOPE): string {
  const normalizedScope = String(scope || DEFAULT_SECRET_SCOPE).trim() || DEFAULT_SECRET_SCOPE;
  return `${normalizedScope}:${getOrCreateSeed()}:${resolveOrigin()}`;
}

function normalizeScope(scope?: string | null): string {
  const normalized = String(scope ?? "").trim();
  return normalized || DEFAULT_SECRET_SCOPE;
}

function readStoredScope(): string {
  if (typeof localStorage === "undefined") return DEFAULT_SECRET_SCOPE;
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    return normalizeScope(raw);
  } catch {
    return DEFAULT_SECRET_SCOPE;
  }
}

function writeStoredScope(scope: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, normalizeScope(scope));
  } catch {
    // ignore storage write failures
  }
}

function removeStorageKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage delete failures
  }
}

function rotateStoredSeed(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEED_STORAGE_KEY, randomSeedHex(32));
  } catch {
    // ignore storage write failures
  }
}

async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    if (!keys.length) return;
    const ownedKeys = keys.filter((key) =>
      OWNED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    if (!ownedKeys.length) return;
    await Promise.all(ownedKeys.map((key) => caches.delete(key)));
  } catch {
    // ignore cache storage failures
  }
}

function openDb(dbName: string, dbVersion: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of STORE_NAMES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "key" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("SECURE_CACHE_OPEN_FAILED"));
    request.onblocked = () => reject(new Error("SECURE_CACHE_OPEN_BLOCKED"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("SECURE_CACHE_REQUEST_FAILED"));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("SECURE_CACHE_TX_FAILED"));
    transaction.onabort = () => reject(transaction.error ?? new Error("SECURE_CACHE_TX_ABORTED"));
  });
}

function isStoreName(value: string): value is StoreNames {
  return (STORE_NAMES as readonly string[]).includes(value);
}

function normalizeStoreName(store: StoreNames): StoreNames {
  if (!isStoreName(store)) {
    throw new Error(`SECURE_CACHE_UNKNOWN_STORE:${String(store)}`);
  }
  return store;
}

function normalizeKey(key: string): string {
  return String(key || "").trim();
}

function normalizeCipherEntry(value: unknown): EncryptedEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EncryptedEntry>;
  if (typeof row.key !== "string" || !Array.isArray(row.iv) || !Array.isArray(row.data)) return null;
  if (row.iv.length !== IV_LENGTH_BYTES) return null;
  if (typeof row.v !== "number" || row.v !== ENTRY_VERSION) return null;
  return {
    key: row.key,
    iv: row.iv.map((n) => Number(n)),
    data: row.data.map((n) => Number(n)),
    v: row.v,
    updatedAt: Number(row.updatedAt || 0),
  };
}

function secureCacheEnabled(): boolean {
  return envFlagEnabled("VITE_ENABLE_SECURE_CACHE", true);
}

export class SecureCache {
  private dbName: string;
  private dbVersion: number;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private keyPromise: Promise<CryptoKey | null> | null = null;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly userSecret: string,
    options?: SecureCacheOptions,
  ) {
    this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
    this.dbVersion = options?.dbVersion ?? DEFAULT_DB_VERSION;
  }

  async init(): Promise<void> {
    if (!secureCacheEnabled()) return;
    await Promise.all([this.ensureDb(), this.ensureKey()]);
  }

  async put<T>(store: StoreNames, key: string, value: T): Promise<void> {
    if (!secureCacheEnabled()) return;
    const normalizedStore = normalizeStoreName(store);
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return;

    const db = await this.ensureDb();
    const encryptionKey = await this.ensureKey();
    if (!db || !encryptionKey) return;

    try {
      const json = JSON.stringify(value);
      const payload = this.encoder.encode(json);
      if (payload.byteLength > MAX_ENTRY_BYTES) {
        throw new Error("SECURE_CACHE_ENTRY_TOO_LARGE");
      }

      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          tagLength: 128,
        },
        encryptionKey,
        payload,
      );
      const encrypted = new Uint8Array(encryptedBuffer);
      const row: EncryptedEntry = {
        key: normalizedKey,
        iv: Array.from(iv),
        data: Array.from(encrypted),
        v: ENTRY_VERSION,
        updatedAt: Date.now(),
      };

      const transaction = db.transaction(normalizedStore, "readwrite");
      transaction.objectStore(normalizedStore).put(row);
      await waitForTransaction(transaction);
    } catch (error) {
      if ((error as Error)?.message === "SECURE_CACHE_ENTRY_TOO_LARGE") {
        throw error;
      }
      // Fail open for UX, fail closed for confidentiality.
    }
  }

  async get<T>(store: StoreNames, key: string): Promise<T | null> {
    if (!secureCacheEnabled()) return null;
    const normalizedStore = normalizeStoreName(store);
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return null;

    const db = await this.ensureDb();
    const encryptionKey = await this.ensureKey();
    if (!db || !encryptionKey) return null;

    try {
      const transaction = db.transaction(normalizedStore, "readonly");
      const request = transaction.objectStore(normalizedStore).get(normalizedKey);
      const raw = await requestToPromise(request);
      await waitForTransaction(transaction);
      const row = normalizeCipherEntry(raw);
      if (!row) return null;

      const iv = new Uint8Array(row.iv);
      const ciphertext = new Uint8Array(row.data);
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          tagLength: 128,
        },
        encryptionKey,
        ciphertext,
      );

      const decryptedJson = this.decoder.decode(decryptedBuffer);
      return JSON.parse(decryptedJson) as T;
    } catch {
      await this.delete(normalizedStore, normalizedKey);
      return null;
    }
  }

  async delete(store: StoreNames, key: string): Promise<void> {
    if (!secureCacheEnabled()) return;
    const normalizedStore = normalizeStoreName(store);
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return;

    const db = await this.ensureDb();
    if (!db) return;
    try {
      const transaction = db.transaction(normalizedStore, "readwrite");
      transaction.objectStore(normalizedStore).delete(normalizedKey);
      await waitForTransaction(transaction);
    } catch {
      // Ignore delete failures to keep calling code non-blocking.
    }
  }

  async clearAll(): Promise<void> {
    if (!secureCacheEnabled()) return;
    const db = await this.ensureDb();
    if (!db) return;

    try {
      const transaction = db.transaction(Array.from(STORE_NAMES), "readwrite");
      for (const storeName of STORE_NAMES) {
        transaction.objectStore(storeName).clear();
      }
      await waitForTransaction(transaction);
    } catch {
      // Ignore clear failures; caller should still proceed with logout/session tear-down.
    }
  }

  close(): void {
    if (!this.dbPromise) return;
    void this.dbPromise
      .then((db) => {
        db?.close();
      })
      .catch(() => undefined);
    this.dbPromise = null;
    this.keyPromise = null;
  }

  private async ensureDb(): Promise<IDBDatabase | null> {
    if (!secureCacheEnabled() || !hasIndexedDb()) return null;
    if (!this.dbPromise) {
      this.dbPromise = openDb(this.dbName, this.dbVersion).catch(() => null);
    }
    return this.dbPromise;
  }

  private async ensureKey(): Promise<CryptoKey | null> {
    if (!secureCacheEnabled() || !hasWebCrypto()) return null;
    if (!this.keyPromise) {
      this.keyPromise = this.deriveKey().catch(() => null);
    }
    return this.keyPromise;
  }

  private async deriveKey(): Promise<CryptoKey | null> {
    if (!hasWebCrypto()) return null;
    const secret = this.encoder.encode(this.userSecret);
    const salt = this.encoder.encode(`${this.dbName}:${resolveOrigin()}:cache`);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      secret,
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"],
    );
  }
}

let defaultCachePromise: Promise<SecureCache> | null = null;
let defaultCacheScope = readStoredScope();

function disposeDefaultCache(): void {
  if (!defaultCachePromise) return;
  void defaultCachePromise
    .then((cache) => cache.close())
    .catch(() => undefined);
  defaultCachePromise = null;
}

export async function getSecureCache(): Promise<SecureCache> {
  const scope = readStoredScope();
  if (scope !== defaultCacheScope) {
    defaultCacheScope = scope;
    disposeDefaultCache();
  }

  if (!defaultCachePromise) {
    const cache = new SecureCache(createSecret(defaultCacheScope));
    defaultCachePromise = cache.init().then(() => cache);
  }
  return defaultCachePromise;
}

export async function securePut<T>(store: StoreNames, key: string, value: T): Promise<void> {
  const cache = await getSecureCache();
  await cache.put(store, key, value);
}

export async function secureGet<T>(store: StoreNames, key: string): Promise<T | null> {
  const cache = await getSecureCache();
  return cache.get<T>(store, key);
}

export async function secureDelete(store: StoreNames, key: string): Promise<void> {
  const cache = await getSecureCache();
  await cache.delete(store, key);
}

export async function secureClearAll(): Promise<void> {
  try {
    const cache = await getSecureCache();
    await cache.clearAll();
  } finally {
    disposeDefaultCache();
    defaultCacheScope = DEFAULT_SECRET_SCOPE;
    removeStorageKey(SEED_STORAGE_KEY);
    removeStorageKey(SCOPE_STORAGE_KEY);
    await clearServiceWorkerCaches();
  }
}

export function getSecureCacheScope(): string {
  return readStoredScope();
}

export async function setSecureCacheScope(scope: string): Promise<void> {
  const normalized = normalizeScope(scope);
  if (normalized === defaultCacheScope) {
    writeStoredScope(normalized);
    return;
  }

  writeStoredScope(normalized);
  defaultCacheScope = normalized;
  rotateStoredSeed();
  disposeDefaultCache();
}

export async function setSecureCacheUserScope(userId?: number | null): Promise<void> {
  const parsed = Number(userId);
  const nextScope = Number.isInteger(parsed) && parsed > 0 ? `user:${parsed}` : DEFAULT_SECRET_SCOPE;
  await setSecureCacheScope(nextScope);
}

export function resetSecureCacheForTests(): void {
  disposeDefaultCache();
  defaultCacheScope = DEFAULT_SECRET_SCOPE;
  removeStorageKey(SEED_STORAGE_KEY);
  removeStorageKey(SCOPE_STORAGE_KEY);
}
