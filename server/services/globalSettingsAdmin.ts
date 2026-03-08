import { insertGlobalSettingsSchema, type GlobalSettings as GlobalSettingsRow } from "@shared/schema";
import { clampIntOr, nowSec } from "@shared/scalars";
import { z } from "zod";

const GLOBAL_PREFETCH_STRATEGY_VALUES = ["all", "critical", "none"] as const;
const HHMM_TIME_REGEX = /^(\d{2}):(\d{2})$/;

const ABSOLUTE_MAX_LOTS = 50;
const DEFAULT_LOT_PRESETS = [1, 5, 10, 25, 50];

const GLOBAL_SETTINGS_PATCH_SCHEMA = insertGlobalSettingsSchema
  .omit({
    id: true,
    updatedAt: true,
  })
  .partial()
  .strict();

export type GlobalSettingsUpdatePatch = z.infer<typeof GLOBAL_SETTINGS_PATCH_SCHEMA>;

export type ParsedGlobalSettingsUpdateInput =
  | { ok: true; next: GlobalSettingsUpdatePatch; expectedUpdatedAt: number | undefined }
  | { ok: false; message: string };

export type GlobalSettingsRiskSnapshot = {
  defaultLeverage: number;
  maxPositionSize: number;
  maxTradesPerUser: number;
  maxTradesPerInstrument: number;
  maxConcurrentLots: number;
  minPriceDistancePips: number;
  marketOpenTime: string;
  marketCloseTime: string;
  allowWeekendTrading: boolean;
  enableAutoClose: boolean;
  autoCloseAfterDays: number;
  autoCloseCheckFrequencyMinutes: number;
  minHoldSec: number;
  enableLossLimits: boolean;
  dailyLossLimitPct: number;
  lifetimeLossLimitPct: number;
  defaultUserStartingBalanceUsd: number;
  defaultUserStartingEquityUsd: number;
  defaultChallengeVirtualCapitalUsd: number;
  lotPresetCards: string;
  lotDropdownMax: number;
};

export type GlobalSettingsPerformanceSnapshot = {
  restFallbackPollMs: number;
  wsPushFrequencyMs: number;
  quoteFlushIntervalMs: number;
  maxWsReconnectAttempts: number;
  wsReconnectBaseDelayMs: number;
  prefetchStrategy: "all" | "critical" | "none";
  prefetchMaxConcurrency: number;
  prefetchStartDelayMs: number;
  prefetchFastConcurrencyCap: number;
  prefetchModerateConcurrencyCap: number;
  prefetchConstrainedConcurrencyCap: number;
  prefetchNetworkFastStartDelayMs: number;
  prefetchNetworkModerateStartDelayMs: number;
  prefetchNetworkConstrainedStartDelayMs: number;
  prefetchDeviceModerateStartDelayMs: number;
  prefetchDeviceConstrainedStartDelayMs: number;
  prefetchDeviceMinimalStartDelayMs: number;
  pollInstantMs: number;
  pollFastMs: number;
  pollModerateMs: number;
  pollConstrainedMs: number;
  pollMinimalMs: number;
  flushInstantMs: number;
  flushFastMs: number;
  flushModerateMs: number;
  flushConstrainedMs: number;
  flushMinimalMs: number;
};

export type GlobalSettingsWritePayload = Omit<GlobalSettingsRow, "id"> & { updatedAt: number };

