import { db } from "@db";
import { marketDataProviders, systemConfig } from "@shared/schema";
import {
  MarketDataProviderConfigSchema,
  type MarketDataProviderConfig,
} from "@shared/marketDataProviders";
import type {
  EffectiveProviderCandidate,
  EffectiveProviderSelection,
} from "@shared/runtimeConfig";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY } from "../systemConfig";
import { getControlledReloadStatus } from "../controlledReload";
import { buildProviderFromConfig } from "../../marketdata/providerRegistry";
import { envSecretKeyFromRef, resolveSecretRef } from "../../marketdata/secret";

type ProviderRow = typeof marketDataProviders.$inferSelect;

const ACTIVE_PROVIDER_CACHE_TTL_MS = Number(process.env.MARKET_DATA_PROVIDER_CACHE_TTL_MS ?? 2_000);

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function parseCsv(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/[,\s]+/g)
    .map((value) => value.trim())
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

function missingSecretsForConfig(cfg: MarketDataProviderConfig): string[] {
  const refs: Array<string | null | undefined> = [];
  if (cfg.driver === "twelvedata") refs.push(cfg.apiKey);
  if (cfg.driver === "oneforge") refs.push(cfg.apiKey);
  if (cfg.driver === "generic_rest_v1") refs.push(cfg.apiKey ?? null);

  return refs
    .map((ref) => envSecretKeyFromRef(ref))
    .filter((key): key is string => Boolean(key))
    .filter((key) => !process.env[key])
    .filter((key, index, arr) => arr.indexOf(key) === index)
    .sort();
}

function parseProviderConfig(row: ProviderRow): MarketDataProviderConfig {
  const raw = safeJsonParse(String(row.configJson ?? "{}"));
  if (!raw.driver) raw.driver = row.driver;
  return MarketDataProviderConfigSchema.parse(raw);
}

function buildConfiguredCandidate(
  providerKey: string,
  orderIndex: number,
  activeKey: string | null,
  fallbackKeys: string[],
): EffectiveProviderCandidate {
  return {
    providerKey,
    displayName: null,
    driver: null,
    configuredOrder: orderIndex,
    isConfiguredActive: Boolean(activeKey && providerKey === activeKey),
    isConfiguredFallback: fallbackKeys.includes(providerKey),
    isEnabled: false,
    configUsable: false,
    missingSecrets: [],
    skippedReason: "not-found",
    error: null,
  };
}

function hydrateCandidate(
  base: EffectiveProviderCandidate,
  patch: Partial<EffectiveProviderCandidate>,
): EffectiveProviderCandidate {
  return {
    ...base,
    ...patch,
    missingSecrets: patch.missingSecrets ?? base.missingSecrets,
  };
}

export function allowLegacyEnvProviderFallback(
  _nodeEnv = process.env.NODE_ENV ?? "",
  override = process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK,
): boolean {
  return envFlagEnabled(override, false);
}

export function resolveLegacyEnvProviderKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const keys: string[] = [];
  if (env.TWELVE_DATA_API_KEY) keys.push(DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY);
  if (env.FORGE_KEY) keys.push("1forge");
  return [...new Set(keys)];
}

export function buildConfiguredProviderCandidateKeys(args: {
  activeKey?: string | null;
  fallbackKeys?: string[];
}): string[] {
  const activeKey = String(args.activeKey ?? "").trim() || null;
  const fallbackKeys = (args.fallbackKeys ?? [])
    .map((key) => String(key).trim())
    .filter(Boolean);

  const ordered: string[] = [];
  if (activeKey) ordered.push(activeKey);
  else ordered.push(DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY);

  for (const fallbackKey of fallbackKeys) {
    if (fallbackKey !== activeKey) ordered.push(fallbackKey);
  }

  return [...new Set(ordered)];
}

export async function getConfiguredProviderOrder() {
  const row = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
  const activeKey = row?.marketDataActiveProviderKey ? String(row.marketDataActiveProviderKey).trim() : null;
  const fallbackKeys = parseCsv(row?.marketDataFallbackProviderKeysCsv).filter((key) => key !== activeKey);

  return {
    activeKey: activeKey || DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY,
    fallbackKeys,
    candidateKeys: buildConfiguredProviderCandidateKeys({
      activeKey,
      fallbackKeys,
    }),
    diagnostics: {
      providerCacheTtlMs: ACTIVE_PROVIDER_CACHE_TTL_MS,
      envFallbackMode: allowLegacyEnvProviderFallback() ? ("diagnostic-only" as const) : ("disabled" as const),
      allowLegacyEnvFallback: allowLegacyEnvProviderFallback(),
      legacyEnvCandidateKeys: resolveLegacyEnvProviderKeys(),
    },
  };
}

