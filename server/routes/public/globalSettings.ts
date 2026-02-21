import type { Request, Response, Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@db";
import { globalSettings } from "@shared/schema";
import { sanitizeMinPriceDistancePips } from "../../services/globalSettings";

export function registerGlobalSettingsRoute(router: Router) {
  // Public global settings endpoint (returns lot settings for order form)
  router.get("/global-settings", async (_req: Request, res: Response) => {
    try {
      const ABSOLUTE_MAX_LOTS = 50;

      const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.trunc(n)));
      };

      const parsePresetCards = (raw: string | null | undefined, max: number): number[] => {
        try {
          const parsed = JSON.parse(raw || "[]");
          if (!Array.isArray(parsed)) return [];
          const values = parsed
            .map((v) => (typeof v === "number" ? v : Number(v)))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n))
            .filter((n) => n >= 1 && n <= max);
          const unique = Array.from(new Set(values));
          unique.sort((a, b) => a - b);
          return unique;
        } catch {
          return [];
        }
      };

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

      const lotDropdownMax = clampInt(settings?.lotDropdownMax, 1, ABSOLUTE_MAX_LOTS, ABSOLUTE_MAX_LOTS);
      const minPriceDistancePips = sanitizeMinPriceDistancePips(settings?.minPriceDistancePips);
      const restFallbackPollMs = clampInt(settings?.restFallbackPollMs, 100, 60_000, 500);
      const wsPushFrequencyMs = clampInt(settings?.wsPushFrequencyMs, 0, 1_000, 0);
      const quoteFlushIntervalMs = clampInt(settings?.quoteFlushIntervalMs, 20, 5_000, 50);
      const maxWsReconnectAttempts = clampInt(settings?.maxWsReconnectAttempts, 1, 30, 30);
      const wsReconnectBaseDelayMs = clampInt(settings?.wsReconnectBaseDelayMs, 100, 30_000, 1500);
      const prefetchMaxConcurrency = clampInt(settings?.prefetchMaxConcurrency, 1, 6, 4);
      const prefetchStartDelayMs = clampInt(settings?.prefetchStartDelayMs, 0, 15_000, 0);
      const prefetchFastConcurrencyCap = clampInt(settings?.prefetchFastConcurrencyCap, 1, 6, 3);
      const prefetchModerateConcurrencyCap = clampInt(settings?.prefetchModerateConcurrencyCap, 1, 6, 2);
      const prefetchConstrainedConcurrencyCap = clampInt(settings?.prefetchConstrainedConcurrencyCap, 1, 6, 1);
      const prefetchNetworkFastStartDelayMs = clampInt(settings?.prefetchNetworkFastStartDelayMs, 0, 15_000, 75);
      const prefetchNetworkModerateStartDelayMs = clampInt(
        settings?.prefetchNetworkModerateStartDelayMs,
        0,
        15_000,
        200,
      );
      const prefetchNetworkConstrainedStartDelayMs = clampInt(
        settings?.prefetchNetworkConstrainedStartDelayMs,
        0,
        15_000,
        450,
      );
      const prefetchDeviceModerateStartDelayMs = clampInt(
        settings?.prefetchDeviceModerateStartDelayMs,
        0,
        15_000,
        50,
      );
      const prefetchDeviceConstrainedStartDelayMs = clampInt(
        settings?.prefetchDeviceConstrainedStartDelayMs,
        0,
        15_000,
        150,
      );
      const prefetchDeviceMinimalStartDelayMs = clampInt(
        settings?.prefetchDeviceMinimalStartDelayMs,
        0,
        15_000,
        300,
      );
      const pollInstantMs = clampInt(settings?.pollInstantMs, 100, 60_000, 200);
      const pollFastMs = clampInt(settings?.pollFastMs, 100, 60_000, 500);
      const pollModerateMs = clampInt(settings?.pollModerateMs, 100, 60_000, 1500);
      const pollConstrainedMs = clampInt(settings?.pollConstrainedMs, 100, 60_000, 4000);
      const pollMinimalMs = clampInt(settings?.pollMinimalMs, 100, 60_000, 6000);
      const flushInstantMs = clampInt(settings?.flushInstantMs, 20, 5_000, 50);
      const flushFastMs = clampInt(settings?.flushFastMs, 20, 5_000, 150);
      const flushModerateMs = clampInt(settings?.flushModerateMs, 20, 5_000, 300);
      const flushConstrainedMs = clampInt(settings?.flushConstrainedMs, 20, 5_000, 500);
      const flushMinimalMs = clampInt(settings?.flushMinimalMs, 20, 5_000, 1000);
      const prefetchStrategyRaw = String(settings?.prefetchStrategy ?? "all").trim().toLowerCase();
      const prefetchStrategy =
        prefetchStrategyRaw === "critical" || prefetchStrategyRaw === "none" ? prefetchStrategyRaw : "all";

      const presetsParsed = parsePresetCards(settings?.lotPresetCards, lotDropdownMax);
      const lotPresetCardsArray =
        presetsParsed.length > 0
          ? presetsParsed
          : [1, 5, 10, 25, 50].filter((n) => n <= lotDropdownMax);

      const lotDropdownOptions = Array.from({ length: lotDropdownMax }, (_v, i) => i + 1);

      res.json({
        lotPresetCards: JSON.stringify(lotPresetCardsArray),
        lotPresetCardsArray,
        lotDropdownMax,
        lotDropdownOptions,
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
      });
    } catch (error: any) {
      console.error("[GlobalSettings] Failed to fetch:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });
}
