/// <reference lib="webworker" />

declare const __TQ_BUILD_HASH__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;

const BUILD_HASH = String(__TQ_BUILD_HASH__ || "dev");
const CACHE_PREFIX = "tq-shell-v";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_HASH}`;
const SHELL_URLS = ["/index.html"];
const MANIFEST_CANDIDATE_PATHS = ["/.vite/manifest.json", "/manifest.json"] as const;
const CRITICAL_ROUTE_KEY_HINTS = [
  "src/pages/Dashboard",
  "src/pages/QuotesScreen",
  "src/pages/TradeScreen",
  "src/pages/ChartScreen",
] as const;

type ViteManifestEntry = {
  file?: string;
  css?: string[];
  imports?: string[];
};

type ViteManifest = Record<string, ViteManifestEntry>;

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
    contentType.includes("application/json")
  );
}

function isBypassPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/ws" || pathname.startsWith("/ws/")) return true;
  if (pathname.includes("__vite")) return true;
  return false;
}

async function cacheAssetIfSafe(cache: Cache, assetPath: string): Promise<void> {
  const normalizedPath = normalizeAssetPath(assetPath);
  if (!normalizedPath) return;
  try {
    const response = await fetch(normalizedPath, { cache: "no-store" });
    if (!isCacheableResponse(response, normalizedPath)) return;
    await cache.put(normalizedPath, response.clone());
  } catch {
    // Ignore single-asset failures during pre-cache.
  }
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

  await Promise.all(Array.from(assetPaths).map((assetPath) => cacheAssetIfSafe(cache, assetPath)));
}

function isCriticalManifestKey(key: string): boolean {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  return CRITICAL_ROUTE_KEY_HINTS.some((hint) => normalized.includes(hint));
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

async function cacheCriticalRouteChunks(cache: Cache): Promise<void> {
  const manifest = await loadBuildManifest();
  if (!manifest) return;

  const keys = Object.keys(manifest).filter((key) => isCriticalManifestKey(key));
  if (!keys.length) return;

  const visited = new Set<string>();
  const assets = new Set<string>();
  for (const key of keys) {
    collectManifestAssetPaths(manifest, key, visited, assets);
  }

  await Promise.all(Array.from(assets).map((assetPath) => cacheAssetIfSafe(cache, assetPath)));
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
      await Promise.all(SHELL_URLS.map((path) => cacheAssetIfSafe(cache, path)));
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
        const response = await fetch(event.request);
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