export async function getProviderRowsByKey(): Promise<Map<string, ProviderRow>> {
  const rows = await db
    .select()
    .from(marketDataProviders)
    .where(and(isNull(marketDataProviders.deletedAt)))
    .orderBy(asc(marketDataProviders.providerKey));

  return new Map(rows.map((row) => [String(row.providerKey), row]));
}

export async function getProviderCandidateState(providerKey: string): Promise<EffectiveProviderCandidate> {
  const configured = await getConfiguredProviderOrder();
  const rowsByKey = await getProviderRowsByKey();
  const orderIndex = Math.max(0, configured.candidateKeys.indexOf(providerKey));
  const base = buildConfiguredCandidate(providerKey, orderIndex, configured.activeKey, configured.fallbackKeys);
  const row = rowsByKey.get(providerKey);
  if (!row) return base;

  const candidateWithRow = hydrateCandidate(base, {
    displayName: row.displayName,
    driver: row.driver,
    isEnabled: Boolean(row.isEnabled),
  });

  if (!row.isEnabled) {
    return hydrateCandidate(candidateWithRow, {
      skippedReason: "disabled",
    });
  }

  let cfg: MarketDataProviderConfig;
  try {
    cfg = parseProviderConfig(row);
  } catch (error: any) {
    return hydrateCandidate(candidateWithRow, {
      skippedReason: "invalid-config",
      error: String(error?.message ?? error),
    });
  }

  const missingSecrets = missingSecretsForConfig(cfg);
  if (!isConfigUsable(cfg)) {
    return hydrateCandidate(candidateWithRow, {
      missingSecrets,
      skippedReason: "missing-secret",
    });
  }

  try {
    buildProviderFromConfig({
      providerKey: row.providerKey,
      displayName: row.displayName,
      cfg,
    });
  } catch (error: any) {
    return hydrateCandidate(candidateWithRow, {
      missingSecrets,
      skippedReason: "load-error",
      error: String(error?.message ?? error),
    });
  }

  return hydrateCandidate(candidateWithRow, {
    configUsable: true,
    missingSecrets,
    skippedReason: null,
  });
}

export async function resolveEffectiveProviderSelection(options?: {
  excludedProviderKeys?: Iterable<string>;
}): Promise<EffectiveProviderSelection> {
  const configured = await getConfiguredProviderOrder();
  const excluded = new Set(
    Array.from(options?.excludedProviderKeys ?? []).map((key) => String(key).trim()).filter(Boolean),
  );

  const candidates: EffectiveProviderCandidate[] = [];
  let effectiveProviderKey: string | null = null;
  let effectiveProviderDisplayName: string | null = null;
  let effectiveProviderDriver: string | null = null;

  for (const [index, providerKey] of configured.candidateKeys.entries()) {
    const candidate = await getProviderCandidateState(providerKey);
    const withOrder = hydrateCandidate(candidate, {
      configuredOrder: index,
    });

    if (excluded.has(providerKey)) {
      candidates.push(
        hydrateCandidate(withOrder, {
          skippedReason: "disabled",
          configUsable: false,
        }),
      );
      continue;
    }

    candidates.push(withOrder);
    if (!effectiveProviderKey && withOrder.skippedReason === null && withOrder.configUsable) {
      effectiveProviderKey = providerKey;
      effectiveProviderDisplayName = withOrder.displayName;
      effectiveProviderDriver = withOrder.driver;
    }
  }

  return {
    configuredActiveKey: configured.activeKey,
    configuredFallbackKeys: configured.fallbackKeys,
    effectiveProviderKey,
    effectiveProviderDisplayName,
    effectiveProviderDriver,
    candidateOrder: [...configured.candidateKeys],
    candidates,
    diagnostics: configured.diagnostics,
    reloadStatus: await getControlledReloadStatus("quotes.providers"),
  };
}
