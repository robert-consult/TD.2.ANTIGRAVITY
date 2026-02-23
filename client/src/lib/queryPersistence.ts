import type { QueryClient } from "@tanstack/react-query";
import { secureDelete, secureGet, securePut } from "@/lib/secureCache";
import { markFreshData, markStaleData } from "@/lib/staleData";
import { getPerfHints, tierHydrationTimeoutMs } from "@/lib/perfHints";

export const QUERY_PERSIST_SCHEMA_VERSION = 1;
export const QUERY_PERSIST_DEBOUNCE_MS = 500;
export const QUERY_PERSIST_HYDRATE_TIMEOUT_MS_DEFAULT = 300;

export const PERSIST_QUERY_KEYS = [
  "/api/config/symbols",
  "/api/global-settings",
  "/api/account/summary",
  "/api/quote-subscriptions/allowed-symbols",
  "/api/quote-subscriptions/me",
  "/api/auth/current-user",
  "/api/user",
  "/api/trades/open",
  "/api/trades/pending",
  "/api/trader/leaderboard-mode",
] as const;

type PersistableQueryKey = (typeof PERSIST_QUERY_KEYS)[number];

const PERSIST_QUERY_KEY_SET = new Set<string>(PERSIST_QUERY_KEYS);
// Keep a single ordered source for hydration priority so essential keys
// cannot drift behind non-essential keys by mistake.
const ESSENTIAL_HYDRATION_KEYS_IN_ORDER: readonly PersistableQueryKey[] = [
  "/api/auth/current-user",
  "/api/user",
  "/api/global-settings",
];
const ESSENTIAL_HYDRATION_KEYS = new Set<PersistableQueryKey>(ESSENTIAL_HYDRATION_KEYS_IN_ORDER);
const HYDRATION_QUERY_KEYS: readonly PersistableQueryKey[] = [
  ...ESSENTIAL_HYDRATION_KEYS_IN_ORDER,
  "/api/config/symbols",
  "/api/quote-subscriptions/allowed-symbols",
  "/api/quote-subscriptions/me",
  "/api/account/summary",
  "/api/trades/open",
  "/api/trades/pending",
  "/api/trader/leaderboard-mode",
];

const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const QUERY_TTL_MS: Partial<Record<PersistableQueryKey, number>> = {
  "/api/config/symbols": ONE_DAY,
  "/api/global-settings": ONE_DAY,
  "/api/account/summary": 5 * ONE_MINUTE,
  "/api/quote-subscriptions/allowed-symbols": ONE_DAY,
  "/api/quote-subscriptions/me": 5 * ONE_MINUTE,
  "/api/auth/current-user": ONE_DAY,
  "/api/user": ONE_DAY,
  "/api/trades/open": 5 * ONE_MINUTE,
  "/api/trades/pending": 5 * ONE_MINUTE,
  "/api/trader/leaderboard-mode": ONE_HOUR,
};

type PersistedQueryEntry = {
  schemaVersion: number;
  data: unknown;
  updatedAt: number;
};

function queryPersistenceEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_QUERY_PERSISTENCE;
  if (raw == null) return true;
  return String(raw).trim().toLowerCase() !== "false";
}

function normalizePersistableKey(key: unknown): PersistableQueryKey | null {
  if (typeof key !== "string") return null;
  return PERSIST_QUERY_KEY_SET.has(key) ? (key as PersistableQueryKey) : null;
}

function normalizePersistedEntry(value: unknown): PersistedQueryEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PersistedQueryEntry>;
  if (Number(row.schemaVersion) !== QUERY_PERSIST_SCHEMA_VERSION) return null;
  if (!("data" in row)) return null;
  const updatedAt = Number(row.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return {
    schemaVersion: QUERY_PERSIST_SCHEMA_VERSION,
    data: row.data,
    updatedAt,
  };
}

export class QueryPersistence {
  private hydratedUpdatedAtByKey = new Map<PersistableQueryKey, number>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistInFlight = false;

  constructor(
    private readonly queryClient: QueryClient,
  ) { }

  private async loadHydrationEntry(
    key: PersistableQueryKey,
    nowMs: number,
  ): Promise<PersistedQueryEntry | null> {
    const row = normalizePersistedEntry(await secureGet<PersistedQueryEntry>("query-cache", key));
    if (!row) return null;
    const maxAgeMs = QUERY_TTL_MS[key];
    if (maxAgeMs && nowMs - row.updatedAt > maxAgeMs) {
      await secureDelete("query-cache", key);
      return null;
    }
    return row;
  }

  private hydrateEntry(key: PersistableQueryKey, row: PersistedQueryEntry): void {
    this.queryClient.setQueryData([key], row.data, { updatedAt: row.updatedAt });
    this.hydratedUpdatedAtByKey.set(key, row.updatedAt);
    markStaleData(key);
  }

