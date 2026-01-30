import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const ABSOLUTE_MAX_LOTS = 50;

type GlobalLotSettingsResponse = {
  lotPresetCards?: string | null;
  lotPresetCardsArray?: number[] | null;
  lotDropdownMax?: number | null;
  lotDropdownOptions?: number[] | null;
  absoluteMaxLots?: number | null;
};

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

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
    return clampInt(query.data?.lotDropdownMax, 1, ABSOLUTE_MAX_LOTS, ABSOLUTE_MAX_LOTS);
  }, [query.data?.lotDropdownMax]);

  const lotPresetCards = useMemo(() => {
    const fromServer = Array.isArray(query.data?.lotPresetCardsArray)
      ? query.data?.lotPresetCardsArray
          .map((n) => clampInt(n, 1, lotDropdownMax, 1))
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

  const lotDropdownOptions = useMemo(() => {
    const fromServer = Array.isArray(query.data?.lotDropdownOptions)
      ? query.data?.lotDropdownOptions
          .map((n) => clampInt(n, 1, lotDropdownMax, 1))
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
  };
}
