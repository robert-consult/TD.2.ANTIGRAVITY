import { SW_ACTIVATE_NOW_MESSAGE } from "@/lib/prefetchCatalog";
import { deleteSecureCacheDatabase, secureClearAll } from "@/lib/secureCache";

type BootWindow = Window & {
  __tqBootNow?: () => void;
  __tqOpenPlatform?: () => void;
};

const BOOT_RECOVERY_TIMEOUT_MS = 12_000;
const BOOT_RECOVERY_TIMEOUT_CONSTRAINED_MS = 25_000;
const SHELL_CACHE_PREFIX = "tq-shell-v";
const BOOT_READY_SESSION_KEY = "tq-boot-ready";
const DEV_SW_CLEANUP_SESSION_KEY = "tq-dev-sw-cleanup";
const BOOT_RETRY_QUERY_KEY = "__tq_boot_retry";
const BOOT_RESET_DONE_SESSION_KEY = "tq-boot-reset-done";
const OWNED_STORAGE_KEY_PREFIXES = ["tq-", "tq.", "tradequip.", "tradequip:"];

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

function hasBootRetryMarker(): boolean {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.has(BOOT_RETRY_QUERY_KEY);
}

function clearBootRetryMarker(): void {
  if (typeof window === "undefined" || !hasBootRetryMarker()) return;
  const url = new URL(window.location.href);
  url.searchParams.delete(BOOT_RETRY_QUERY_KEY);
  window.history.replaceState(window.history.state, "", url.toString());
}

function isRecoverableBootFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("BOOT_TIMEOUT") ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Failed to load module script")
  );
}

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
    clearBootRetryMarker();
    try {
      sessionStorage.removeItem(DEV_SW_CLEANUP_SESSION_KEY);
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
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

function clearOwnedStorageBucket(storage: Storage | undefined, preserveKeys: readonly string[] = []): void {
  if (!storage) return;

  try {
    const keys = [];
    for (let idx = 0; idx < storage.length; idx += 1) {
      const key = storage.key(idx);
      if (!key) continue;
      keys.push(key);
    }

    for (const key of keys) {
      if (preserveKeys.includes(key)) continue;
      if (!OWNED_STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage access failures.
  }
}

async function clearPersistedBrowserStateForRecovery(): Promise<void> {
  const tasks: Promise<unknown>[] = [
    secureClearAll().catch(() => undefined),
    deleteSecureCacheDatabase().catch(() => undefined),
  ];

  clearOwnedStorageBucket(
    typeof localStorage !== "undefined" ? localStorage : undefined,
    [],
  );
  clearOwnedStorageBucket(
    typeof sessionStorage !== "undefined" ? sessionStorage : undefined,
    [
      BOOT_READY_SESSION_KEY,
      DEV_SW_CLEANUP_SESSION_KEY,
      BOOT_RESET_DONE_SESSION_KEY,
    ],
  );

  await Promise.allSettled(tasks);
}

function forceRecoveryReload(): void {
  const url = new URL(window.location.href);
  url.searchParams.set(BOOT_RETRY_QUERY_KEY, String(Date.now()));
  window.location.replace(url.toString());
}

async function attemptAutomaticBootRecovery(error: unknown): Promise<boolean> {
  if (!isRecoverableBootFailure(error) || hasBootRetryMarker()) return false;
  console.warn("[boot] recoverable startup failure; refreshing shell caches", error);
  updateBootStatus("Refreshing platform cache...");
  await clearShellCachesForRecovery();
  await clearPersistedBrowserStateForRecovery();
  forceRecoveryReload();
  return true;
}

async function prepareDevBootEnvironment(): Promise<boolean> {
  if (typeof window === "undefined" || !import.meta.env.DEV || !("serviceWorker" in navigator)) {
    return true;
  }

  if (hasBootRetryMarker()) {
    try {
      if (sessionStorage.getItem(BOOT_RESET_DONE_SESSION_KEY) !== "1") {
        sessionStorage.setItem(BOOT_RESET_DONE_SESSION_KEY, "1");
        updateBootStatus("Resetting local platform state...");
        await clearShellCachesForRecovery();
        await clearPersistedBrowserStateForRecovery();
      }
    } catch {
      await clearShellCachesForRecovery();
      await clearPersistedBrowserStateForRecovery();
    }
  } else {
    try {
      sessionStorage.removeItem(BOOT_RESET_DONE_SESSION_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  const [registrations, cacheKeys] = await Promise.all([
    navigator.serviceWorker.getRegistrations().catch(() => [] as ServiceWorkerRegistration[]),
    "caches" in window ? caches.keys().catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);

  const hasShellCaches = cacheKeys.some((key) => key.startsWith(SHELL_CACHE_PREFIX));
  const isControlled = Boolean(navigator.serviceWorker.controller);
  if (!registrations.length && !hasShellCaches && !isControlled) {
    try {
      sessionStorage.removeItem(DEV_SW_CLEANUP_SESSION_KEY);
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
    return true;
  }

  await clearShellCachesForRecovery();

  if (!isControlled) return true;

  try {
    if (sessionStorage.getItem(DEV_SW_CLEANUP_SESSION_KEY) === "1") {
      return true;
    }
    sessionStorage.setItem(DEV_SW_CLEANUP_SESSION_KEY, "1");
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }

  updateBootStatus("Refreshing local shell cache...");
  forceRecoveryReload();
  return false;
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
    await clearPersistedBrowserStateForRecovery();
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
    void startApp().catch((error) => {
      void attemptAutomaticBootRecovery(error);
    });
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

  void startApp().catch((error) => {
    void attemptAutomaticBootRecovery(error);
  });
}

async function bootstrap(): Promise<void> {
  installServiceWorkerRegistration();
  if (!(await prepareDevBootEnvironment())) return;
  scheduleAppStart();
}

void bootstrap().catch((error) => {
  updateBootStatus("Interface failed to load. Click Open Platform to retry.");
  console.error("[boot] bootstrap failed", error);
});
