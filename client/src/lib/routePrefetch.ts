import {
  getPerfHints,
  resolvePerformanceSettings,
  tierPrefetchPlan,
  type PerfHints,
  type PerformanceSettings,
} from "@/lib/perfHints";

type ChunkImporter = () => Promise<unknown>;

type ChunkPrefetchTarget = {
  key: string;
  importer: ChunkImporter;
};

const PREFETCH_ORDER: ChunkPrefetchTarget[] = [
  { key: "QuotesScreen", importer: () => import("@/pages/QuotesScreen") },
  { key: "TradeScreen", importer: () => import("@/pages/TradeScreen") },
  { key: "ChartScreen", importer: () => import("@/pages/ChartScreen") },
  { key: "HistoryScreen", importer: () => import("@/pages/HistoryScreen") },
  { key: "AccountScreen", importer: () => import("@/pages/AccountScreen") },
  { key: "LeaderboardScreen", importer: () => import("@/pages/LeaderboardScreen") },
  { key: "JournalPage", importer: () => import("@/pages/JournalPage") },
  { key: "ProfileSettings", importer: () => import("@/pages/ProfileSettings") },
  { key: "PartnerPortal", importer: () => import("@/pages/PartnerPortal") },
];

const idleTimeoutMs = 2000;
const fallbackDelayMs = 100;

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

function scheduleIdleTask(task: () => void): void {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(task, { timeout: idleTimeoutMs });
    return;
  }
  window.setTimeout(task, fallbackDelayMs);
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

function runQueue(targets: ChunkPrefetchTarget[]): void {
  let index = 0;

  const scheduleNext = () => {
    if (index >= targets.length) return;
    const current = targets[index];
    index += 1;
    scheduleIdleTask(() => {
      void prefetchChunk(current).finally(scheduleNext);
    });
  };

  scheduleNext();
}

function runParallel(targets: ChunkPrefetchTarget[]): void {
  void Promise.all(targets.map((target) => prefetchChunk(target))).catch(() => undefined);
}

function resolveTargets(
  hints: PerfHints,
  settings: PerformanceSettings,
): { targets: ChunkPrefetchTarget[]; mode: "parallel" | "sequential"; startDelayMs: number } {
  const plan = tierPrefetchPlan(hints, settings);
  if (plan.mode === "none" || plan.count <= 0) {
    return { targets: [], mode: "sequential", startDelayMs: 0 };
  }

  const targets = PREFETCH_ORDER.slice(0, Math.min(PREFETCH_ORDER.length, plan.count));
  return {
    targets,
    mode: plan.mode,
    startDelayMs: plan.startDelayMs,
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
): string {
  return `${mode}:${startDelayMs}:${targets.map((target) => target.key).join("|")}`;
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
  const planKey = buildPlanKey(plan.targets, plan.mode, startDelayMs);
  if (scheduledPlanKey === planKey) return;
  scheduledPlanKey = planKey;
  clearScheduledStartTimer();

  const start = () => {
    scheduledStartTimer = null;
    scheduledPlanKey = null;
    if (plan.mode === "parallel") {
      runParallel(plan.targets);
      return;
    }
    runQueue(plan.targets);
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
