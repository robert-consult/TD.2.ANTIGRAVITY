import { SW_ACTIVATE_NOW_MESSAGE } from "@/lib/prefetchCatalog";

function swEnabled(): boolean {
  if (import.meta.env.DEV) return false;
  const raw = import.meta.env.VITE_ENABLE_SW;
  if (raw == null) return true;
  return String(raw).trim().toLowerCase() !== "false";
}

function promptForServiceWorkerUpdate(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting;
  if (!waiting) return;

  const shouldReload = window.confirm("A new version is available. Reload now to update?");
  if (!shouldReload) return;

  let reloading = false;
  const onControllerChange = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });
  waiting.postMessage({ type: SW_ACTIVATE_NOW_MESSAGE });
}

function installServiceWorkerRegistration(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const enabled = swEnabled();
  window.addEventListener("load", () => {
    if (!enabled) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined);
      return;
    }

    void navigator.serviceWorker.register("/sw.js")
      .then((registration) => {
        if (registration.waiting) {
          promptForServiceWorkerUpdate(registration);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptForServiceWorkerUpdate(registration);
            }
          });
        });
      })
      .catch((error) => {
        console.warn("[sw] registration failed", error);
      });
  });
}

function updateBootStatus(message: string): void {
  const node = document.getElementById("boot-splash__status");
  if (!node) return;
  node.textContent = message;
}

function clearBootSplash(): void {
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready");
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.addEventListener(
      "transitionend",
      () => splash.remove(),
      { once: true },
    );
  });
}

let appStartPromise: Promise<void> | null = null;
const BOOT_READY_SESSION_KEY = "tq-boot-ready";

function startApp(): Promise<void> {
  if (appStartPromise) return appStartPromise;

  try {
    sessionStorage.setItem(BOOT_READY_SESSION_KEY, "1");
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }

  appStartPromise = (async () => {
    updateBootStatus("Loading interface...");

    const [{ createRoot }, { default: App }, { queryClient }, { initializeQueryPersistence }] = await Promise.all([
      import("react-dom/client"),
      import("./App"),
      import("@/lib/queryClient"),
      import("@/lib/queryPersistence"),
      import("./index.css"),
    ]);

    void initializeQueryPersistence(queryClient).catch(() => undefined);
    createRoot(document.getElementById("root")!).render(<App />);
    clearBootSplash();
  })().catch((error) => {
    appStartPromise = null;
    updateBootStatus("Interface failed to load. Click Open Platform to retry.");
    console.error("[boot] app startup failed", error);
    throw error;
  });

  return appStartPromise;
}

function hasPriorBootInSession(): boolean {
  try {
    return sessionStorage.getItem(BOOT_READY_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function requireManualBootOnFirstLoad(): boolean {
  const raw = import.meta.env.VITE_REQUIRE_BOOT_CTA;
  if (raw == null) return false;
  return String(raw).trim().toLowerCase() === "true";
}

function scheduleAppStart(): void {
  (window as any).__tqBootNow = () => {
    void startApp();
  };

  // Warm route chunks + baseline trader shell data immediately while the splash screen is visible.
  void Promise.all([
    import("@/lib/routePrefetch"),
    import("@/lib/startupDataPrefetch"),
    import("@/lib/queryClient"),
  ]).then(([routePrefetch, startupPrefetch, { queryClient }]) => {
    routePrefetch.prefetchAllRoutes({ startDelayMs: 0 });
    startupPrefetch.prefetchStartupData({
      queryClient,
      phase: "public",
      startDelayMs: 0,
    });
  }).catch((err) => {
    console.warn("[boot] proactive startup prefetch failed to initialize", err);
  });

  if (
    window.location.pathname === "/" &&
    !hasPriorBootInSession() &&
    requireManualBootOnFirstLoad()
  ) {
    return;
  }

  void startApp();
}

function bootstrap(): void {
  installServiceWorkerRegistration();
  scheduleAppStart();
}

bootstrap();
