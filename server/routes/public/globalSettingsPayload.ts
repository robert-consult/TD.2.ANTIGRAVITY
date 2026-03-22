import { eq } from "drizzle-orm";
import { db } from "@db";
import { globalSettings } from "@shared/schema";
import { resolvePerformanceSettings, type ResolvedPerformanceSettings } from "@shared/performanceSettings";
import { clampIntOr } from "@shared/scalars";
import { sanitizeMinPriceDistancePips } from "../../services/globalSettings";

const ABSOLUTE_MAX_LOTS = 50;

function parsePresetCards(raw: string | null | undefined, max: number): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    const values = parsed
      .map((value) => clampIntOr(value, 0, 1, max))
      .filter((value) => value >= 1 && value <= max);
    const unique = Array.from(new Set(values));
    unique.sort((a, b) => a - b);
    return unique;
  } catch {
    return [];
  }
}

export type PublicGlobalSettingsPayload = {
  absoluteMaxLots: number;
  flushConstrainedMs: number;
  flushFastMs: number;
  flushInstantMs: number;
  flushMinimalMs: number;
  flushModerateMs: number;
  lotDropdownMax: number;
  lotDropdownOptions: number[];
  lotPresetCards: string;
  lotPresetCardsArray: number[];
  maxWsReconnectAttempts: number;
  minPriceDistancePips: number;
  pollConstrainedMs: number;
  pollFastMs: number;
  pollInstantMs: number;
  pollMinimalMs: number;
  pollModerateMs: number;
  prefetchConstrainedConcurrencyCap: number;
  prefetchDeviceConstrainedStartDelayMs: number;
  prefetchDeviceMinimalStartDelayMs: number;
  prefetchDeviceModerateStartDelayMs: number;
  prefetchFastConcurrencyCap: number;
  prefetchMaxConcurrency: number;
  prefetchModerateConcurrencyCap: number;
  prefetchNetworkConstrainedStartDelayMs: number;
  prefetchNetworkFastStartDelayMs: number;
  prefetchNetworkModerateStartDelayMs: number;
  prefetchStartDelayMs: number;
  prefetchStrategy: "all" | "critical" | "none";
  quoteFlushIntervalMs: number;
  restFallbackPollMs: number;
  updatedAt: number | null;
  wsPushFrequencyMs: number;
  wsReconnectBaseDelayMs: number;
  performanceSettings: ResolvedPerformanceSettings;
};

export async function buildPublicGlobalSettingsPayload(): Promise<PublicGlobalSettingsPayload> {
  const [settings] = await db
    .select({
      lotPresetCards: globalSettings.lotPresetCards,
      lotDropdownMax: globalSettings.lotDropdownMax,
      minPriceDistancePips: globalSettings.minPriceDistancePips,
      restFallbackPollMs: globalSettings.restFallbackPollMs,
      wsPushFrequencyMs: globalSettings.wsPushFrequencyMs,
      quoteFlushIntervalMs: globalSettings.quoteFlushIntervalMs,
      maxWsReconnectAttempts: globalSettings.maxWsReconnectAttempts,
      wsReconnectBaseDelayMs: globalSettings.wsReconnectBaseDelayMs,
      prefetchStrategy: globalSettings.prefetchStrategy,
      prefetchMaxConcurrency: globalSettings.prefetchMaxConcurrency,
      prefetchStartDelayMs: globalSettings.prefetchStartDelayMs,
      prefetchFastConcurrencyCap: globalSettings.prefetchFastConcurrencyCap,
      prefetchModerateConcurrencyCap: globalSettings.prefetchModerateConcurrencyCap,
      prefetchConstrainedConcurrencyCap: globalSettings.prefetchConstrainedConcurrencyCap,
      prefetchNetworkFastStartDelayMs: globalSettings.prefetchNetworkFastStartDelayMs,
      prefetchNetworkModerateStartDelayMs: globalSettings.prefetchNetworkModerateStartDelayMs,
      prefetchNetworkConstrainedStartDelayMs: globalSettings.prefetchNetworkConstrainedStartDelayMs,
      prefetchDeviceModerateStartDelayMs: globalSettings.prefetchDeviceModerateStartDelayMs,
      prefetchDeviceConstrainedStartDelayMs: globalSettings.prefetchDeviceConstrainedStartDelayMs,
      prefetchDeviceMinimalStartDelayMs: globalSettings.prefetchDeviceMinimalStartDelayMs,
      pollInstantMs: globalSettings.pollInstantMs,
      pollFastMs: globalSettings.pollFastMs,
      pollModerateMs: globalSettings.pollModerateMs,
      pollConstrainedMs: globalSettings.pollConstrainedMs,
      pollMinimalMs: globalSettings.pollMinimalMs,
      flushInstantMs: globalSettings.flushInstantMs,
      flushFastMs: globalSettings.flushFastMs,
      flushModerateMs: globalSettings.flushModerateMs,
      flushConstrainedMs: globalSettings.flushConstrainedMs,
      flushMinimalMs: globalSettings.flushMinimalMs,
      updatedAt: globalSettings.updatedAt,
    })
    .from(globalSettings)
    .where(eq(globalSettings.id, 1))
    .limit(1);

  const lotDropdownMax = clampIntOr(settings?.lotDropdownMax, ABSOLUTE_MAX_LOTS, 1, ABSOLUTE_MAX_LOTS);
  const minPriceDistancePips = sanitizeMinPriceDistancePips(settings?.minPriceDistancePips);
  const performanceSettings = resolvePerformanceSettings(settings ?? null);

  const presetsParsed = parsePresetCards(settings?.lotPresetCards, lotDropdownMax);
  const lotPresetCardsArray =
    presetsParsed.length > 0
      ? presetsParsed
      : [1, 5, 10, 25, 50].filter((value) => value <= lotDropdownMax);

  return {
    lotPresetCards: JSON.stringify(lotPresetCardsArray),
    lotPresetCardsArray,
    lotDropdownMax,
    lotDropdownOptions: Array.from({ length: lotDropdownMax }, (_value, index) => index + 1),
    minPriceDistancePips,
    ...performanceSettings,
    absoluteMaxLots: ABSOLUTE_MAX_LOTS,
    updatedAt: typeof settings?.updatedAt === "number" ? settings.updatedAt : null,
    performanceSettings,
  };
}
