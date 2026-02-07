import { db, dbClient } from "@db";
import {
  quoteSubscriptionConfig,
  symbolConfigs,
  traderQuotePrefs,
  traderQuoteSubscriptions,
} from "@shared/schema";
import {
  DEFAULT_GLOBAL_QUOTE_MODE,
  DEFAULT_QUOTE_MODE,
  isQuoteMode,
  quoteModeIncludesBaseline,
  quoteModeSupportsCustom,
  type QuoteMode,
} from "@shared/quoteSubscriptions";
import { asc, eq, inArray } from "drizzle-orm";
import { onLiveEvent, publishLiveEvent } from "./liveBus";

const QUOTE_SUBSCRIPTIONS_CACHE_TTL_MS = Number(process.env.QUOTE_SUBSCRIPTIONS_CACHE_TTL_MS ?? 5_000);

type QuoteSubscriptionsConfigState = {
  globalEnabled: boolean;
  defaultMode: QuoteMode;
  updatedAt: number | null;
  updatedBy: string | null;
};

export type AllowedQuoteSymbolConfig = {
  id: number;
  symbol: string;
  name: string;
  category: string | null;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  pipDecimals: number | null;
  quoteDecimals: number | null;
  enabled: boolean;
};

export type CustomUniverseInstrument = {
  symbol: string;
  providerSymbolMapJson: string | null;
};

type CacheEntry<T> = {
  fetchedAtMs: number;
  value: T;
};

let subscribed = false;
let configCache: CacheEntry<QuoteSubscriptionsConfigState> | null = null;
let configInflight: Promise<QuoteSubscriptionsConfigState> | null = null;
let baselineCache: CacheEntry<AllowedQuoteSymbolConfig[]> | null = null;
let baselineInflight: Promise<AllowedQuoteSymbolConfig[]> | null = null;
let customUniverseCache: CacheEntry<CustomUniverseInstrument[]> | null = null;
let customUniverseInflight: Promise<CustomUniverseInstrument[]> | null = null;
const effectiveModeCache = new Map<number, CacheEntry<QuoteMode>>();
const allowedSymbolsCache = new Map<number, CacheEntry<AllowedQuoteSymbolConfig[]>>();

function nowMs() {
  return Date.now();
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function isFresh(entry: CacheEntry<unknown> | null): boolean {
  if (!entry) return false;
  return nowMs() - entry.fetchedAtMs < QUOTE_SUBSCRIPTIONS_CACHE_TTL_MS;
}

function normalizeQuoteMode(value: unknown, fallback: QuoteMode = DEFAULT_QUOTE_MODE): QuoteMode {
  return isQuoteMode(value) ? value : fallback;
}

function clearCaches() {
  configCache = null;
  baselineCache = null;
  customUniverseCache = null;
  effectiveModeCache.clear();
  allowedSymbolsCache.clear();
}

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  onLiveEvent((event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "symbols:updated" || event.type === "quote-subscriptions:updated") {
      clearCaches();
    }
  });
}

function buildConfigFallback(): QuoteSubscriptionsConfigState {
  return {
    globalEnabled: false,
    defaultMode: DEFAULT_GLOBAL_QUOTE_MODE,
    updatedAt: null,
    updatedBy: null,
  };
}

export async function getQuoteSubscriptionsConfig(): Promise<QuoteSubscriptionsConfigState> {
  ensureSubscribed();

  if (isFresh(configCache)) {
    return configCache!.value;
  }

  if (configInflight) return configInflight;

  configInflight = (async () => {
    try {
      const row = await db.query.quoteSubscriptionConfig.findFirst({
        where: eq(quoteSubscriptionConfig.id, 1),
      });

      const value: QuoteSubscriptionsConfigState = {
        globalEnabled: Boolean(row?.globalEnabled ?? false),
        defaultMode: normalizeQuoteMode(row?.defaultMode, DEFAULT_GLOBAL_QUOTE_MODE),
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };

      configCache = { fetchedAtMs: nowMs(), value };
      return value;
    } catch {
      const fallback = configCache?.value ?? buildConfigFallback();
      configCache = { fetchedAtMs: nowMs(), value: fallback };
      return fallback;
    } finally {
      configInflight = null;
    }
  })();

  return configInflight;
}

