import { describe, expect, it } from "vitest";
import { SecureCache } from "@/lib/secureCache";

function hasBrowserCryptoAndIdb(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
}

async function deleteDb(dbName: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
    request.onsuccess = () => resolve();
  });
}

async function readRawEntry(dbName: string, store: "query-cache" | "user-state" | "e2ee-keys", key: string) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const value = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

describe("SecureCache", () => {
  const maybeIt = hasBrowserCryptoAndIdb() ? it : it.skip;

  it("degrades gracefully when IndexedDB is unavailable", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const cache = new SecureCache("test-secret", {
        dbName: `tq-secure-cache-test-${Date.now()}-${Math.random()}`,
        dbVersion: 1,
      });
      await cache.init();
      await cache.put("query-cache", "k", { value: 1 });
      await expect(cache.get("query-cache", "k")).resolves.toBeNull();
      await expect(cache.delete("query-cache", "k")).resolves.toBeUndefined();
      await expect(cache.clearAll()).resolves.toBeUndefined();
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "indexedDB", originalDescriptor);
      } else {
        delete (globalThis as any).indexedDB;
      }
    }
  });

  maybeIt("encrypts values at rest and decrypts on read", async () => {
    const dbName = `tq-secure-cache-test-${Date.now()}-${Math.random()}`;
    const cache = new SecureCache("test-secret", { dbName, dbVersion: 1 });
    await cache.init();

    await cache.put("query-cache", "entry-1", { balance: 123.45, region: "US" });

    const raw = await readRawEntry(dbName, "query-cache", "entry-1");
    expect(raw).toBeTruthy();
    expect(Array.isArray(raw?.data)).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("balance");
    expect(JSON.stringify(raw)).not.toContain("123.45");

    const parsed = await cache.get<{ balance: number; region: string }>("query-cache", "entry-1");
    expect(parsed).toEqual({ balance: 123.45, region: "US" });

    cache.close();
    await deleteDb(dbName);
  });

  maybeIt("returns null and clears corrupt entries", async () => {
    const dbName = `tq-secure-cache-test-${Date.now()}-${Math.random()}`;
    const cache = new SecureCache("test-secret", { dbName, dbVersion: 1 });
    await cache.init();
    await cache.put("query-cache", "entry-2", { foo: "bar" });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("query-cache", "readwrite");
      const store = tx.objectStore("query-cache");
      const getReq = store.get("entry-2");
      getReq.onsuccess = () => {
        const value = getReq.result;
        value.iv = Array.isArray(value.iv) ? [...value.iv] : [];
        if (value.iv.length > 0) value.iv[0] = (Number(value.iv[0]) ^ 255) & 255;
        store.put(value);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();

    const corrupted = await cache.get("query-cache", "entry-2");
    expect(corrupted).toBeNull();

    const after = await readRawEntry(dbName, "query-cache", "entry-2");
    expect(after ?? null).toBeNull();

    cache.close();
    await deleteDb(dbName);
  });

  maybeIt("clears all stores on clearAll", async () => {
    const dbName = `tq-secure-cache-test-${Date.now()}-${Math.random()}`;
    const cache = new SecureCache("test-secret", { dbName, dbVersion: 1 });
    await cache.init();

    await cache.put("query-cache", "q1", { a: 1 });
    await cache.put("user-state", "u1", { b: 2 });
    await cache.put("e2ee-keys", "k1", { c: 3 });

    await cache.clearAll();

    expect(await cache.get("query-cache", "q1")).toBeNull();
    expect(await cache.get("user-state", "u1")).toBeNull();
    expect(await cache.get("e2ee-keys", "k1")).toBeNull();

    cache.close();
    await deleteDb(dbName);
  });
});
