import type { QueryClient } from "@tanstack/react-query";
import {
  getPerfHints,
  resolvePerformanceSettings,
  tierPrefetchPlan,
  type PerfHints,
} from "@/lib/perfHints";
import { getQueryFn } from "@/lib/queryClient";

export type StartupDataPrefetchPhase = "public" | "authenticated";

type StartupDataPrefetchOptions = {
  queryClient: QueryClient;
  phase?: StartupDataPrefetchPhase;
  hints?: PerfHints;
  settings?: unknown;
  startDelayMs?: number;
};

const PUBLIC_STARTUP_QUERY_KEYS = [
  "/api/global-settings",
  "/api/config/symbols",
] as const;

const AUTHENTICATED_STARTUP_QUERY_KEYS = [
  ...PUBLIC_STARTUP_QUERY_KEYS,
  "/api/auth/current-user",
  "/api/user",
  "/api/quote-subscriptions/allowed-symbols",
  "/api/quote-subscriptions/me",
  "/api/account/summary",
  "/api/trades/open",
  "/api/trades/pending",
  "/api/trades",
  "/api/trader/leaderboard-mode",
] as const;

const AUTHENTICATED_QUOTE_PRIORITY_KEYS = [
  "/api/quote-subscriptions/allowed-symbols",
  "/api/quote-subscriptions/me",
  "/api/account/summary",
] as const;

const STARTUP_STALE_TIME_MS_BY_KEY: Record<string, number> = {
  "/api/global-settings": 30_000,
  "/api/config/symbols": 60_000,
  "/api/auth/current-user": 15_000,
  "/api/user": 15_000,
  "/api/account/summary": 5_000,
  "/api/quote-subscriptions/allowed-symbols": 10_000,
  "/api/quote-subscriptions/me": 5_000,
  "/api/trades/open": 5_000,
  "/api/trades/pending": 5_000,
  "/api/trades": 10_000,
  "/api/trader/leaderboard-mode": 30_000,
  "/api/quotes/latest": 3_000,
};

const DEFAULT_STARTUP_STALE_TIME_MS = 15_000;
const PLAN_DEDUP_WINDOW_MS = 15_000;

type CompletedPlanState = {
  key: string;
  atMs: number;
};

type AllowedSymbolsPayload = {
  symbols?: Array<{ symbol?: string }>;
};

let scheduledPlanByPhase: Partial<Record<StartupDataPrefetchPhase, string>> = {};
let scheduledStartTimerByPhase: Partial<Record<StartupDataPrefetchPhase, number>> = {};
let completedPlanByPhase: Partial<Record<StartupDataPrefetchPhase, CompletedPlanState>> = {};
const queryPrefetchInFlight = new Map<string, Promise<void>>();

function startupStaleTimeMs(key: string): number {
  return STARTUP_STALE_TIME_MS_BY_KEY[key] ?? DEFAULT_STARTUP_STALE_TIME_MS;
}

function clearScheduledStart(phase: StartupDataPrefetchPhase): void {
  const timer = scheduledStartTimerByPhase[phase];
  if (typeof timer !== "number") return;
  clearTimeout(timer);
  delete scheduledStartTimerByPhase[phase];
}

async function runWithConcurrency<T>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;

  const concurrency = Math.max(1, Math.min(Math.round(maxConcurrency), items.length));
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
}

function unauthorizedBehaviorForKey(_key: string): "throw" {
  return "throw";
}

async function prefetchQueryWithDedupe(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  unauthorizedBehavior: "throw",
): Promise<void> {
  const mapKey = `${unauthorizedBehavior}:${JSON.stringify(queryKey)}`;
  const existing = queryPrefetchInFlight.get(mapKey);
  if (existing) {
    await existing;
    return;
  }

  const url = String(queryKey[0] ?? "");
  const task = queryClient
    .prefetchQuery({
      queryKey,
      queryFn: getQueryFn({ on401: unauthorizedBehavior }),
      staleTime: startupStaleTimeMs(url),
    })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      queryPrefetchInFlight.delete(mapKey);
    });

  queryPrefetchInFlight.set(mapKey, task);
  await task;
}

