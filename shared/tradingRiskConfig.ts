import { sanitizeMinPriceDistancePips } from "./tradingRules";

export type TradingRiskSource = Partial<{
  defaultLeverage: unknown;
  maxPositionSize: unknown;
  maxTradesPerUser: unknown;
  maxTradesPerInstrument: unknown;
  maxConcurrentLots: unknown;
  minPriceDistancePips: unknown;
  marketOpenTime: unknown;
  marketCloseTime: unknown;
  allowWeekendTrading: unknown;
  minHoldSec: unknown;
  enableLossLimits: unknown;
  dailyLossLimitPct: unknown;
  lifetimeLossLimitPct: unknown;
}>;

export type TradingRiskUserOverridesSource = Partial<{
  maxConcurrent: unknown;
  maxConcurrentPerInstrument: unknown;
  maxConcurrentLots: unknown;
  minHoldSec: unknown;
}>;

export type ResolvedTradingRiskConfig = {
  defaultLeverage: number;
  maxPositionSize: number;
  maxTradesPerUser: number;
  maxTradesPerInstrument: number;
  maxConcurrentLots: number;
  minPriceDistancePips: number;
  marketOpenTime: string;
  marketCloseTime: string;
  allowWeekendTrading: boolean;
  minHoldSec: number;
  enableLossLimits: boolean;
  dailyLossLimitPct: number;
  lifetimeLossLimitPct: number;
};

export type ResolvedTradeConcurrencyLimits = {
  maxTradesPerUser: number;
  maxTradesPerInstrument: number;
  maxConcurrentLots: number;
  minHoldSec: number;
  enableLossLimits: boolean;
  dailyLossLimitPct: number;
  lifetimeLossLimitPct: number;
};

export const DEFAULT_RESOLVED_TRADING_RISK_CONFIG: ResolvedTradingRiskConfig = {
  defaultLeverage: 50,
  maxPositionSize: 100_000,
  maxTradesPerUser: 10,
  maxTradesPerInstrument: 3,
  maxConcurrentLots: 50,
  minPriceDistancePips: sanitizeMinPriceDistancePips(undefined),
  marketOpenTime: "09:00",
  marketCloseTime: "17:00",
  allowWeekendTrading: false,
  minHoldSec: 60,
  enableLossLimits: true,
  dailyLossLimitPct: 10,
  lifetimeLossLimitPct: 20,
};

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  return Math.trunc(clampNumber(raw, fallback, min, max));
}

function toBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === 1 || raw === "1" || String(raw).trim().toLowerCase() === "true") return true;
  if (raw === 0 || raw === "0" || String(raw).trim().toLowerCase() === "false") return false;
  return fallback;
}

