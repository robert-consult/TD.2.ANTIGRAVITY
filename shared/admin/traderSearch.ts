import { z } from "zod";
import { INSTRUMENT_CATEGORY_TAGS } from "../instruments/categories";

export const TRADER_SEARCH_CATEGORIES = INSTRUMENT_CATEGORY_TAGS;

export const traderSearchCategorySchema = z.enum(TRADER_SEARCH_CATEGORIES);
export type TraderSearchCategory = z.infer<typeof traderSearchCategorySchema>;

export const traderSearchRowSchema = z.object({
  userId: z.number().int(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  trades: z.number().int(),
  winRate: z.number(),
  netProfit: z.number(),
  grossProfit: z.number(),
  grossLoss: z.number(),
  profitFactor: z.number().nullable(),
  avgHoldSec: z.number().nullable(),
  maxHoldSec: z.number().nullable(),
  minHoldSec: z.number().nullable(),
  maxDrawdown: z.number().nullable(), // 0..1
  bestDayPct: z.number().nullable(), // 0..1
  slUsage: z.number().nullable(), // 0..1
  tpUsage: z.number().nullable(), // 0..1
  assetMix: z.record(z.string(), z.number()).nullable(),
});

export type TraderSearchRow = z.infer<typeof traderSearchRowSchema>;

export const traderSearchResponseSchema = z.object({
  ok: z.literal(true),
  days: z.number().int(),
  cutoffSec: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  hasMore: z.boolean(),
  results: z.array(traderSearchRowSchema),
});

export type TraderSearchResponse = z.infer<typeof traderSearchResponseSchema>;

export const traderSearchCategoriesResponseSchema = z.object({
  ok: z.literal(true),
  categories: z.array(z.string()),
});

export type TraderSearchCategoriesResponse = z.infer<typeof traderSearchCategoriesResponseSchema>;

export const traderSearchBreakdownRowSchema = z.object({
  category: z.string(),
  trades: z.number().int(),
  netProfit: z.number(),
  winRate: z.number(),
  avgHoldSec: z.number().nullable(),
  maxHoldSec: z.number().nullable(),
  minHoldSec: z.number().nullable(),
});

export type TraderSearchBreakdownRow = z.infer<typeof traderSearchBreakdownRowSchema>;

export const traderSearchBreakdownResponseSchema = z.object({
  ok: z.literal(true),
  userId: z.number().int(),
  days: z.number().int(),
  cutoffSec: z.number().int(),
  rows: z.array(traderSearchBreakdownRowSchema),
});

export type TraderSearchBreakdownResponse = z.infer<typeof traderSearchBreakdownResponseSchema>;

export const traderSearchTradeExtremeSchema = z.object({
  id: z.number().int(),
  symbol: z.string().nullable(),
  side: z.enum(["buy", "sell"]).nullable(),
  openedAt: z.number().int().nullable(),
  closedAt: z.number().int().nullable(),
  holdSec: z.number().int().nullable(),
  profit: z.number(),
  priceReturnPct: z.number().nullable(), // 0..1
});

export type TraderSearchTradeExtreme = z.infer<typeof traderSearchTradeExtremeSchema>;

export const traderSearchTradeExtremesResponseSchema = z.object({
  ok: z.literal(true),
  userId: z.number().int(),
  days: z.number().int(),
  cutoffSec: z.number().int(),
  limit: z.number().int(),
  top: z.array(traderSearchTradeExtremeSchema),
  bottom: z.array(traderSearchTradeExtremeSchema),
});

export type TraderSearchTradeExtremesResponse = z.infer<typeof traderSearchTradeExtremesResponseSchema>;