function extractAllowedSymbols(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const candidate = payload as AllowedSymbolsPayload;
  if (!Array.isArray(candidate.symbols)) return [];

  const symbols: string[] = [];
  for (const row of candidate.symbols) {
    const symbol = String(row?.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    symbols.push(symbol);
  }
  return symbols;
}

async function prefetchLatestQuotesForAllowedSymbols(queryClient: QueryClient): Promise<void> {
  const allowedSymbolsData = queryClient.getQueryData(["/api/quote-subscriptions/allowed-symbols"]);
  const symbols = extractAllowedSymbols(allowedSymbolsData);
  if (!symbols.length) return;

  await prefetchQueryWithDedupe(
    queryClient,
    ["/api/quotes/latest", symbols],
    "throw",
  );
}

function resolveAuthenticatedKeyLimit(hints: PerfHints): number {
  if (hints.networkTier === "INSTANT" || hints.networkTier === "FAST") {
    return AUTHENTICATED_STARTUP_QUERY_KEYS.length;
  }
  if (hints.networkTier === "MODERATE") return 9;
  if (hints.networkTier === "CONSTRAINED") return 7;
  return 0;
}

function resolveQueryKeysForPhase(
  phase: StartupDataPrefetchPhase,
  hints: PerfHints,
): readonly string[] {
  if (phase === "public") return PUBLIC_STARTUP_QUERY_KEYS;

  let limit = resolveAuthenticatedKeyLimit(hints);
  if (hints.deviceTier === "CONSTRAINED") {
    limit = Math.min(limit, 8);
  }
  if (hints.deviceTier === "MINIMAL") {
    limit = 0;
  }

  return AUTHENTICATED_STARTUP_QUERY_KEYS.slice(
    0,
    Math.max(0, Math.min(limit, AUTHENTICATED_STARTUP_QUERY_KEYS.length)),
  );
}

function buildPlanKey(
  phase: StartupDataPrefetchPhase,
  queryKeys: readonly string[],
  startDelayMs: number,
  maxConcurrency: number,
): string {
  return `${phase}:${startDelayMs}:${maxConcurrency}:${queryKeys.join("|")}`;
}

async function runStartupDataPrefetch(
  queryClient: QueryClient,
  phase: StartupDataPrefetchPhase,
  queryKeys: readonly string[],
  maxConcurrency: number,
): Promise<void> {
  if (phase === "authenticated") {
    const priorityKeys = AUTHENTICATED_QUOTE_PRIORITY_KEYS.filter((key) => queryKeys.includes(key));
    for (const key of priorityKeys) {
      await prefetchQueryWithDedupe(
        queryClient,
        [key],
        unauthorizedBehaviorForKey(key),
      );
    }

    await prefetchLatestQuotesForAllowedSymbols(queryClient);

    const priorityKeySet = new Set<string>(priorityKeys);
    const remainingKeys = queryKeys.filter((key) => !priorityKeySet.has(key));
    if (!remainingKeys.length) return;

    await runWithConcurrency(remainingKeys, maxConcurrency, async (key) => {
      await prefetchQueryWithDedupe(
        queryClient,
        [key],
        unauthorizedBehaviorForKey(key),
      );
    });
    return;
  }

  await runWithConcurrency(queryKeys, maxConcurrency, async (key) => {
    await prefetchQueryWithDedupe(
      queryClient,
      [key],
      unauthorizedBehaviorForKey(key),
    );
  });
}

export function prefetchStartupData(options: StartupDataPrefetchOptions): void {
  if (typeof window === "undefined") return;

  const phase = options.phase ?? "public";
  const hints = options.hints ?? getPerfHints();
  if (hints.saveData) {
    delete scheduledPlanByPhase[phase];
    clearScheduledStart(phase);
    return;
  }

  const settings = resolvePerformanceSettings(options.settings);
  const prefetchPlan = tierPrefetchPlan(hints, settings);
  if (prefetchPlan.mode === "none" || prefetchPlan.count <= 0) {
    delete scheduledPlanByPhase[phase];
    clearScheduledStart(phase);
    return;
  }

  const queryKeys = resolveQueryKeysForPhase(phase, hints);
  if (!queryKeys.length) {
    delete scheduledPlanByPhase[phase];
    clearScheduledStart(phase);
    return;
  }

  const startDelayMs = Math.max(0, Math.round(options.startDelayMs ?? prefetchPlan.startDelayMs));
  const maxConcurrency =
    prefetchPlan.mode === "sequential"
      ? 1
      : Math.max(1, Math.min(prefetchPlan.maxConcurrency, queryKeys.length));

  const planKey = buildPlanKey(phase, queryKeys, startDelayMs, maxConcurrency);
  const completedPlan = completedPlanByPhase[phase];
  if (
    completedPlan &&
    completedPlan.key === planKey &&
    Date.now() - completedPlan.atMs < PLAN_DEDUP_WINDOW_MS
  ) {
    return;
  }

  if (scheduledPlanByPhase[phase] === planKey) return;
  scheduledPlanByPhase[phase] = planKey;
  clearScheduledStart(phase);

  const start = () => {
    delete scheduledPlanByPhase[phase];
    clearScheduledStart(phase);

    void runStartupDataPrefetch(
      options.queryClient,
      phase,
      queryKeys,
      maxConcurrency,
    ).finally(() => {
      completedPlanByPhase[phase] = {
        key: planKey,
        atMs: Date.now(),
      };
    });
  };

  if (startDelayMs <= 0) {
    start();
    return;
  }

  scheduledStartTimerByPhase[phase] = window.setTimeout(start, startDelayMs);
}

export function resetStartupDataPrefetchForTests(): void {
  for (const phase of ["public", "authenticated"] as const) {
    clearScheduledStart(phase);
  }
  scheduledPlanByPhase = {};
  completedPlanByPhase = {};
  queryPrefetchInFlight.clear();
}
