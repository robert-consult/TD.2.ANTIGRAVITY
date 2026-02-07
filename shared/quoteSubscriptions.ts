import { z } from "zod";

export const QUOTE_MODES = ["BASIC_ONLY", "BASIC_PLUS_CUSTOM", "CUSTOM_ONLY"] as const;

export type QuoteMode = (typeof QUOTE_MODES)[number];

export const DEFAULT_QUOTE_MODE: QuoteMode = "BASIC_ONLY";
export const DEFAULT_GLOBAL_QUOTE_MODE: QuoteMode = "BASIC_PLUS_CUSTOM";

const QUOTE_MODE_SET = new Set<string>(QUOTE_MODES);

export function isQuoteMode(value: unknown): value is QuoteMode {
  return typeof value === "string" && QUOTE_MODE_SET.has(value);
}

export function normalizeQuoteMode(value: unknown, fallback: QuoteMode = DEFAULT_QUOTE_MODE): QuoteMode {
  return isQuoteMode(value) ? value : fallback;
}

export function quoteModeSupportsCustom(mode: QuoteMode): boolean {
  return mode === "BASIC_PLUS_CUSTOM" || mode === "CUSTOM_ONLY";
}

export function quoteModeIncludesBaseline(mode: QuoteMode): boolean {
  return mode === "BASIC_ONLY" || mode === "BASIC_PLUS_CUSTOM";
}

export const quoteModeLabels: Record<QuoteMode, string> = {
  BASIC_ONLY: "Basic only",
  BASIC_PLUS_CUSTOM: "Basic + Customizable",
  CUSTOM_ONLY: "Customizable only",
};

export const quoteModeSchema = z.enum(QUOTE_MODES);

export const quoteSubscriptionsConfigSchema = z.object({
  globalEnabled: z.boolean(),
  defaultMode: quoteModeSchema,
});

export const quoteSubscriptionsBulkModeSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(2000),
  mode: quoteModeSchema.nullable(),
});

export const quoteSubscriptionsSetSymbolsSchema = z.object({
  symbolIds: z.array(z.number().int().positive()).max(500),
});

export const quoteSubscriptionsSymbolSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