function normalizeMarketTime(raw: unknown, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function resolveTradingRiskConfig(source?: TradingRiskSource | null): ResolvedTradingRiskConfig {
  const defaults = DEFAULT_RESOLVED_TRADING_RISK_CONFIG;
  const row = source ?? {};

  return {
    defaultLeverage: clampNumber(row.defaultLeverage, defaults.defaultLeverage, 0.01, 1_000),
    maxPositionSize: clampNumber(row.maxPositionSize, defaults.maxPositionSize, 1, 1_000_000_000),
    maxTradesPerUser: clampInt(row.maxTradesPerUser, defaults.maxTradesPerUser, 1, 10_000),
    maxTradesPerInstrument: clampInt(row.maxTradesPerInstrument, defaults.maxTradesPerInstrument, 1, 10_000),
    maxConcurrentLots: clampInt(row.maxConcurrentLots, defaults.maxConcurrentLots, 1, 1_000_000),
    minPriceDistancePips: sanitizeMinPriceDistancePips(row.minPriceDistancePips),
    marketOpenTime: normalizeMarketTime(row.marketOpenTime, defaults.marketOpenTime),
    marketCloseTime: normalizeMarketTime(row.marketCloseTime, defaults.marketCloseTime),
    allowWeekendTrading: toBool(row.allowWeekendTrading, defaults.allowWeekendTrading),
    minHoldSec: clampInt(row.minHoldSec, defaults.minHoldSec, 1, 31 * 24 * 3600),
    enableLossLimits: toBool(row.enableLossLimits, defaults.enableLossLimits),
    dailyLossLimitPct: clampNumber(row.dailyLossLimitPct, defaults.dailyLossLimitPct, 0, 100),
    lifetimeLossLimitPct: clampNumber(row.lifetimeLossLimitPct, defaults.lifetimeLossLimitPct, 0, 100),
  };
}

export function resolveTradeConcurrencyLimits(
  configInput?: TradingRiskSource | ResolvedTradingRiskConfig | null,
  userOverrides?: TradingRiskUserOverridesSource | null,
): ResolvedTradeConcurrencyLimits {
  const config = resolveTradingRiskConfig(configInput);
  const overrides = userOverrides ?? {};

  return {
    maxTradesPerUser: clampInt(overrides.maxConcurrent, config.maxTradesPerUser, 1, 10_000),
    maxTradesPerInstrument: clampInt(
      overrides.maxConcurrentPerInstrument,
      config.maxTradesPerInstrument,
      1,
      10_000,
    ),
    maxConcurrentLots: clampInt(overrides.maxConcurrentLots, config.maxConcurrentLots, 1, 1_000_000),
    minHoldSec: clampInt(overrides.minHoldSec, config.minHoldSec, 1, 31 * 24 * 3600),
    enableLossLimits: config.enableLossLimits,
    dailyLossLimitPct: config.dailyLossLimitPct,
    lifetimeLossLimitPct: config.lifetimeLossLimitPct,
  };
}

export function resolveEffectiveTradeLeverage(
  configInput: TradingRiskSource | ResolvedTradingRiskConfig | null | undefined,
  userLeverage: unknown,
  challengeLeverageMultiplier?: unknown,
): number {
  const config = resolveTradingRiskConfig(configInput);
  const baseLeverage = clampNumber(userLeverage, config.defaultLeverage, 0.01, 1_000);
  const multiplier = clampNumber(challengeLeverageMultiplier, 1, 0.01, 100);
  return Math.max(0.01, baseLeverage * multiplier);
}

export function resolveEffectiveMinHoldSec(
  configInput?: TradingRiskSource | ResolvedTradingRiskConfig | null,
  userOverrides?: TradingRiskUserOverridesSource | null,
): number {
  return resolveTradeConcurrencyLimits(configInput, userOverrides).minHoldSec;
}

export function isTradingAllowedBySchedule(
  configInput?: TradingRiskSource | ResolvedTradingRiskConfig | null,
  nowDate: Date = new Date(),
): { allowed: boolean; reason: string } {
  const config = resolveTradingRiskConfig(configInput);
  const dayOfWeek = nowDate.getUTCDay();

  if (!config.allowWeekendTrading && (dayOfWeek === 0 || dayOfWeek === 6)) {
    return {
      allowed: false,
      reason: "Weekend trading is disabled. Markets open Monday.",
    };
  }

  const [openHour, openMinute] = config.marketOpenTime.split(":").map(Number);
  const [closeHour, closeMinute] = config.marketCloseTime.split(":").map(Number);
  const currentMinuteOfDay = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
  const openMinuteOfDay = openHour * 60 + openMinute;
  const closeMinuteOfDay = closeHour * 60 + closeMinute;

  const isWithinHours =
    closeMinuteOfDay < openMinuteOfDay
      ? currentMinuteOfDay >= openMinuteOfDay || currentMinuteOfDay < closeMinuteOfDay
      : currentMinuteOfDay >= openMinuteOfDay && currentMinuteOfDay < closeMinuteOfDay;

  if (!isWithinHours) {
    return {
      allowed: false,
      reason: `Trading is only available between ${config.marketOpenTime} and ${config.marketCloseTime} UTC.`,
    };
  }

  return { allowed: true, reason: "" };
}
