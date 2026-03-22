import { SW_ACTIVATE_NOW_MESSAGE } from "@/lib/prefetchCatalog";

type BootWindow = Window & {
  __tqBootNow?: () => void;
  __tqOpenPlatform?: () => void;
};

const BOOT_RECOVERY_TIMEOUT_MS = 12_000;
const BOOT_RECOVERY_TIMEOUT_CONSTRAINED_MS = 25_000;
const SHELL_CACHE_PREFIX = "tq-shell-v";

type BootNavigatorLike = Navigator & {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
    rtt?: number;
  };
  mozConnection?: {
    effectiveType?: string;
    saveData?: boolean;
    rtt?: number;
  };
  webkitConnection?: {
    effectiveType?: string;
    saveData?: boolean;
    rtt?: number;
  };
};

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

function resolveBootRecoveryTimeoutMs(): number {
  if (typeof navigator === "undefined") return BOOT_RECOVERY_TIMEOUT_MS;
  const bootNavigator = navigator as BootNavigatorLike;
  const connection = bootNavigator.connection ?? bootNavigator.mozConnection ?? bootNavigator.webkitConnection;
  const effectiveType = String(connection?.effectiveType ?? "").trim().toLowerCase();
  const saveData = Boolean(connection?.saveData);
  const rtt = Number(connection?.rtt ?? 0);

  if (saveData || effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") {
    return BOOT_RECOVERY_TIMEOUT_CONSTRAINED_MS;
  }
  if (Number.isFinite(rtt) && rtt >= 300) {
    return BOOT_RECOVERY_TIMEOUT_CONSTRAINED_MS;
  }
  return BOOT_RECOVERY_TIMEOUT_MS;
}

function updateBootStatus(message: string): void {
  const node = document.getElementById("boot-splash__status");
  if (!node) return;
  node.textContent = message;
}

function setBootButtonBusy(isBusy: boolean): void {
  const button = document.getElementById("boot-splash__cta");
  if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = isBusy;
  button.ariaBusy = isBusy ? "true" : "false";
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

async function clearShellCachesForRecovery(): Promise<void> {
  if (typeof window === "undefined") return;

  const tasks: Promise<unknown>[] = [];
  if ("caches" in window) {
    tasks.push(
      caches.keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith(SHELL_CACHE_PREFIX))
              .map((key) => caches.delete(key)),
          ),
        )
        .catch(() => undefined),
    );
  }

  if ("serviceWorker" in navigator) {
    tasks.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined),
    );
  }

  await Promise.allSettled(tasks);
}

function forceRecoveryReload(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("__tq_boot_retry", String(Date.now()));
  window.location.replace(url.toString());
}

async function startAppWithTimeout(timeoutMs: number): Promise<void> {
  let timeoutId: number | null = null;
  try {
    await Promise.race([
      startApp(),
      new Promise<void>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("BOOT_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

async function handleOpenPlatformClick(): Promise<void> {
  setBootButtonBusy(true);
  updateBootStatus("Opening platform...");
  try {
    await startAppWithTimeout(resolveBootRecoveryTimeoutMs());
  } catch (error) {
    console.warn("[boot] startup retry failed; forcing recovery reload", error);
    updateBootStatus("Refreshing platform cache...");
    await clearShellCachesForRecovery();
    forceRecoveryReload();
  } finally {
    setBootButtonBusy(false);
  }
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
  const bootWindow = window as BootWindow;
  bootWindow.__tqBootNow = () => {
    void startApp();
  };
  bootWindow.__tqOpenPlatform = () => {
    void handleOpenPlatformClick();
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
