import { lazy } from "react";
import type { ComponentType } from "react";

type Listener = () => void;

export function subscribeLazyPing(listener: Listener) {
  void listener;
  return () => undefined;
}

export function getLazyPingSnapshot() {
  return 0;
}

export function useLazyPing() {
  return 0;
}

const CHUNK_RELOAD_MARKER_KEY = "tq.chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

function isDynamicImportChunkError(error: unknown): boolean {
  if (!error) return false;
  const row = error as { name?: unknown; message?: unknown };
  const name = String(row.name ?? "").toLowerCase();
  const message = String(row.message ?? "").toLowerCase();
  if (name.includes("chunkloaderror")) return true;
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("loading chunk") ||
    message.includes("importing a module script failed")
  );
}

function clearChunkReloadMarker(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_MARKER_KEY);
  } catch {
    // ignore storage failures
  }
}

function triggerChunkReloadOnce(): boolean {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return false;
  const now = Date.now();
  try {
    const lastRaw = Number(sessionStorage.getItem(CHUNK_RELOAD_MARKER_KEY) || "0");
    if (Number.isFinite(lastRaw) && lastRaw > 0 && now - lastRaw < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(CHUNK_RELOAD_MARKER_KEY, String(now));
  } catch {
    // Even if storage fails, continue with a one-off reload attempt.
  }
  window.location.reload();
  return true;
}

/**
 * Keep a stable import wrapper so call sites can continue using a single helper.
 * React.lazy already handles Suspense pings when chunks resolve.
 */
export function lazyWithPing<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const loaded = await importer();
      clearChunkReloadMarker();
      return loaded;
    } catch (error) {
      if (isDynamicImportChunkError(error) && triggerChunkReloadOnce()) {
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}