  async hydrate(): Promise<void> {
    if (!queryPersistenceEnabled()) return;
    const hydrateBudgetMs = Math.max(
      QUERY_PERSIST_HYDRATE_TIMEOUT_MS_DEFAULT,
      getQueryPersistHydrateTimeoutMs(),
    );
    const deadline = Date.now() + hydrateBudgetMs;

    const essentialNowMs = Date.now();
    const essentialRows = await Promise.all(
      ESSENTIAL_HYDRATION_KEYS_IN_ORDER.map((key) => this.loadHydrationEntry(key, essentialNowMs)),
    );
    for (let i = 0; i < ESSENTIAL_HYDRATION_KEYS_IN_ORDER.length; i += 1) {
      const key = ESSENTIAL_HYDRATION_KEYS_IN_ORDER[i];
      const row = essentialRows[i];
      if (!row) continue;
      this.hydrateEntry(key, row);
    }

    for (const key of HYDRATION_QUERY_KEYS) {
      if (ESSENTIAL_HYDRATION_KEYS.has(key)) continue;
      if (Date.now() > deadline) break;
      const row = await this.loadHydrationEntry(key, Date.now());
      if (!row) continue;
      this.hydrateEntry(key, row);
    }
  }

  subscribe(): () => void {
    if (!queryPersistenceEnabled()) return () => undefined;

    const unsubscribe = this.queryClient.getQueryCache().subscribe((event) => {
      const persistedKey = normalizePersistableKey(event?.query?.queryKey?.[0]);
      if (persistedKey) {
        const updatedAt = Number(event.query?.state?.dataUpdatedAt ?? 0);
        const hydratedUpdatedAt = this.hydratedUpdatedAtByKey.get(persistedKey);
        if (hydratedUpdatedAt && updatedAt > hydratedUpdatedAt) {
          this.hydratedUpdatedAtByKey.delete(persistedKey);
          markFreshData(persistedKey);
        }
      }
      this.schedulePersist();
    });

    return () => {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      unsubscribe();
    };
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistAll();
    }, QUERY_PERSIST_DEBOUNCE_MS);
  }

  private async persistAll(): Promise<void> {
    if (!queryPersistenceEnabled() || this.persistInFlight) return;
    this.persistInFlight = true;

    try {
      for (const key of PERSIST_QUERY_KEYS) {
        const state = this.queryClient.getQueryState([key]);
        if (!state || typeof state.data === "undefined") continue;

        await securePut<PersistedQueryEntry>("query-cache", key, {
          schemaVersion: QUERY_PERSIST_SCHEMA_VERSION,
          data: state.data,
          updatedAt: Number(state.dataUpdatedAt || Date.now()),
        });
      }
    } finally {
      this.persistInFlight = false;
    }
  }
}

export function getQueryPersistHydrateTimeoutMs(): number {
  try {
    return tierHydrationTimeoutMs(getPerfHints());
  } catch {
    return QUERY_PERSIST_HYDRATE_TIMEOUT_MS_DEFAULT;
  }
}

let queryPersistenceInstance: QueryPersistence | null = null;
let queryPersistenceHydrated = false;
const queryPersistenceReadyListeners = new Set<(instance: QueryPersistence) => void>();

function notifyQueryPersistenceReady(instance: QueryPersistence): void {
  for (const listener of Array.from(queryPersistenceReadyListeners)) {
    try {
      listener(instance);
    } catch {
      // Ignore listener failures to avoid breaking bootstrap.
    }
  }
}

export async function initializeQueryPersistence(queryClient: QueryClient): Promise<QueryPersistence | null> {
  if (!queryPersistenceEnabled()) return null;
  if (!queryPersistenceInstance) {
    queryPersistenceInstance = new QueryPersistence(queryClient);
  }
  if (!queryPersistenceHydrated) {
    await queryPersistenceInstance.hydrate();
    queryPersistenceHydrated = true;
    notifyQueryPersistenceReady(queryPersistenceInstance);
  }
  return queryPersistenceInstance;
}

export function getQueryPersistence(): QueryPersistence | null {
  return queryPersistenceInstance;
}

export function subscribeQueryPersistenceReady(
  listener: (instance: QueryPersistence) => void,
): () => void {
  if (queryPersistenceInstance && queryPersistenceHydrated) {
    listener(queryPersistenceInstance);
    return () => undefined;
  }

  queryPersistenceReadyListeners.add(listener);
  return () => {
    queryPersistenceReadyListeners.delete(listener);
  };
}

export function resetQueryPersistenceForTests(): void {
  queryPersistenceHydrated = false;
  queryPersistenceInstance = null;
  queryPersistenceReadyListeners.clear();
}
