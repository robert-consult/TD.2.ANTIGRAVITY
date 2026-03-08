import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { clampIntOr } from "@shared/scalars";
import { MIN_PRICE_DISTANCE_PIPS } from "@shared/tradingRules";

const ABSOLUTE_MAX_LOTS = 50;
const DEFAULT_MIN_PRICE_DISTANCE_PIPS = MIN_PRICE_DISTANCE_PIPS;

type GlobalLotSettingsResponse = {
  lotPresetCards?: string | null;
  lotPresetCardsArray?: number[] | null;
  lotDropdownMax?: number | null;
  lotDropdownOptions?: number[] | null;
  minPriceDistancePips?: number | null;
  absoluteMaxLots?: number | null;
};

function parsePresetCards(raw: string | null | undefined, max: number): number[] {
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
}

function buildDropdownOptions(max: number): number[] {
  const options: number[] = [];
  for (let i = 1; i <= max; i++) options.push(i);
  return options;
}

export function useLotSettings() {
  const query = useQuery<GlobalLotSettingsResponse>({
    queryKey: ["/api/global-settings"],
    staleTime: 30_000,
  });

  const lotDropdownMax = useMemo(() => {
    return clampIntOr(query.data?.lotDropdownMax, ABSOLUTE_MAX_LOTS, 1, ABSOLUTE_MAX_LOTS);
  }, [query.data?.lotDropdownMax]);

  const lotPresetCards = useMemo(() => {
    const fromServer = Array.isArray(query.data?.lotPresetCardsArray)
      ? query.data?.lotPresetCardsArray
          .map((n) => clampIntOr(n, 1, 1, lotDropdownMax))
          .filter((n) => n >= 1 && n <= lotDropdownMax)
      : null;
    if (fromServer && fromServer.length > 0) {
      const unique = Array.from(new Set(fromServer));
      unique.sort((a, b) => a - b);
      return unique;
    }

    const parsed = parsePresetCards(query.data?.lotPresetCards, lotDropdownMax);
    if (parsed.length > 0) return parsed;
    return [1, 5, 10, 25, 50].filter((n) => n <= lotDropdownMax);
  }, [lotDropdownMax, query.data?.lotPresetCards, query.data?.lotPresetCardsArray]);

  const minPriceDistancePips = useMemo(() => {
    return clampIntOr(query.data?.minPriceDistancePips, DEFAULT_MIN_PRICE_DISTANCE_PIPS, 1, 10_000);
  }, [query.data?.minPriceDistancePips]);

  const lotDropdownOptions = useMemo(() => {
    const fromServer = Array.isArray(query.data?.lotDropdownOptions)
      ? query.data?.lotDropdownOptions
          .map((n) => clampIntOr(n, 1, 1, lotDropdownMax))
          .filter((n) => n >= 1 && n <= lotDropdownMax)
      : null;
    if (fromServer && fromServer.length > 0) {
      const unique = Array.from(new Set(fromServer));
      unique.sort((a, b) => a - b);
      return unique;
    }

    return buildDropdownOptions(lotDropdownMax);
  }, [lotDropdownMax, query.data?.lotDropdownOptions]);

  return {
    ...query,
    absoluteMaxLots: ABSOLUTE_MAX_LOTS,
    lotDropdownMax,
    lotDropdownOptions,
    lotPresetCards,
    minPriceDistancePips,
  };
}
