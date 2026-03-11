import { db } from "@db";
import { quotes } from "@shared/schema";
import { desc } from "drizzle-orm";
import { checkConfiguredProviderSecrets, getActiveProviderSelection } from "../marketdata/providerManager";

type PriceFeedCacheStats = {
  cacheSize: number;
  lastSuccessfulApiCall: number;
  consecutiveApiFailures: number;
  staleCount: number;
};

function defaultCacheStats(): PriceFeedCacheStats {
  return {
    cacheSize: 0,
    lastSuccessfulApiCall: 0,
    consecutiveApiFailures: 0,
    staleCount: 0,
  };
}

export async function buildPriceFeedDiagnostics() {
  const configured = await checkConfiguredProviderSecrets();

  let activeProviderKey: string | null = null;
  let selectionError: string | null = null;
  try {
    const selection = await getActiveProviderSelection();
    activeProviderKey = selection?.providerKey ?? configured.activeKey;
  } catch (error: any) {
    selectionError = String(error?.message ?? error);
    activeProviderKey = configured.activeKey;
  }

  let cache = defaultCacheStats();
  try {
    const { getCacheStats } = await import("../feeds/quoteFeed");
    cache = getCacheStats();
  } catch {
    // Diagnostics must remain best-effort.
  }

  let quotesInfo = { count: 0, latestUpdate: null as number | null, symbols: [] as string[] };
  try {
    const quoteRows = await db
      .select({
        symbol: quotes.symbol,
        updatedAt: quotes.updatedAt,
      })
      .from(quotes)
      .orderBy(desc(quotes.updatedAt));

    quotesInfo = {
      count: quoteRows.length,
      latestUpdate: quoteRows[0]?.updatedAt ?? null,
      symbols: quoteRows.map((row) => String(row.symbol)),
    };
  } catch {
    // Keep diagnostics available even if quote table inspection fails.
  }

  const presentEnvRefs = ["TWELVE_DATA_API_KEY", "FORGE_KEY"].filter((key) => Boolean(process.env[key]));
  const timeSinceLastUpdateSeconds =
    cache.lastSuccessfulApiCall > 0 ? Math.round((Date.now() - cache.lastSuccessfulApiCall) / 1000) : null;

  const status = (() => {
    if (selectionError) return "error";
    if (!activeProviderKey) {
      return configured.candidateKeys.length > 0 ? "provider_unavailable" : "provider_unconfigured";
    }
    const missing = configured.missingEnvByProviderKey[activeProviderKey] ?? [];
    if (missing.length > 0) return "missing_provider_secret";
    return "configured";
  })();

  return {
    status,
    environment: process.env.NODE_ENV || "development",
    activeProviderKey,
    candidateKeys: configured.candidateKeys,
    fallbackKeys: configured.fallbackKeys,
    missingEnvByProviderKey: configured.missingEnvByProviderKey,
    presentEnvRefs,
    selectionError,
    cache: {
      ...cache,
      timeSinceLastUpdateSeconds,
    },
    database: quotesInfo,
    timestamp: new Date().toISOString(),
  };
}
