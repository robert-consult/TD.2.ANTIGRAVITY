import { getPerfHints } from "@/lib/perfHints";

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
let scheduled = false;

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

export function prefetchAllRoutes(): void {
  if (!prefetchEnabled() || typeof window === "undefined") return;
  if (scheduled) return;

  const hints = getPerfHints();
  if (hints.saveData) return;

  const severelyConstrained =
    hints.isConstrained && (hints.effectiveType === "slow-2g" || hints.effectiveType === "2g");
  const targets = severelyConstrained ? PREFETCH_ORDER.slice(0, 3) : PREFETCH_ORDER;
  scheduled = true;
  runQueue(targets);
}

export function resetRoutePrefetchForTests(): void {
  scheduled = false;
  prefetchedKeys.clear();
  inFlight.clear();
}