const GLOBAL_SETTINGS_UPDATE_INPUT_SCHEMA = z
  .object({
    expectedUpdatedAt: coerceOptionalNumber(z.number().int().nonnegative()),
    defaultLeverage: coerceOptionalNumber(z.number().finite()),
    maxPositionSize: coerceOptionalNumber(z.number().finite()),
    maxTradesPerUser: coerceOptionalNumber(z.number().int()),
    maxTradesPerInstrument: coerceOptionalNumber(z.number().int()),
    maxConcurrentLots: coerceOptionalNumber(z.number().int()),
    minPriceDistancePips: coerceOptionalNumber(z.number().int()),
    marketOpenTime: coerceOptionalTime(),
    marketCloseTime: coerceOptionalTime(),
    allowWeekendTrading: coerceOptionalBoolean(),
    enableAutoClose: coerceOptionalBoolean(),
    autoCloseAfterDays: coerceOptionalNumber(z.number().int()),
    autoCloseCheckFrequencyMinutes: coerceOptionalNumber(z.number().int()),
    minHoldSec: coerceOptionalNumber(z.number().int()),
    enableLossLimits: coerceOptionalBoolean(),
    dailyLossLimitPct: coerceOptionalNumber(z.number().finite()),
    lifetimeLossLimitPct: coerceOptionalNumber(z.number().finite()),
    defaultUserStartingBalanceUsd: coerceOptionalNumber(z.number().finite().min(1).max(1_000_000_000)),
    defaultUserStartingEquityUsd: coerceOptionalNumber(z.number().finite().min(1).max(1_000_000_000)),
    defaultChallengeVirtualCapitalUsd: coerceOptionalNumber(z.number().finite().min(1).max(1_000_000_000)),
    lotPresetCards: z.preprocess(
      (value) => (value === undefined || value === null ? undefined : value),
      z.string().optional(),
    ),
    lotDropdownMax: coerceOptionalNumber(z.number().int()),
    restFallbackPollMs: coerceOptionalNumber(z.number().int().min(100).max(60_000)),
    wsPushFrequencyMs: coerceOptionalNumber(z.number().int().min(0).max(1_000)),
    quoteFlushIntervalMs: coerceOptionalNumber(z.number().int().min(20).max(5_000)),
    maxWsReconnectAttempts: coerceOptionalNumber(z.number().int().min(1).max(30)),
    wsReconnectBaseDelayMs: coerceOptionalNumber(z.number().int().min(100).max(30_000)),
    prefetchStrategy: coerceOptionalPrefetchStrategy(),
    prefetchMaxConcurrency: coerceOptionalNumber(z.number().int().min(1).max(6)),
    prefetchStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    prefetchFastConcurrencyCap: coerceOptionalNumber(z.number().int().min(1).max(6)),
    prefetchModerateConcurrencyCap: coerceOptionalNumber(z.number().int().min(1).max(6)),
    prefetchConstrainedConcurrencyCap: coerceOptionalNumber(z.number().int().min(1).max(6)),
    prefetchNetworkFastStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    prefetchNetworkModerateStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    prefetchNetworkConstrainedStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    prefetchDeviceModerateStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    prefetchDeviceConstrainedStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    prefetchDeviceMinimalStartDelayMs: coerceOptionalNumber(z.number().int().min(0).max(15_000)),
    pollInstantMs: coerceOptionalNumber(z.number().int().min(100).max(60_000)),
    pollFastMs: coerceOptionalNumber(z.number().int().min(100).max(60_000)),
    pollModerateMs: coerceOptionalNumber(z.number().int().min(100).max(60_000)),
    pollConstrainedMs: coerceOptionalNumber(z.number().int().min(100).max(60_000)),
    pollMinimalMs: coerceOptionalNumber(z.number().int().min(100).max(60_000)),
    flushInstantMs: coerceOptionalNumber(z.number().int().min(20).max(5_000)),
    flushFastMs: coerceOptionalNumber(z.number().int().min(20).max(5_000)),
    flushModerateMs: coerceOptionalNumber(z.number().int().min(20).max(5_000)),
    flushConstrainedMs: coerceOptionalNumber(z.number().int().min(20).max(5_000)),
    flushMinimalMs: coerceOptionalNumber(z.number().int().min(20).max(5_000)),
  })
  .strict();

function coerceOptionalNumber(schema: z.ZodNumber) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      return Number(trimmed);
    }
    return Number.NaN;
  }, schema.optional());
}

function coerceOptionalBoolean() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean().optional());
}

function coerceOptionalTime() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") return value;
    return value.trim();
  }, z.string().regex(HHMM_TIME_REGEX, "must be HH:MM").optional());
}

function coerceOptionalPrefetchStrategy() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") return value;
    return value.trim().toLowerCase();
  }, z.enum(GLOBAL_PREFETCH_STRATEGY_VALUES).optional());
}

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid global settings payload";
  const path = issue.path.length > 0 ? `${issue.path.join(".")} ` : "";
  return `${path}${issue.message}`.trim();
}

function parseTime(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const s = String(value).trim();
  const m = HHMM_TIME_REGEX.exec(s);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return `${m[1]}:${m[2]}`;
}

function normalizeGlobalPrefetchStrategy(
  value: unknown,
  fallback: "all" | "critical" | "none" = "all",
): "all" | "critical" | "none" {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (normalized === "critical" || normalized === "none") return normalized;
  return "all";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return clampIntOr(value, fallback, min, max);
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parsePresetCards(raw: string): number[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("lotPresetCards must be a JSON array");
  return parsed
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.trunc(n));
}

function sanitizePresetCards(values: number[], max: number): number[] {
  const filtered = values.filter((n) => n >= 1 && n <= max);
  const unique = Array.from(new Set(filtered));
  unique.sort((a, b) => a - b);
  if (unique.length > 0) return unique;
  const fallback = DEFAULT_LOT_PRESETS.filter((n) => n <= max);
  return fallback.length > 0 ? fallback : [1];
}

function removeUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function parseGlobalSettingsUpdateInput(bodyRaw: unknown): ParsedGlobalSettingsUpdateInput {
  const body =
    bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};

  const parsed = GLOBAL_SETTINGS_UPDATE_INPUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) };
  }

  const { expectedUpdatedAt, ...rawPatch } = parsed.data;
  const compactPatch = removeUndefined(rawPatch);
  const patchParsed = GLOBAL_SETTINGS_PATCH_SCHEMA.safeParse(compactPatch);
  if (!patchParsed.success) {
    return { ok: false, message: formatZodError(patchParsed.error) };
  }

  return {
    ok: true,
    next: patchParsed.data,
    expectedUpdatedAt,
  };
}

export function buildGlobalSettingsRiskSnapshot(
  source: Partial<GlobalSettingsRow> | null | undefined,
): GlobalSettingsRiskSnapshot {
  const lotDropdownMax = clampInt(source?.lotDropdownMax ?? ABSOLUTE_MAX_LOTS, 1, ABSOLUTE_MAX_LOTS, ABSOLUTE_MAX_LOTS);

  let presetValues: number[] = [];
  if (typeof source?.lotPresetCards === "string") {
    try {
      presetValues = parsePresetCards(source.lotPresetCards);
    } catch {
      presetValues = [];
    }
  }

  const defaultUserStartingBalanceUsd = clampFloat(
    source?.defaultUserStartingBalanceUsd ?? 1_000_000,
    1,
    1_000_000_000,
    1_000_000,
  );

  return {
    defaultLeverage: clampFloat(source?.defaultLeverage ?? 50, 0.01, 10_000, 50),
    maxPositionSize: clampFloat(source?.maxPositionSize ?? 100_000, 1, 1_000_000_000, 100_000),
    maxTradesPerUser: clampInt(source?.maxTradesPerUser ?? 10, 1, 10_000, 10),
    maxTradesPerInstrument: clampInt(source?.maxTradesPerInstrument ?? 3, 1, 10_000, 3),
    maxConcurrentLots: clampInt(source?.maxConcurrentLots ?? 50, 1, ABSOLUTE_MAX_LOTS, 50),
    minPriceDistancePips: clampInt(source?.minPriceDistancePips ?? 20, 1, 10_000, 20),
    marketOpenTime: parseTime(source?.marketOpenTime) ?? "09:00",
    marketCloseTime: parseTime(source?.marketCloseTime) ?? "17:00",
    allowWeekendTrading: Boolean(source?.allowWeekendTrading ?? false),
    enableAutoClose: Boolean(source?.enableAutoClose ?? true),
    autoCloseAfterDays: clampInt(source?.autoCloseAfterDays ?? 4, 1, 365, 4),
    autoCloseCheckFrequencyMinutes: clampInt(
      source?.autoCloseCheckFrequencyMinutes ?? 60,
      1,
      10_080,
      60,
    ),
    minHoldSec: clampInt(source?.minHoldSec ?? 60, 1, 31_536_000, 60),
    enableLossLimits: Boolean(source?.enableLossLimits ?? true),
    dailyLossLimitPct: clampFloat(source?.dailyLossLimitPct ?? 10, 0, 100, 10),
    lifetimeLossLimitPct: clampFloat(source?.lifetimeLossLimitPct ?? 20, 0, 100, 20),
    defaultUserStartingBalanceUsd,
    defaultUserStartingEquityUsd: clampFloat(
      source?.defaultUserStartingEquityUsd ?? source?.defaultUserStartingBalanceUsd ?? 1_000_000,
      1,
      1_000_000_000,
      1_000_000,
    ),
    defaultChallengeVirtualCapitalUsd: clampFloat(
      source?.defaultChallengeVirtualCapitalUsd ?? 100_000,
      1,
      1_000_000_000,
      100_000,
    ),
    lotPresetCards: JSON.stringify(sanitizePresetCards(presetValues, lotDropdownMax)),
    lotDropdownMax,
  };
}