async function getBaselineSymbolConfigs(): Promise<AllowedQuoteSymbolConfig[]> {
  ensureSubscribed();

  if (isFresh(baselineCache)) {
    return baselineCache!.value;
  }

  if (baselineInflight) return baselineInflight;

  baselineInflight = (async () => {
    try {
      const rows = await db
        .select({
          id: symbolConfigs.id,
          symbol: symbolConfigs.symbol,
          name: symbolConfigs.name,
          category: symbolConfigs.category,
          baseCurrency: symbolConfigs.baseCurrency,
          quoteCurrency: symbolConfigs.quoteCurrency,
          pipDecimals: symbolConfigs.pipDecimals,
          quoteDecimals: symbolConfigs.quoteDecimals,
          enabled: symbolConfigs.enabled,
        })
        .from(symbolConfigs)
        .where(eq(symbolConfigs.enabled, true))
        .orderBy(asc(symbolConfigs.symbol));

      const value = rows.map((row) => ({
        ...row,
        symbol: String(row.symbol).toUpperCase(),
      }));

      baselineCache = { fetchedAtMs: nowMs(), value };
      return value;
    } catch {
      const fallback = baselineCache?.value ?? [];
      baselineCache = { fetchedAtMs: nowMs(), value: fallback };
      return fallback;
    } finally {
      baselineInflight = null;
    }
  })();

  return baselineInflight;
}

async function getCustomSymbolConfigsForUser(userId: number): Promise<AllowedQuoteSymbolConfig[]> {
  const rows = await db
    .select({
      id: symbolConfigs.id,
      symbol: symbolConfigs.symbol,
      name: symbolConfigs.name,
      category: symbolConfigs.category,
      baseCurrency: symbolConfigs.baseCurrency,
      quoteCurrency: symbolConfigs.quoteCurrency,
      pipDecimals: symbolConfigs.pipDecimals,
      quoteDecimals: symbolConfigs.quoteDecimals,
      enabled: symbolConfigs.enabled,
    })
    .from(traderQuoteSubscriptions)
    .innerJoin(symbolConfigs, eq(symbolConfigs.id, traderQuoteSubscriptions.symbolId))
    .where(eq(traderQuoteSubscriptions.userId, userId))
    .orderBy(asc(symbolConfigs.symbol));

  return rows.map((row) => ({
    ...row,
    symbol: String(row.symbol).toUpperCase(),
  }));
}

function resolveEffectiveMode(overrideMode: unknown, config: QuoteSubscriptionsConfigState): QuoteMode {
  const normalizedOverride = isQuoteMode(overrideMode) ? overrideMode : null;
  if (normalizedOverride) return normalizedOverride;
  return config.globalEnabled ? config.defaultMode : DEFAULT_QUOTE_MODE;
}

export async function getUserQuoteMode(userId: number): Promise<QuoteMode> {
  ensureSubscribed();
  const cached = effectiveModeCache.get(userId);
  if (cached && nowMs() - cached.fetchedAtMs < QUOTE_SUBSCRIPTIONS_CACHE_TTL_MS) {
    return cached.value;
  }

  const [config, pref] = await Promise.all([
    getQuoteSubscriptionsConfig(),
    db.query.traderQuotePrefs.findFirst({ where: eq(traderQuotePrefs.userId, userId) }),
  ]);

  const mode = resolveEffectiveMode(pref?.quoteMode, config);
  effectiveModeCache.set(userId, { fetchedAtMs: nowMs(), value: mode });
  return mode;
}

