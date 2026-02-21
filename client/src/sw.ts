/// <reference lib="webworker" />

import {
  PREFETCH_MANIFEST_HINT_BY_KEY,
  SW_BURST_PREFETCH_MESSAGE,
  SW_INSTALL_PREFETCH_KEYS,
} from "./lib/prefetchCatalog";

declare const __TQ_BUILD_HASH__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;

const BUILD_HASH = String(__TQ_BUILD_HASH__ || "dev");
const CACHE_PREFIX = "tq-shell-v";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_HASH}`;
const SHELL_URLS = ["/index.html"];
const MANIFEST_CANDIDATE_PATHS = ["/.vite/manifest.json", "/manifest.json"] as const;
const DEFAULT_PREFETCH_CONCURRENCY = 4;
const MAX_PREFETCH_CONCURRENCY = 6;

type ViteManifestEntry = {
  file?: string;
  css?: string[];
  imports?: string[];
};

type ViteManifest = Record<string, ViteManifestEntry>;

type BurstPrefetchPayload = {
  keys: string[];
  concurrency: number;
};

let manifestPromise: Promise<ViteManifest | null> | null = null;
const assetPrefetchInFlight = new Map<string, Promise<void>>();

function isHtmlResponse(response: Response | null | undefined): boolean {
  if (!response) return false;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("text/html");
}

function normalizeAssetPath(pathname: string): string {
  const trimmed = String(pathname || "").trim();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isCacheableResponse(response: Response | null | undefined, url: string): boolean {
  if (!response) return false;
  if (!response.ok || response.status !== 200) return false;
  if (response.type === "opaque") return false;
  try {
    const parsed = new URL(url, sw.location.origin);
    if (parsed.origin !== sw.location.origin) return false;
  } catch {
    return false;
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("text/css") ||
    contentType.includes("application/json") ||
    contentType.includes("font/") ||
    contentType.includes("image/") ||
    contentType.includes("application/wasm") ||
    contentType.includes("application/octet-stream")
  );
}

function isBypassPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/ws" || pathname.startsWith("/ws/")) return true;
  if (pathname.includes("__vite")) return true;
  return false;
}

function clampConcurrency(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PREFETCH_CONCURRENCY;
  return Math.max(1, Math.min(MAX_PREFETCH_CONCURRENCY, Math.trunc(n)));
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;

  const limit = Math.max(1, Math.min(Math.trunc(concurrency) || 1, items.length));
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

function resolveManifestHints(keys: readonly string[] | null | undefined): string[] {
  const hints = new Set<string>();

  const inputKeys = Array.isArray(keys)
    ? keys.map((key) => String(key || "").trim()).filter(Boolean)
    : [];

  const keysToUse = inputKeys.length > 0 ? inputKeys : Array.from(SW_INSTALL_PREFETCH_KEYS);
  for (const key of keysToUse) {
    const hint = PREFETCH_MANIFEST_HINT_BY_KEY[key];
    if (hint) hints.add(hint);
  }

  return Array.from(hints);
}

async function cacheAssetIfSafe(cache: Cache, assetPath: string): Promise<void> {
  const normalizedPath = normalizeAssetPath(assetPath);
  if (!normalizedPath) return;

  const existing = assetPrefetchInFlight.get(normalizedPath);
  if (existing) {
    await existing;
    return;
  }

  const task = (async () => {
    try {
      const response = await fetch(normalizedPath, { cache: "no-store" });
      if (!isCacheableResponse(response, normalizedPath)) return;
      await cache.put(normalizedPath, response.clone());
    } catch {
      // Ignore single-asset failures during pre-cache.
    }
  })().finally(() => {
    assetPrefetchInFlight.delete(normalizedPath);
  });

  assetPrefetchInFlight.set(normalizedPath, task);
  await task;
}

async function cacheIndexAndAssets(cache: Cache): Promise<void> {
  const htmlResponse = await fetch("/index.html", { cache: "no-store" }).catch(() => null);
  if (!htmlResponse) return;
  if (!isCacheableResponse(htmlResponse, "/index.html") || !isHtmlResponse(htmlResponse)) return;

  await cache.put("/index.html", htmlResponse.clone());

  const html = await htmlResponse.text();
  const assetPaths = new Set<string>();
  const assetPattern = /(?:src|href)=["'](\/assets\/[^"']+)["']/g;
  let match: RegExpExecArray | null = null;
  while ((match = assetPattern.exec(html)) !== null) {
    const candidate = String(match[1] || "").trim();
    if (candidate) assetPaths.add(candidate);
  }

  await runWithConcurrency(Array.from(assetPaths), DEFAULT_PREFETCH_CONCURRENCY, async (assetPath) => {
    await cacheAssetIfSafe(cache, assetPath);
  });
}

function collectManifestAssetPaths(
  manifest: ViteManifest,
  key: string,
  visited: Set<string>,
  assets: Set<string>,
): void {
  if (visited.has(key)) return;
  visited.add(key);

  const entry = manifest[key];
  if (!entry) return;

  if (entry.file) assets.add(normalizeAssetPath(entry.file));
  for (const cssPath of entry.css || []) {
    assets.add(normalizeAssetPath(cssPath));
  }
  for (const importKey of entry.imports || []) {
    collectManifestAssetPaths(manifest, importKey, visited, assets);
  }
}

function collectManifestAssetsForHints(manifest: ViteManifest, hints: readonly string[]): Set<string> {
  const keys = Object.keys(manifest).filter((key) => {
    const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
    return hints.some((hint) => normalized.includes(hint));
  });

  const visited = new Set<string>();
  const assets = new Set<string>();
  for (const key of keys) {
    collectManifestAssetPaths(manifest, key, visited, assets);
  }

  return assets;
}

async function loadBuildManifest(): Promise<ViteManifest | null> {
  for (const manifestPath of MANIFEST_CANDIDATE_PATHS) {
    try {
      const response = await fetch(manifestPath, { cache: "no-store" });
      if (!isCacheableResponse(response, manifestPath)) continue;
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      return payload as ViteManifest;
    } catch {
      // Try the next manifest path.
    }
  }
  return null;
}

function getManifestOnce(): Promise<ViteManifest | null> {
  if (!manifestPromise) {
    manifestPromise = loadBuildManifest().catch(() => null);
  }
  return manifestPromise;
}

async function cacheManifestAssets(cache: Cache, hints: readonly string[], concurrency: number): Promise<void> {
  const manifest = await getManifestOnce();
  if (!manifest) return;

  const assets = collectManifestAssetsForHints(manifest, hints);
  if (!assets.size) return;

  await runWithConcurrency(Array.from(assets), concurrency, async (assetPath) => {
    await cacheAssetIfSafe(cache, assetPath);
  });
}

async function cacheCriticalRouteChunks(cache: Cache): Promise<void> {
  const hints = resolveManifestHints(Array.from(SW_INSTALL_PREFETCH_KEYS));
  await cacheManifestAssets(cache, hints, DEFAULT_PREFETCH_CONCURRENCY);
}

function parseBurstPrefetchPayload(value: unknown): BurstPrefetchPayload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const type = String(row.type || "").trim();
  if (type !== SW_BURST_PREFETCH_MESSAGE) return null;

  const payload = row.payload && typeof row.payload === "object"
    ? (row.payload as Record<string, unknown>)
    : {};

  const rawKeys = Array.isArray(payload.keys) ? payload.keys : [];
  const keys = rawKeys
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return {
    keys,
    concurrency: clampConcurrency(payload.concurrency),
  };
}

async function staleWhileRevalidateNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match("/index.html");

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response, request.url) && isHtmlResponse(response)) {
        await cache.put("/index.html", response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

sw.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cacheIndexAndAssets(cache).catch(() => undefined);
      await cacheCriticalRouteChunks(cache).catch(() => undefined);
      await runWithConcurrency(SHELL_URLS, DEFAULT_PREFETCH_CONCURRENCY, async (path) => {
        await cacheAssetIfSafe(cache, path);
      });
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event: ExtendableMessageEvent) => {
  const burst = parseBurstPrefetchPayload(event.data);
  if (!burst) return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hints = resolveManifestHints(burst.keys);
      await cacheManifestAssets(cache, hints, burst.concurrency);
    })(),
  );
});

sw.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin) return;
  if (isBypassPath(url.pathname)) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request).catch(() => null);
        if (!response) {
          return new Response("Asset unavailable offline", {
            status: 503,
            statusText: "Offline",
          });
        }
        if (isCacheableResponse(response, event.request.url)) {
          await cache.put(event.request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(staleWhileRevalidateNavigation(event.request));
  }
});

export {};
