import {
  getPerfHints,
  MAX_PREFETCH_CONCURRENCY,
  resolvePerformanceSettings,
  tierPrefetchPlan,
  type PerfHints,
  type PerformanceSettings,
} from "@/lib/perfHints";
import {
  PREFETCH_ROUTE_KEYS,
  SW_BURST_PREFETCH_MESSAGE,
  type PrefetchRouteKey,
} from "@/lib/prefetchCatalog";

type ChunkImporter = () => Promise<unknown>;

type ChunkPrefetchTarget = {
  key: PrefetchRouteKey;
  importer: ChunkImporter;
};

const PREFETCH_IMPORTERS: Record<PrefetchRouteKey, ChunkImporter> = {
  Dashboard: () => import("@/pages/Dashboard"),
  QuotesScreen: () => import("@/pages/QuotesScreen"),
  TradeScreen: () => import("@/pages/TradeScreen"),
  ChartScreen: () => import("@/pages/ChartScreen"),
  HistoryScreen: () => import("@/pages/HistoryScreen"),
  AccountScreen: () => import("@/pages/AccountScreen"),
  LeaderboardScreen: () => import("@/pages/LeaderboardScreen"),
  JournalPage: () => import("@/pages/JournalPage"),
  ProfileSettings: () => import("@/pages/ProfileSettings"),
  PartnerPortal: () => import("@/pages/PartnerPortal"),
};

const PREFETCH_ORDER: ChunkPrefetchTarget[] = PREFETCH_ROUTE_KEYS.map((key) => ({
  key,
  importer: PREFETCH_IMPORTERS[key],
}));

const prefetchedKeys = new Set<string>();
const inFlight = new Map<string, Promise<unknown>>();
let scheduledPlanKey: string | null = null;
let scheduledStartTimer: number | null = null;

type PrefetchAllRoutesOptions = {
  hints?: PerfHints;
  settings?: unknown;
  startDelayMs?: number;
};

function prefetchEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_PREFETCH;
  if (raw == null) return true;
  return String(raw).trim().toLowerCase() !== "false";
}

function prefetchChunk(target: ChunkPrefetchTarget): Promise<unknown> {
  if (prefetchedKeys.has(target.key)) {
    return Promise.resolve();
  }
  const existing = inFlight.get(target.key);
  if (existing) return existing;

  const task = target
    .importer()
    .catch(() => undefined)
    .finally(() => {
      prefetchedKeys.add(target.key);
      inFlight.delete(target.key);
    });

  inFlight.set(target.key, task);
  return task;
}

function runWithConcurrency(targets: ChunkPrefetchTarget[], maxConcurrency: number): void {
  const concurrency = Math.max(1, Math.min(maxConcurrency, targets.length));
  let cursor = 0;
  let active = 0;

  const launchNext = () => {
    while (active < concurrency && cursor < targets.length) {
      const target = targets[cursor++];
      active += 1;
      void prefetchChunk(target).finally(() => {
        active -= 1;
        launchNext();
      });
    }
  };

  launchNext();
}

function resolveTargets(
  hints: PerfHints,
  settings: PerformanceSettings,
): {
  targets: ChunkPrefetchTarget[];
  mode: "parallel" | "sequential";
  startDelayMs: number;
  maxConcurrency: number;
} {
  const plan = tierPrefetchPlan(hints, settings);
  if (plan.mode === "none" || plan.count <= 0) {
    return { targets: [], mode: "sequential", startDelayMs: 0, maxConcurrency: 1 };
  }

  const targets = PREFETCH_ORDER.slice(0, Math.min(PREFETCH_ORDER.length, plan.count));
  return {
    targets,
    mode: plan.mode,
    startDelayMs: plan.startDelayMs,
    maxConcurrency: Math.max(1, Math.min(plan.maxConcurrency, plan.count)),
  };
}

function clearScheduledStartTimer(): void {
  if (!scheduledStartTimer) return;
  clearTimeout(scheduledStartTimer);
  scheduledStartTimer = null;
}

function buildPlanKey(
  targets: ChunkPrefetchTarget[],
  mode: "parallel" | "sequential",
  startDelayMs: number,
  maxConcurrency: number,
): string {
  return `${mode}:${startDelayMs}:${maxConcurrency}:${targets.map((target) => target.key).join("|")}`;
}

function dispatchSwBurstPrefetch(targets: ChunkPrefetchTarget[], maxConcurrency: number): boolean {
  if (typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;

  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;

  const keys = targets.map((target) => target.key);
  if (!keys.length) return false;

  try {
    controller.postMessage({
      type: SW_BURST_PREFETCH_MESSAGE,
      payload: {
        keys,
        concurrency: Math.max(1, Math.min(MAX_PREFETCH_CONCURRENCY, Math.round(maxConcurrency))),
      },
    });
    return true;
  } catch {
    return false;
  }
}

export function prefetchAllRoutes(options: PrefetchAllRoutesOptions = {}): void {
  if (!prefetchEnabled() || typeof window === "undefined") return;

  const hints = options.hints ?? getPerfHints();
  if (hints.saveData) {
    scheduledPlanKey = null;
    clearScheduledStartTimer();
    return;
  }

  const settings = resolvePerformanceSettings(options.settings);
  const plan = resolveTargets(hints, settings);
  if (!plan.targets.length) {
    scheduledPlanKey = null;
    clearScheduledStartTimer();
    return;
  }

  const startDelayMs = Math.max(0, Math.round(options.startDelayMs ?? plan.startDelayMs));
  const maxConcurrency = plan.mode === "sequential" ? 1 : plan.maxConcurrency;
  const planKey = buildPlanKey(plan.targets, plan.mode, startDelayMs, maxConcurrency);
  if (scheduledPlanKey === planKey) return;
  scheduledPlanKey = planKey;
  clearScheduledStartTimer();

  const start = () => {
    scheduledStartTimer = null;
    scheduledPlanKey = null;

    if (dispatchSwBurstPrefetch(plan.targets, maxConcurrency)) {
      return;
    }

    runWithConcurrency(plan.targets, maxConcurrency);
  };

  if (startDelayMs <= 0) {
    start();
    return;
  }

  scheduledStartTimer = window.setTimeout(start, startDelayMs);
}

export function resetRoutePrefetchForTests(): void {
  scheduledPlanKey = null;
  clearScheduledStartTimer();
  prefetchedKeys.clear();
  inFlight.clear();
}