export async function getUserQuoteModeSummary(userId: number): Promise<{
  overrideMode: QuoteMode | null;
  effectiveMode: QuoteMode;
  supportsCustom: boolean;
  includesBaseline: boolean;
}> {
  const [config, pref] = await Promise.all([
    getQuoteSubscriptionsConfig(),
    db.query.traderQuotePrefs.findFirst({ where: eq(traderQuotePrefs.userId, userId) }),
  ]);

  const overrideMode = isQuoteMode(pref?.quoteMode) ? pref!.quoteMode : null;
  const effectiveMode = resolveEffectiveMode(overrideMode, config);

  return {
    overrideMode,
    effectiveMode,
    supportsCustom: quoteModeSupportsCustom(effectiveMode),
    includesBaseline: quoteModeIncludesBaseline(effectiveMode),
  };
}

export async function getUserQuoteSubscriptions(userId: number): Promise<AllowedQuoteSymbolConfig[]> {
  return getCustomSymbolConfigsForUser(userId);
}

export async function getAllowedSymbolConfigsForUser(userId: number | null): Promise<AllowedQuoteSymbolConfig[]> {
  ensureSubscribed();

  if (!userId || !Number.isFinite(userId) || userId <= 0) {
    return getBaselineSymbolConfigs();
  }

  const cacheKey = Math.trunc(userId);
  const cached = allowedSymbolsCache.get(cacheKey);
  if (cached && nowMs() - cached.fetchedAtMs < QUOTE_SUBSCRIPTIONS_CACHE_TTL_MS) {
    return cached.value;
  }

  const mode = await getUserQuoteMode(cacheKey);
  const tasks: Array<Promise<AllowedQuoteSymbolConfig[]>> = [];

  if (quoteModeIncludesBaseline(mode)) {
    tasks.push(getBaselineSymbolConfigs());
  }

  if (quoteModeSupportsCustom(mode)) {
    tasks.push(getCustomSymbolConfigsForUser(cacheKey));
  }

  const chunks = tasks.length ? await Promise.all(tasks) : [];
  const deduped = new Map<string, AllowedQuoteSymbolConfig>();

  for (const chunk of chunks) {
    for (const row of chunk) {
      const symbol = String(row.symbol).toUpperCase();
      if (!symbol) continue;
      deduped.set(symbol, { ...row, symbol });
    }
  }

  const value = Array.from(deduped.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  allowedSymbolsCache.set(cacheKey, { fetchedAtMs: nowMs(), value });
  return value;
}

export async function getAllowedSymbolsForUser(userId: number | null): Promise<Set<string>> {
  const rows = await getAllowedSymbolConfigsForUser(userId);
  return new Set(rows.map((row) => String(row.symbol).toUpperCase()));
}

export async function getCustomUniverseInstruments(): Promise<CustomUniverseInstrument[]> {
  ensureSubscribed();

  if (isFresh(customUniverseCache)) {
    return customUniverseCache!.value;
  }

  if (customUniverseInflight) return customUniverseInflight;

  customUniverseInflight = (async () => {
    try {
      const result = await dbClient.query(
        `
        SELECT DISTINCT
          sc.symbol,
          sc.provider_symbol_map_json AS "providerSymbolMapJson"
        FROM trader_quote_subscriptions tqs
        JOIN symbol_configs sc ON sc.id = tqs.symbol_id
        LEFT JOIN trader_quote_prefs tqp ON tqp.user_id = tqs.user_id
        LEFT JOIN quote_subscription_config qsc ON qsc.id = 1
        WHERE COALESCE(
          tqp.quote_mode,
          CASE
            WHEN COALESCE(qsc.global_enabled, false)
              THEN COALESCE(qsc.default_mode, 'BASIC_PLUS_CUSTOM')
            ELSE 'BASIC_ONLY'
          END
        ) IN ('BASIC_PLUS_CUSTOM', 'CUSTOM_ONLY')
        ORDER BY sc.symbol ASC
        `,
      );

      const value = result.rows
        .map((row: any) => ({
          symbol: String(row.symbol ?? "").toUpperCase(),
          providerSymbolMapJson:
            row.providerSymbolMapJson != null ? String(row.providerSymbolMapJson) : null,
        }))
        .filter((row) => row.symbol.length > 0);

      customUniverseCache = { fetchedAtMs: nowMs(), value };
      return value;
    } catch {
      const fallback = customUniverseCache?.value ?? [];
      customUniverseCache = { fetchedAtMs: nowMs(), value: fallback };
      return fallback;
    } finally {
      customUniverseInflight = null;
    }
  })();

  return customUniverseInflight;
}

export async function upsertQuoteSubscriptionsConfig(params: {
  globalEnabled: boolean;
  defaultMode: QuoteMode;
  updatedBy?: string | null;
}) {
  const nowSec = nowUnix();

  await db
    .insert(quoteSubscriptionConfig)
    .values({
      id: 1,
      globalEnabled: Boolean(params.globalEnabled),
      defaultMode: params.defaultMode,
      updatedAt: nowSec,
      updatedBy: params.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: quoteSubscriptionConfig.id,
      set: {
        globalEnabled: Boolean(params.globalEnabled),
        defaultMode: params.defaultMode,
        updatedAt: nowSec,
        updatedBy: params.updatedBy ?? null,
      },
    });

  notifyQuoteSubscriptionsUpdated({ type: "config" });
}

export async function setUserQuoteMode(userId: number, mode: QuoteMode) {
  const nowSec = nowUnix();

  await db
    .insert(traderQuotePrefs)
    .values({
      userId,
      quoteMode: mode,
      updatedAt: nowSec,
    })
    .onConflictDoUpdate({
      target: traderQuotePrefs.userId,
      set: {
        quoteMode: mode,
        updatedAt: nowSec,
      },
    });

  notifyQuoteSubscriptionsUpdated({ type: "mode", userIds: [userId] });
}

export async function setUsersQuoteMode(userIds: number[], mode: QuoteMode | null) {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) return;

  const nowSec = nowUnix();

  await db.transaction(async (tx) => {
    if (mode === null) {
      await tx.delete(traderQuotePrefs).where(inArray(traderQuotePrefs.userId, uniqueIds));
      return;
    }

    const rows = uniqueIds.map((userId) => ({ userId, quoteMode: mode, updatedAt: nowSec }));
    await tx
      .insert(traderQuotePrefs)
      .values(rows)
      .onConflictDoUpdate({
        target: traderQuotePrefs.userId,
        set: {
          quoteMode: mode,
          updatedAt: nowSec,
        },
      });
  });

  notifyQuoteSubscriptionsUpdated({ type: "bulk-mode", userIds: uniqueIds });
}

