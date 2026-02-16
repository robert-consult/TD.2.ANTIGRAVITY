import type { QueryClient } from "@tanstack/react-query";
import { secureDelete, secureGet, securePut } from "@/lib/secureCache";
import { markFreshData, markStaleData } from "@/lib/staleData";

export const QUERY_PERSIST_SCHEMA_VERSION = 1;
export const QUERY_PERSIST_DEBOUNCE_MS = 500;
export const QUERY_PERSIST_HYDRATE_TIMEOUT_MS = 200;

export const PERSIST_QUERY_KEYS = [
  "/api/config/symbols",
  "/api/global-settings",
  "/api/account/summary",
  "/api/quote-subscriptions/allowed-symbols",
  "/api/auth/current-user",
  "/api/user",
  "/api/trades/open",
] as const;

const PERSIST_QUERY_KEY_SET = new Set<string>(PERSIST_QUERY_KEYS);

const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const QUERY_TTL_MS: Partial<Record<PersistableQueryKey, number>> = {
  "/api/config/symbols": ONE_DAY,
  "/api/global-settings": ONE_DAY,
  "/api/account/summary": 5 * ONE_MINUTE,
  "/api/quote-subscriptions/allowed-symbols": ONE_DAY,
  "/api/auth/current-user": ONE_DAY,
  "/api/user": ONE_DAY,
  "/api/trades/open": 5 * ONE_MINUTE,
};

type PersistableQueryKey = (typeof PERSIST_QUERY_KEYS)[number];

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
  ) {}

  async hydrate(): Promise<void> {
    if (!queryPersistenceEnabled()) return;
    const deadline = Date.now() + QUERY_PERSIST_HYDRATE_TIMEOUT_MS;

    for (const key of PERSIST_QUERY_KEYS) {
      if (Date.now() > deadline) break;
      const row = normalizePersistedEntry(await secureGet<PersistedQueryEntry>("query-cache", key));
      if (!row) continue;
      const maxAgeMs = QUERY_TTL_MS[key];
      if (maxAgeMs && Date.now() - row.updatedAt > maxAgeMs) {
        await secureDelete("query-cache", key);
        continue;
      }

      this.queryClient.setQueryData([key], row.data, { updatedAt: row.updatedAt });
      this.hydratedUpdatedAtByKey.set(key, row.updatedAt);
      markStaleData(key);
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

let queryPersistenceInstance: QueryPersistence | null = null;
let queryPersistenceHydrated = false;

export async function initializeQueryPersistence(queryClient: QueryClient): Promise<QueryPersistence | null> {
  if (!queryPersistenceEnabled()) return null;
  if (!queryPersistenceInstance) {
    queryPersistenceInstance = new QueryPersistence(queryClient);
  }
  if (!queryPersistenceHydrated) {
    queryPersistenceHydrated = true;
    await queryPersistenceInstance.hydrate();
  }
  return queryPersistenceInstance;
}

export function getQueryPersistence(): QueryPersistence | null {
  return queryPersistenceInstance;
}

export function resetQueryPersistenceForTests(): void {
  queryPersistenceHydrated = false;
  queryPersistenceInstance = null;
}
