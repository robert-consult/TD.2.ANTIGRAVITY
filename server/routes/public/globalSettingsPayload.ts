import { eq } from "drizzle-orm";
import { db } from "@db";
import { globalSettings } from "@shared/schema";
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
  const restFallbackPollMs = clampIntOr(settings?.restFallbackPollMs, 500, 100, 60_000);
  const wsPushFrequencyMs = clampIntOr(settings?.wsPushFrequencyMs, 0, 0, 1_000);
  const quoteFlushIntervalMs = clampIntOr(settings?.quoteFlushIntervalMs, 50, 20, 5_000);
  const maxWsReconnectAttempts = clampIntOr(settings?.maxWsReconnectAttempts, 30, 1, 30);
  const wsReconnectBaseDelayMs = clampIntOr(settings?.wsReconnectBaseDelayMs, 1500, 100, 30_000);
  const prefetchMaxConcurrency = clampIntOr(settings?.prefetchMaxConcurrency, 4, 1, 6);
  const prefetchStartDelayMs = clampIntOr(settings?.prefetchStartDelayMs, 0, 0, 15_000);
  const prefetchFastConcurrencyCap = clampIntOr(settings?.prefetchFastConcurrencyCap, 3, 1, 6);
  const prefetchModerateConcurrencyCap = clampIntOr(settings?.prefetchModerateConcurrencyCap, 2, 1, 6);
  const prefetchConstrainedConcurrencyCap = clampIntOr(settings?.prefetchConstrainedConcurrencyCap, 1, 1, 6);
  const prefetchNetworkFastStartDelayMs = clampIntOr(settings?.prefetchNetworkFastStartDelayMs, 75, 0, 15_000);
  const prefetchNetworkModerateStartDelayMs = clampIntOr(
    settings?.prefetchNetworkModerateStartDelayMs,
    200,
    0,
    15_000,
  );
  const prefetchNetworkConstrainedStartDelayMs = clampIntOr(
    settings?.prefetchNetworkConstrainedStartDelayMs,
    450,
    0,
    15_000,
  );
  const prefetchDeviceModerateStartDelayMs = clampIntOr(
    settings?.prefetchDeviceModerateStartDelayMs,
    50,
    0,
    15_000,
  );
  const prefetchDeviceConstrainedStartDelayMs = clampIntOr(
    settings?.prefetchDeviceConstrainedStartDelayMs,
    150,
    0,
    15_000,
  );
  const prefetchDeviceMinimalStartDelayMs = clampIntOr(
    settings?.prefetchDeviceMinimalStartDelayMs,
    300,
    0,
    15_000,
  );
  const pollInstantMs = clampIntOr(settings?.pollInstantMs, 200, 100, 60_000);
  const pollFastMs = clampIntOr(settings?.pollFastMs, 500, 100, 60_000);
  const pollModerateMs = clampIntOr(settings?.pollModerateMs, 1500, 100, 60_000);
  const pollConstrainedMs = clampIntOr(settings?.pollConstrainedMs, 4000, 100, 60_000);
  const pollMinimalMs = clampIntOr(settings?.pollMinimalMs, 6000, 100, 60_000);
  const flushInstantMs = clampIntOr(settings?.flushInstantMs, 50, 20, 5_000);
  const flushFastMs = clampIntOr(settings?.flushFastMs, 150, 20, 5_000);
  const flushModerateMs = clampIntOr(settings?.flushModerateMs, 300, 20, 5_000);
  const flushConstrainedMs = clampIntOr(settings?.flushConstrainedMs, 500, 20, 5_000);
  const flushMinimalMs = clampIntOr(settings?.flushMinimalMs, 1000, 20, 5_000);
  const prefetchStrategyRaw = String(settings?.prefetchStrategy ?? "all").trim().toLowerCase();
  const prefetchStrategy =
    prefetchStrategyRaw === "critical" || prefetchStrategyRaw === "none" ? prefetchStrategyRaw : "all";

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
    restFallbackPollMs,
    wsPushFrequencyMs,
    quoteFlushIntervalMs,
    maxWsReconnectAttempts,
    wsReconnectBaseDelayMs,
    prefetchStrategy,
    prefetchMaxConcurrency,
    prefetchStartDelayMs,
    prefetchFastConcurrencyCap,
    prefetchModerateConcurrencyCap,
    prefetchConstrainedConcurrencyCap,
    prefetchNetworkFastStartDelayMs,
    prefetchNetworkModerateStartDelayMs,
    prefetchNetworkConstrainedStartDelayMs,
    prefetchDeviceModerateStartDelayMs,
    prefetchDeviceConstrainedStartDelayMs,
    prefetchDeviceMinimalStartDelayMs,
    pollInstantMs,
    pollFastMs,
    pollModerateMs,
    pollConstrainedMs,
    pollMinimalMs,
    flushInstantMs,
    flushFastMs,
    flushModerateMs,
    flushConstrainedMs,
    flushMinimalMs,
    absoluteMaxLots: ABSOLUTE_MAX_LOTS,
    updatedAt: typeof settings?.updatedAt === "number" ? settings.updatedAt : null,
  };
}
