/**
 * Shared Zod validation schemas for Admin "DataTab" endpoints.
 *
 * These schemas accept both querystring-style inputs (strings / arrays) and
 * JSON inputs (numbers / booleans) so they can be reused across API routes and
 * background job filters.
 */
import { z } from "zod";

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeQueryString(value: unknown): string | undefined {
  const v = firstQueryValue(value);
  if (v == null) return undefined;
  const s = typeof v === "string" ? v : String(v);
  const trimmed = s.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeQueryNumber(value: unknown): number | undefined {
  const v = firstQueryValue(value);
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = normalizeQueryString(v);
  if (s == null) return undefined;
  const parsed = Number(s);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeQueryBoolean(value: unknown): boolean | undefined {
  const v = firstQueryValue(value);
  if (v == null) return undefined;
  if (typeof v === "boolean") return v;
  const s = normalizeQueryString(v);
  if (s == null) return undefined;
  const normalized = s.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const flattened = value
      .flatMap((entry) => {
        if (entry == null) return [];
        const s = typeof entry === "string" ? entry : String(entry);
        return s.split(",");
      })
      .map((entry) => entry.trim())
      .filter(Boolean);
    return flattened.length ? flattened : undefined;
  }
  const s = typeof value === "string" ? value : String(value);
  const out = s
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

function intParam(min: number, max: number) {
  return z
    .preprocess((v) => {
      const raw = normalizeQueryNumber(v);
      if (raw == null) return undefined;
      return Math.max(min, Math.min(max, Math.trunc(raw)));
    }, z.number().int().min(min).max(max).optional());
}

function floatParam(min: number, max: number) {
  return z.preprocess((v) => {
    const raw = normalizeQueryNumber(v);
    if (raw == null) return undefined;
    return Math.max(min, Math.min(max, raw));
  }, z.number().min(min).max(max).optional());
}

function pct01Param() {
  return z.preprocess((v) => {
    const raw = normalizeQueryNumber(v);
    if (raw == null) return undefined;
    const normalized = raw > 1 ? raw / 100 : raw;
    if (!Number.isFinite(normalized)) return undefined;
    return Math.max(0, Math.min(1, normalized));
  }, z.number().min(0).max(1).optional());
}

export const PositiveIntParamSchema = z.preprocess((v) => {
  const raw = normalizeQueryNumber(v);
  if (raw == null) return undefined;
  return Math.trunc(raw);
}, z.number().int().positive());

export const AdminDaysQuerySchema = z.object({
  days: intParam(0, 365).default(30),
});
export type AdminDaysQuery = z.infer<typeof AdminDaysQuerySchema>;

export const AdminTraderStatsQuerySchema = z.object({
  days: intParam(0, 365).default(30),
  limit: intParam(1, 50_000).default(5000),
  offset: intParam(0, 5_000_000).default(0),
});
export type AdminTraderStatsQuery = z.infer<typeof AdminTraderStatsQuerySchema>;

export const TraderScoutSearchQuerySchema = z
  .object({
    days: intParam(0, 365).default(30),
    limit: intParam(1, 200).default(25),
    offset: intParam(0, 200_000).default(0),
    minTrades: intParam(0, 1_000_000).default(0),
    q: z.preprocess((v) => {
      const value = normalizeQueryString(v);
      if (!value) return undefined;
      return value.slice(0, 200);
    }, z.string().optional()),
    categories: z.preprocess(normalizeStringList, z.array(z.string()).optional()),
    minWinRate: pct01Param(),
    minNetProfit: floatParam(-1_000_000_000, 1_000_000_000),
    maxDrawdown: pct01Param(),
    maxBestDayPct: pct01Param(),
    minProfitFactor: floatParam(0, 1_000_000_000),
    minSlUsage: pct01Param(),
    minTpUsage: pct01Param(),
    minHoldSec: intParam(0, 315_360_000), // 10y in seconds
    maxHoldSec: intParam(0, 315_360_000),
  })
  .refine((value) => {
    if (value.minHoldSec == null || value.maxHoldSec == null) return true;
    return value.minHoldSec <= value.maxHoldSec;
  }, { message: "minHoldSec must be <= maxHoldSec" });
export type TraderScoutSearchQuery = z.infer<typeof TraderScoutSearchQuerySchema>;

export const TraderScoutAssetClassesQuerySchema = z.object({
  days: intParam(0, 365).default(30),
});
export type TraderScoutAssetClassesQuery = z.infer<typeof TraderScoutAssetClassesQuerySchema>;

export const TraderScoutTradeExtremesQuerySchema = z.object({
  days: intParam(0, 365).default(30),
  limit: intParam(1, 100).default(10),
});
export type TraderScoutTradeExtremesQuery = z.infer<typeof TraderScoutTradeExtremesQuerySchema>;

export const AdminBooleanQuerySchema = z.object({
  value: z.preprocess((v) => normalizeQueryBoolean(v), z.boolean().optional()).default(false),
});
