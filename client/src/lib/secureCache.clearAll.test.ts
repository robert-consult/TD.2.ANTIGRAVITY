import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SecureCache,
  resetSecureCacheForTests,
  secureClearAll,
  setSecureCacheScope,
} from "@/lib/secureCache";

const SEED_STORAGE_KEY = "tq.secure-cache.seed.v1";
const SCOPE_STORAGE_KEY = "tq.secure-cache.scope.v1";

describe("secure cache clear/scope hardening", () => {
  beforeEach(() => {
    resetSecureCacheForTests();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(SecureCache.prototype, "init").mockResolvedValue();
    vi.spyOn(SecureCache.prototype, "clearAll").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).caches;
    localStorage.clear();
    sessionStorage.clear();
    resetSecureCacheForTests();
  });

  it("clears secure seed/scope and service-worker caches on secureClearAll", async () => {
    const deleteSpy = vi.fn(async () => true);
    const keysSpy = vi.fn(async () => ["tq-shell-v-a", "workbox-precache-v2", "tq-shell-v-b"]);
    (globalThis as any).caches = {
      keys: keysSpy,
      delete: deleteSpy,
    };

    sessionStorage.setItem(SEED_STORAGE_KEY, "seed-before");
    localStorage.setItem(SCOPE_STORAGE_KEY, "user:42");

    await secureClearAll();

    expect(sessionStorage.getItem(SEED_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SCOPE_STORAGE_KEY)).toBeNull();
    expect(keysSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("tq-shell-v-a");
    expect(deleteSpy).toHaveBeenCalledWith("tq-shell-v-b");
    expect(deleteSpy).not.toHaveBeenCalledWith("workbox-precache-v2");
  });

  it("rotates the local seed when switching cache scopes", async () => {
    sessionStorage.setItem(SEED_STORAGE_KEY, "seed-initial");

    await setSecureCacheScope("user:777");

    const rotatedSeed = sessionStorage.getItem(SEED_STORAGE_KEY);
    expect(rotatedSeed).toBeTruthy();
    expect(rotatedSeed).not.toBe("seed-initial");
    expect(localStorage.getItem(SCOPE_STORAGE_KEY)).toBe("user:777");
  });
});
