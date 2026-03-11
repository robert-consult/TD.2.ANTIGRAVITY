import { db } from "@db";
import { marketDataProviders, systemConfig } from "@shared/schema";
import { MarketDataProviderConfigSchema, type MarketDataProviderConfig } from "@shared/marketDataProviders";
import { and, eq, isNull } from "drizzle-orm";
import { onLiveEvent, publishLiveEvent } from "../services/liveBus";
import { buildProviderFromConfig } from "./providerRegistry";
import type { MarketDataProvider } from "./providerTypes";
import { envSecretKeyFromRef, resolveSecretRef } from "./secret";

const ACTIVE_PROVIDER_CACHE_TTL_MS = Number(process.env.MARKET_DATA_PROVIDER_CACHE_TTL_MS ?? 2_000);
const DEFAULT_PROVIDER_KEY = "twelvedata";

type ProviderRow = typeof marketDataProviders.$inferSelect;

let cached: { providerKey: string; provider: MarketDataProvider; loadedAtMs: number } | null = null;
let inflight: Promise<{ providerKey: string; provider: MarketDataProvider } | null> | null = null;
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  onLiveEvent((event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "system-config:updated" || event.type === "market-data:providers-updated") {
      cached = null;
    }
  });
}

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function parseProviderConfig(row: ProviderRow): MarketDataProviderConfig {
  const raw = safeJsonParse(String(row.configJson ?? "{}"));
  if (!raw.driver) raw.driver = row.driver;
  return MarketDataProviderConfigSchema.parse(raw);
}

