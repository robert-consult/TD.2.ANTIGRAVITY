import { z } from "zod";

export const ProviderDriverSchema = z.enum(["twelvedata", "oneforge", "generic_rest_v1"]);
export type ProviderDriver = z.infer<typeof ProviderDriverSchema>;

// Secrets should generally be provided via env refs like "env:TWELVE_DATA_API_KEY".
export const SecretRefSchema = z.string().min(1);

export const ProviderRateLimitSchema = z
  .object({
    // Minimum delay between request starts (per provider instance).
    minTimeMs: z.number().int().min(0).max(60_000).optional().default(100),
    // Maximum in-flight requests (per provider instance).
    maxConcurrent: z.number().int().min(1).max(50).optional().default(2),
    // Hard cap to prevent unbounded queue growth (admin test spam / misconfig).
    maxQueueSize: z.number().int().min(0).max(10_000).optional().default(250),
  })
  .optional()
  .default({ minTimeMs: 100, maxConcurrent: 2, maxQueueSize: 250 });

export const TwelveDataProviderConfigSchema = z.object({
  driver: z.literal("twelvedata"),
  apiKey: SecretRefSchema,
  restBaseUrl: z.string().url().optional().default("https://api.twelvedata.com"),
  quoteEndpoint: z.string().min(1).optional().default("/quote"),
  timeoutMs: z.number().int().min(500).max(60_000).optional().default(8_000),
  maxBatchSymbols: z.number().int().min(1).max(120).optional().default(8),
  rateLimit: ProviderRateLimitSchema,
});
export type TwelveDataProviderConfig = z.infer<typeof TwelveDataProviderConfigSchema>;

export const OneForgeProviderConfigSchema = z.object({
  driver: z.literal("oneforge"),
  apiKey: SecretRefSchema,
  restBaseUrl: z.string().url().optional().default("https://api.1forge.com"),
  quoteEndpoint: z.string().min(1).optional().default("/quotes"),
  timeoutMs: z.number().int().min(500).max(60_000).optional().default(8_000),
  maxBatchSymbols: z.number().int().min(1).max(500).optional().default(100),
  rateLimit: ProviderRateLimitSchema,
});
export type OneForgeProviderConfig = z.infer<typeof OneForgeProviderConfigSchema>;

const GenericRestV1FieldsSchema = z.object({
  symbol: z.string().min(1).optional().default("symbol"),
  bid: z.string().min(1).optional().default("bid"),
  ask: z.string().min(1).optional().default("ask"),
  price: z.string().min(1).optional().default("price"),
  timestamp: z.string().min(1).optional().default("timestamp"),
});

export const GenericRestV1ProviderConfigSchema = z.object({
  driver: z.literal("generic_rest_v1"),

  restBaseUrl: z.string().url(),
  quotePath: z.string().min(1), // may include {{symbols}} and/or {{apikey}}

  apiKey: SecretRefSchema.optional(),
  apiKeyParamName: z.string().min(1).optional().default("apikey"),

  symbolsParamName: z.string().min(1).optional().default("symbols"),
  symbolsJoinChar: z.string().min(1).optional().default(","),

  timeoutMs: z.number().int().min(500).max(60_000).optional().default(8_000),
  maxBatchSymbols: z.number().int().min(1).max(500).optional().default(50),

  responseMode: z.enum(["array", "map", "wrapper_array"]).optional().default("array"),
  wrapperKey: z.string().min(1).optional(),

  fields: GenericRestV1FieldsSchema.optional().default({
    symbol: "symbol",
    bid: "bid",
    ask: "ask",
    price: "price",
    timestamp: "timestamp",
  }),
  rateLimit: ProviderRateLimitSchema,
}).superRefine((cfg, ctx) => {
  if (cfg.responseMode === "wrapper_array" && !cfg.wrapperKey) {
    ctx.addIssue({
      code: "custom",
      message: "wrapperKey is required when responseMode is wrapper_array",
      path: ["wrapperKey"],
    });
  }

  if (cfg.quotePath.includes("{{apikey}}") && !cfg.apiKey) {
    ctx.addIssue({
      code: "custom",
      message: "apiKey is required when quotePath includes {{apikey}}",
      path: ["apiKey"],
    });
  }
});
export type GenericRestV1ProviderConfig = z.infer<typeof GenericRestV1ProviderConfigSchema>;

export const MarketDataProviderConfigSchema = z.discriminatedUnion("driver", [
  TwelveDataProviderConfigSchema,
  OneForgeProviderConfigSchema,
  GenericRestV1ProviderConfigSchema,
]);
export type MarketDataProviderConfig = z.infer<typeof MarketDataProviderConfigSchema>;
