/// <reference lib="webworker" />

declare const __TQ_BUILD_HASH__: string;
const sw = self as unknown as ServiceWorkerGlobalScope;

const BUILD_HASH = String(__TQ_BUILD_HASH__ || "dev");
const CACHE_PREFIX = "tq-shell-v";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_HASH}`;
const SHELL_URLS = ["/index.html"];

function isHtmlResponse(response: Response | null | undefined): boolean {
  if (!response) return false;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return contentType.includes("text/html");
}

function isBypassPath(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/ws" || pathname.startsWith("/ws/")) return true;
  if (pathname.includes("__vite")) return true;
  return false;
}

async function cacheIndexAndAssets(cache: Cache): Promise<void> {
  const htmlResponse = await fetch("/index.html", { cache: "no-store" }).catch(() => null);
  if (!htmlResponse?.ok || !isHtmlResponse(htmlResponse)) return;

  await cache.put("/index.html", htmlResponse.clone());

  const html = await htmlResponse.text();
  const assetPaths = new Set<string>();
  const assetPattern = /(?:src|href)=["'](\/assets\/[^"']+)["']/g;
  let match: RegExpExecArray | null = null;
  while ((match = assetPattern.exec(html)) !== null) {
    const candidate = String(match[1] || "").trim();
    if (candidate) assetPaths.add(candidate);
  }

  await Promise.all(
    Array.from(assetPaths).map(async (assetPath) => {
      try {
        const response = await fetch(assetPath, { cache: "no-store" });
        if (response.ok) {
          await cache.put(assetPath, response);
        }
      } catch {
        // Ignore single-asset pre-cache failures.
      }
    }),
  );
}

async function staleWhileRevalidateNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match("/index.html");

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response.ok && isHtmlResponse(response)) {
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
      await cache.addAll(SHELL_URLS).catch(() => undefined);
      await cacheIndexAndAssets(cache).catch(() => undefined);
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
        if (response.ok) {
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