export function buildGlobalSettingsPerformanceSnapshot(
  source: Partial<GlobalSettingsRow> | null | undefined,
): GlobalSettingsPerformanceSnapshot {
  return {
    restFallbackPollMs: clampInt(source?.restFallbackPollMs ?? 500, 100, 60_000, 500),
    wsPushFrequencyMs: clampInt(source?.wsPushFrequencyMs ?? 0, 0, 1_000, 0),
    quoteFlushIntervalMs: clampInt(source?.quoteFlushIntervalMs ?? 50, 20, 5_000, 50),
    maxWsReconnectAttempts: clampInt(source?.maxWsReconnectAttempts ?? 30, 1, 30, 30),
    wsReconnectBaseDelayMs: clampInt(source?.wsReconnectBaseDelayMs ?? 1500, 100, 30_000, 1500),
    prefetchStrategy: normalizeGlobalPrefetchStrategy(source?.prefetchStrategy ?? "all"),
    prefetchMaxConcurrency: clampInt(source?.prefetchMaxConcurrency ?? 4, 1, 6, 4),
    prefetchStartDelayMs: clampInt(source?.prefetchStartDelayMs ?? 0, 0, 15_000, 0),
    prefetchFastConcurrencyCap: clampInt(source?.prefetchFastConcurrencyCap ?? 3, 1, 6, 3),
    prefetchModerateConcurrencyCap: clampInt(source?.prefetchModerateConcurrencyCap ?? 2, 1, 6, 2),
    prefetchConstrainedConcurrencyCap: clampInt(source?.prefetchConstrainedConcurrencyCap ?? 1, 1, 6, 1),
    prefetchNetworkFastStartDelayMs: clampInt(source?.prefetchNetworkFastStartDelayMs ?? 75, 0, 15_000, 75),
    prefetchNetworkModerateStartDelayMs: clampInt(source?.prefetchNetworkModerateStartDelayMs ?? 200, 0, 15_000, 200),
    prefetchNetworkConstrainedStartDelayMs: clampInt(
      source?.prefetchNetworkConstrainedStartDelayMs ?? 450,
      0,
      15_000,
      450,
    ),
    prefetchDeviceModerateStartDelayMs: clampInt(source?.prefetchDeviceModerateStartDelayMs ?? 50, 0, 15_000, 50),
    prefetchDeviceConstrainedStartDelayMs: clampInt(source?.prefetchDeviceConstrainedStartDelayMs ?? 150, 0, 15_000, 150),
    prefetchDeviceMinimalStartDelayMs: clampInt(source?.prefetchDeviceMinimalStartDelayMs ?? 300, 0, 15_000, 300),
    pollInstantMs: clampInt(source?.pollInstantMs ?? 200, 100, 60_000, 200),
    pollFastMs: clampInt(source?.pollFastMs ?? 500, 100, 60_000, 500),
    pollModerateMs: clampInt(source?.pollModerateMs ?? 1500, 100, 60_000, 1500),
    pollConstrainedMs: clampInt(source?.pollConstrainedMs ?? 4000, 100, 60_000, 4000),
    pollMinimalMs: clampInt(source?.pollMinimalMs ?? 6000, 100, 60_000, 6000),
    flushInstantMs: clampInt(source?.flushInstantMs ?? 50, 20, 5_000, 50),
    flushFastMs: clampInt(source?.flushFastMs ?? 150, 20, 5_000, 150),
    flushModerateMs: clampInt(source?.flushModerateMs ?? 300, 20, 5_000, 300),
    flushConstrainedMs: clampInt(source?.flushConstrainedMs ?? 500, 20, 5_000, 500),
    flushMinimalMs: clampInt(source?.flushMinimalMs ?? 1000, 20, 5_000, 1000),
  };
}

export function resolveGlobalSettingsWrite(params: {
  existing: GlobalSettingsRow | null | undefined;
  patch: GlobalSettingsUpdatePatch;
  nowSec: number;
}): {
  write: GlobalSettingsWritePayload;
  riskSnapshot: GlobalSettingsRiskSnapshot;
  performanceSnapshot: GlobalSettingsPerformanceSnapshot;
} {
  const source: Partial<GlobalSettingsRow> = {
    ...(params.existing ?? {}),
    ...(params.patch ?? {}),
  };

  const riskSnapshot = buildGlobalSettingsRiskSnapshot(source);
  if (params.patch.lotPresetCards !== undefined) {
    try {
      const parsed = parsePresetCards(params.patch.lotPresetCards);
      riskSnapshot.lotPresetCards = JSON.stringify(
        sanitizePresetCards(parsed, riskSnapshot.lotDropdownMax),
      );
    } catch {
      throw new Error("Invalid lotPresetCards JSON array");
    }
  }

  const performanceSnapshot = buildGlobalSettingsPerformanceSnapshot(source);

  const normalizedNowSec = Number.isFinite(params.nowSec)
    ? Math.max(0, Math.trunc(params.nowSec))
    : nowSec();

  const existingUpdatedAtSec =
    params.existing && typeof params.existing.updatedAt === "number"
      ? Math.max(0, Math.trunc(params.existing.updatedAt))
      : 0;
  const nextUpdatedAtSec = params.existing
    ? Math.max(normalizedNowSec, existingUpdatedAtSec + 1)
    : normalizedNowSec;

  const write: GlobalSettingsWritePayload = {
    ...riskSnapshot,
    ...performanceSnapshot,
    updatedAt: nextUpdatedAtSec,
  };

  return {
    write,
    riskSnapshot,
    performanceSnapshot,
  };
}

export function buildDefaultGlobalSettingsWrite(nowSec: number): GlobalSettingsWritePayload {
  return resolveGlobalSettingsWrite({
    existing: null,
    patch: {},
    nowSec,
  }).write;
}