export async function clearUserQuoteModeOverride(userId: number) {
  await db.delete(traderQuotePrefs).where(eq(traderQuotePrefs.userId, userId));
  notifyQuoteSubscriptionsUpdated({ type: "mode-clear", userIds: [userId] });
}

export async function setUserQuoteSubscriptionsBySymbolIds(userId: number, symbolIds: number[]) {
  const uniqueSymbolIds = Array.from(new Set(symbolIds.filter((id) => Number.isInteger(id) && id > 0)));

  if (uniqueSymbolIds.length) {
    const validRows = await db
      .select({ id: symbolConfigs.id })
      .from(symbolConfigs)
      .where(inArray(symbolConfigs.id, uniqueSymbolIds));

    const validIds = new Set(validRows.map((row) => row.id));
    const invalidIds = uniqueSymbolIds.filter((id) => !validIds.has(id));
    if (invalidIds.length) {
      throw new Error(`Unknown symbol IDs: ${invalidIds.join(", ")}`);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(traderQuoteSubscriptions).where(eq(traderQuoteSubscriptions.userId, userId));

    if (!uniqueSymbolIds.length) return;

    await tx
      .insert(traderQuoteSubscriptions)
      .values(uniqueSymbolIds.map((symbolId) => ({ userId, symbolId })))
      .onConflictDoNothing();
  });

  notifyQuoteSubscriptionsUpdated({ type: "subscriptions", userIds: [userId] });
}