function parseCsv(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function envFlagEnabled(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function isConfigUsable(cfg: MarketDataProviderConfig): boolean {
  if (cfg.driver === "twelvedata") return Boolean(resolveSecretRef(cfg.apiKey));
  if (cfg.driver === "oneforge") return Boolean(resolveSecretRef(cfg.apiKey));
  if (cfg.driver === "generic_rest_v1" && cfg.apiKey) return Boolean(resolveSecretRef(cfg.apiKey));
  return true;
}

async function loadProviderRow(providerKey: string): Promise<ProviderRow | null> {
  const row = await db.query.marketDataProviders.findFirst({
    where: and(eq(marketDataProviders.providerKey, providerKey), isNull(marketDataProviders.deletedAt)),
  });
  if (!row) return null;
  if (!row.isEnabled) return null;
  return row;
}

export function allowLegacyEnvProviderFallback(
  nodeEnv = process.env.NODE_ENV ?? "",
  override = process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK,
): boolean {
  return envFlagEnabled(override, String(nodeEnv).trim().toLowerCase() !== "production");
}

export function resolveLegacyEnvProviderKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys: string[] = [];
  if (env.TWELVE_DATA_API_KEY) keys.push(DEFAULT_PROVIDER_KEY);
  if (env.FORGE_KEY) keys.push("1forge");
  return [...new Set(keys)];
}

export function buildConfiguredProviderCandidateKeys(args: {
  activeKey?: string | null;
  fallbackKeys?: string[];
  allowLegacyEnvFallback?: boolean;
  legacyEnvKeys?: string[];
}): string[] {
  const keys: string[] = [];

  const activeKey = String(args.activeKey ?? "").trim() || null;
  const fallbackKeys = (args.fallbackKeys ?? []).map((key) => String(key).trim()).filter(Boolean);

  if (activeKey) keys.push(activeKey);
  else keys.push(DEFAULT_PROVIDER_KEY);

  for (const key of fallbackKeys) {
    if (key !== activeKey) keys.push(key);
  }

  if (args.allowLegacyEnvFallback) {
    for (const key of args.legacyEnvKeys ?? []) keys.push(String(key).trim());
  }

  return [...new Set(keys.filter(Boolean))];
}

async function getConfiguredProviderKeys(): Promise<{
  activeKey: string | null;
  fallbackKeys: string[];
  candidateKeys: string[];
}> {
  const row = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
  const activeKey = row?.marketDataActiveProviderKey ? String(row.marketDataActiveProviderKey).trim() : null;
  const fallbackKeys = parseCsv(row?.marketDataFallbackProviderKeysCsv).filter((k) => k !== activeKey);
  const candidateKeys = buildConfiguredProviderCandidateKeys({
    activeKey,
    fallbackKeys,
    allowLegacyEnvFallback: !activeKey && allowLegacyEnvProviderFallback(),
    legacyEnvKeys: resolveLegacyEnvProviderKeys(),
  });

  return { activeKey, fallbackKeys, candidateKeys };
}

export async function getActiveProviderSelection(): Promise<{ providerKey: string; provider: MarketDataProvider } | null> {
  ensureSubscribed();
  const now = Date.now();
  if (cached && now - cached.loadedAtMs < ACTIVE_PROVIDER_CACHE_TTL_MS) {
    return { providerKey: cached.providerKey, provider: cached.provider };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const { candidateKeys } = await getConfiguredProviderKeys();
    const candidates = candidateKeys.filter((v): v is string => Boolean(v));
    for (const key of candidates) {
      const row = await loadProviderRow(key);
      if (!row) continue;
      const cfg = parseProviderConfig(row);
      if (!isConfigUsable(cfg)) continue;
      const provider = buildProviderFromConfig({ providerKey: row.providerKey, displayName: row.displayName, cfg });
      cached = { providerKey: row.providerKey, provider, loadedAtMs: Date.now() };
      return { providerKey: row.providerKey, provider };
    }
    cached = null;
    return null;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function invalidateActiveProviderCache() {
  cached = null;
}

export async function getProviderByKey(providerKey: string): Promise<{ providerKey: string; provider: MarketDataProvider } | null> {
  const key = String(providerKey || "").trim();
  if (!key) return null;
  const row = await loadProviderRow(key);
  if (!row) return null;
  const cfg = parseProviderConfig(row);
  const provider = buildProviderFromConfig({ providerKey: row.providerKey, displayName: row.displayName, cfg });
  return { providerKey: row.providerKey, provider };
}

export async function activateProvider(providerKey: string, actor?: { adminEmail?: string | null }) {
  const key = String(providerKey || "").trim();
  if (!key) throw new Error("providerKey required");

  const row = await loadProviderRow(key);
  if (!row) throw new Error("Provider not found or disabled");

  await db
    .update(systemConfig)
    .set({ marketDataActiveProviderKey: key, updatedAt: Math.floor(Date.now() / 1000), updatedBy: actor?.adminEmail ?? "admin" })
    .where(eq(systemConfig.id, 1));

  invalidateActiveProviderCache();
  try {
    publishLiveEvent({ type: "market-data:providers-updated", payload: { providerKey: key, at: Date.now() } });
    publishLiveEvent({ type: "feed:config-updated", payload: { providerKey: key, at: Date.now() } });
  } catch {
    // ignore
  }
}

export async function checkConfiguredProviderSecrets(): Promise<{
  activeKey: string | null;
  fallbackKeys: string[];
  candidateKeys: string[];
  missingEnvByProviderKey: Record<string, string[]>;
}> {
  const { activeKey, fallbackKeys, candidateKeys } = await getConfiguredProviderKeys();
  const keys = candidateKeys.filter((k): k is string => Boolean(k));

  const missingEnvByProviderKey: Record<string, string[]> = {};

  for (const providerKey of keys) {
    const row = await loadProviderRow(providerKey);
    if (!row) continue;
    let cfg: MarketDataProviderConfig;
    try {
      cfg = parseProviderConfig(row);
    } catch {
      continue;
    }

    const refs: Array<string | null | undefined> = [];
    if (cfg.driver === "twelvedata") refs.push(cfg.apiKey);
    if (cfg.driver === "oneforge") refs.push(cfg.apiKey);
    if (cfg.driver === "generic_rest_v1") refs.push(cfg.apiKey ?? null);

    const missingKeys = refs
      .map((ref) => envSecretKeyFromRef(ref))
      .filter((k): k is string => Boolean(k))
      .filter((k) => !process.env[k]);

    if (missingKeys.length) missingEnvByProviderKey[providerKey] = [...new Set(missingKeys)].sort();
  }

  return { activeKey, fallbackKeys, candidateKeys: keys, missingEnvByProviderKey };
}
