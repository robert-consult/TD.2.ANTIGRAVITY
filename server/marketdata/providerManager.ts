import { db } from "@db";
import { marketDataProviders, systemConfig } from "@shared/schema";
import {
  MarketDataProviderConfigSchema,
  type MarketDataProviderConfig,
} from "@shared/marketDataProviders";
import { and, eq, isNull } from "drizzle-orm";
import { onLiveEvent, publishLiveEvent } from "../services/liveBus";
import {
  getProviderCandidateState,
  resolveEffectiveProviderSelection,
  allowLegacyEnvProviderFallback,
  buildConfiguredProviderCandidateKeys,
  resolveLegacyEnvProviderKeys,
} from "../services/runtimeConfig/marketDataProviders";
import { ensureSystemConfigRow } from "../services/systemConfig";
import { buildProviderFromConfig } from "./providerRegistry";
import type { MarketDataProvider } from "./providerTypes";

const ACTIVE_PROVIDER_CACHE_TTL_MS = Number(process.env.MARKET_DATA_PROVIDER_CACHE_TTL_MS ?? 2_000);

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

async function loadProviderRow(providerKey: string): Promise<ProviderRow | null> {
  const row = await db.query.marketDataProviders.findFirst({
    where: and(eq(marketDataProviders.providerKey, providerKey), isNull(marketDataProviders.deletedAt)),
  });
  if (!row || !row.isEnabled) return null;
  return row;
}

export { allowLegacyEnvProviderFallback, buildConfiguredProviderCandidateKeys, resolveLegacyEnvProviderKeys };

export async function getActiveProviderSelection(): Promise<{ providerKey: string; provider: MarketDataProvider } | null> {
  ensureSubscribed();
  const now = Date.now();
  if (cached && now - cached.loadedAtMs < ACTIVE_PROVIDER_CACHE_TTL_MS) {
    return { providerKey: cached.providerKey, provider: cached.provider };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const effective = await resolveEffectiveProviderSelection();
    if (!effective.effectiveProviderKey) {
      cached = null;
      return null;
    }

    const row = await loadProviderRow(effective.effectiveProviderKey);
    if (!row) {
      cached = null;
      return null;
    }

    const cfg = parseProviderConfig(row);
    const provider = buildProviderFromConfig({
      providerKey: row.providerKey,
      displayName: row.displayName,
      cfg,
    });

    cached = { providerKey: row.providerKey, provider, loadedAtMs: Date.now() };
    return { providerKey: row.providerKey, provider };
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function invalidateActiveProviderCache() {
  cached = null;
}

export async function getProviderByKey(
  providerKey: string,
): Promise<{ providerKey: string; provider: MarketDataProvider } | null> {
  const key = String(providerKey || "").trim();
  if (!key) return null;
  const row = await loadProviderRow(key);
  if (!row) return null;
  const cfg = parseProviderConfig(row);
  const provider = buildProviderFromConfig({
    providerKey: row.providerKey,
    displayName: row.displayName,
    cfg,
  });
  return { providerKey: row.providerKey, provider };
}

export async function activateProvider(providerKey: string, actor?: { adminEmail?: string | null }) {
  const key = String(providerKey || "").trim();
  if (!key) throw new Error("providerKey required");

  const candidate = await getProviderCandidateState(key);
  if (candidate.skippedReason !== null || !candidate.configUsable || !candidate.isEnabled) {
    throw new Error("Provider is not usable");
  }

  await ensureSystemConfigRow();
  await db
    .update(systemConfig)
    .set({
      marketDataActiveProviderKey: key,
      updatedAt: Math.floor(Date.now() / 1000),
      updatedBy: actor?.adminEmail ?? "admin",
    })
    .where(eq(systemConfig.id, 1));

  invalidateActiveProviderCache();
  publishLiveEvent({
    type: "system-config:updated",
    payload: { updatedAt: Date.now(), scope: "MARKET_DATA_PROVIDER_SELECTION" },
  });
}

export async function checkConfiguredProviderSecrets(): Promise<{
  activeKey: string | null;
  fallbackKeys: string[];
  candidateKeys: string[];
  missingEnvByProviderKey: Record<string, string[]>;
}> {
  const effective = await resolveEffectiveProviderSelection();
  const missingEnvByProviderKey: Record<string, string[]> = {};

  for (const candidate of effective.candidates) {
    if (!candidate.missingSecrets.length) continue;
    missingEnvByProviderKey[candidate.providerKey] = [...candidate.missingSecrets];
  }

  return {
    activeKey: effective.configuredActiveKey,
    fallbackKeys: effective.configuredFallbackKeys,
    candidateKeys: effective.candidateOrder,
    missingEnvByProviderKey,
  };
}