export async function setUserQuoteSubscriptionsBySymbols(userId: number, symbols: string[]) {
  const normalized = Array.from(
    new Set(
      symbols
        .map((s) => String(s).trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  if (!normalized.length) {
    await setUserQuoteSubscriptionsBySymbolIds(userId, []);
    return;
  }

  const rows = await db
    .select({ id: symbolConfigs.id, symbol: symbolConfigs.symbol })
    .from(symbolConfigs)
    .where(inArray(symbolConfigs.symbol, normalized));

  const idsBySymbol = new Map(rows.map((row) => [String(row.symbol).toUpperCase(), row.id]));
  const missing = normalized.filter((symbol) => !idsBySymbol.has(symbol));
  if (missing.length) {
    throw new Error(`Symbols are not available in instrument DB: ${missing.join(", ")}`);
  }

  const symbolIds = normalized
    .map((symbol) => idsBySymbol.get(symbol))
    .filter((id): id is number => typeof id === "number");

  await setUserQuoteSubscriptionsBySymbolIds(userId, symbolIds);
}

export async function canUserManageQuoteSubscriptions(userId: number): Promise<boolean> {
  const mode = await getUserQuoteMode(userId);
  return quoteModeSupportsCustom(mode);
}

export function notifyQuoteSubscriptionsUpdated(payload?: Record<string, any>) {
  clearCaches();
  publishLiveEvent({
    type: "quote-subscriptions:updated",
    payload: payload ?? null,
  });
}

export async function getTraderSubscriptionSummaryRows(params: {
  q?: string;
  limit?: number;
  offset?: number;
  includeAdmins?: boolean;
}) {
  const q = String(params.q ?? "").trim();
  const limit = Math.min(200, Math.max(1, Number(params.limit ?? 50) || 50));
  const offset = Math.max(0, Number(params.offset ?? 0) || 0);
  const includeAdmins = Boolean(params.includeAdmins ?? false);

  // We use SQL here to keep search and aggregates in one indexed query.
  const pattern = `%${q}%`;
  const result = await dbClient.query(
    `
    SELECT
      u.id,
      u.email,
      u.username,
      u.name,
      u.is_admin AS "isAdmin",
      tqp.quote_mode AS "overrideMode",
      COUNT(tqs.symbol_id)::int AS "customSubCount"
    FROM users u
    LEFT JOIN trader_quote_prefs tqp ON tqp.user_id = u.id
    LEFT JOIN trader_quote_subscriptions tqs ON tqs.user_id = u.id
    WHERE u.is_deleted = false
      AND ($1::boolean OR u.is_admin = false)
      AND (
        $2::text = ''
        OR u.email ILIKE $3::text
        OR u.username ILIKE $3::text
        OR COALESCE(u.name, '') ILIKE $3::text
      )
    GROUP BY u.id, u.email, u.username, u.name, u.is_admin, tqp.quote_mode
    ORDER BY u.id DESC
    LIMIT $4 OFFSET $5
    `,
    [includeAdmins, q, pattern, limit, offset],
  );

  const countResult = await dbClient.query(
    `
    SELECT COUNT(*)::int AS total
    FROM users u
    WHERE u.is_deleted = false
      AND ($1::boolean OR u.is_admin = false)
      AND (
        $2::text = ''
        OR u.email ILIKE $3::text
        OR u.username ILIKE $3::text
        OR COALESCE(u.name, '') ILIKE $3::text
      )
    `,
    [includeAdmins, q, pattern],
  );

  const total = Number(countResult.rows?.[0]?.total ?? 0);
  const config = await getQuoteSubscriptionsConfig();

  const rows = result.rows.map((row: any) => {
    const overrideMode = isQuoteMode(row.overrideMode) ? row.overrideMode : null;
    const effectiveMode = resolveEffectiveMode(overrideMode, config);
    return {
      id: Number(row.id),
      email: String(row.email ?? ""),
      username: String(row.username ?? ""),
      name: row.name != null ? String(row.name) : null,
      isAdmin: Boolean(row.isAdmin),
      overrideMode,
      effectiveMode,
      customSubCount: Number(row.customSubCount ?? 0),
    };
  });

  return {
    rows,
    total,
    limit,
    offset,
  };
}
