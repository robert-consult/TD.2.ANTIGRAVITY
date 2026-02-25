import { z } from "zod";

export const ADMIN_DATA_EXPORT_TYPES = [
  "trader_scouting",
  "deactivated_accounts",
  "all_trades",
  "daily_pnl",
] as const;

export const ADMIN_DATA_EXPORT_FORMATS = ["csv", "jsonl"] as const;

export const ADMIN_DATA_EXPORT_STATUSES = [
  "QUEUED",
  "RUNNING",
  "READY",
  "FAILED",
  "CANCELED",
  "EXPIRED",
] as const;

export const adminDataExportTypeSchema = z.enum(ADMIN_DATA_EXPORT_TYPES);
export const adminDataExportFormatSchema = z.enum(ADMIN_DATA_EXPORT_FORMATS);
export const adminDataExportStatusSchema = z.enum(ADMIN_DATA_EXPORT_STATUSES);

export const traderScoutingExportFiltersSchema = z
  .object({
    days: z.number().int().min(0).max(365).default(30),
    exportLimit: z.number().int().min(1).max(200_000).default(5_000),
    q: z.string().trim().max(200).optional(),
    categories: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
    minTrades: z.number().int().min(0).max(200_000).optional(),
    minWinRate: z.number().min(0).max(1).optional(),
    maxDrawdown: z.number().min(0).max(1).optional(),
    minNetProfit: z.number().optional(),
    maxBestDayPct: z.number().min(0).max(1).optional(),
    minProfitFactor: z.number().min(0).optional(),
    minSlUsage: z.number().min(0).max(1).optional(),
    minTpUsage: z.number().min(0).max(1).optional(),
    minHoldSec: z.number().int().min(0).optional(),
    maxHoldSec: z.number().int().min(0).optional(),
  })
  .strict();

export const deactivatedAccountsExportFiltersSchema = z
  .object({
    days: z.number().int().min(0).max(365).default(0),
    includeTrades: z.boolean().default(true),
  })
  .strict();

export const allTradesExportFiltersSchema = z
  .object({
    limit: z.number().int().min(1).max(5_000_000).default(50_000),
  })
  .strict();

export const dailyPnlExportFiltersSchema = z
  .object({
    limitDays: z.number().int().min(1).max(3650).default(365),
  })
  .strict();

const exportFilterSchemaByType = {
  trader_scouting: traderScoutingExportFiltersSchema,
  deactivated_accounts: deactivatedAccountsExportFiltersSchema,
  all_trades: allTradesExportFiltersSchema,
  daily_pnl: dailyPnlExportFiltersSchema,
} as const;

export const adminDataExportCreateRequestSchema = z
  .object({
    type: adminDataExportTypeSchema,
    format: adminDataExportFormatSchema.default("csv"),
    filters: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .transform((input) => {
    const parser = exportFilterSchemaByType[input.type];
    const parsedFilters = parser.parse(input.filters ?? {});
    return {
      type: input.type,
      format: input.format,
      filters: parsedFilters,
    };
  });

export type AdminDataExportCreateRequest = z.infer<typeof adminDataExportCreateRequestSchema>;

export const adminDataExportJobSchema = z.object({
  id: z.string().min(1),
  type: adminDataExportTypeSchema,
  format: adminDataExportFormatSchema,
  status: adminDataExportStatusSchema,
  requestedByAdminId: z.number().int().nullable(),
  filterHash: z.string().nullable(),
  filtersJson: z.record(z.string(), z.unknown()),
  objectKey: z.string().nullable(),
  rowCount: z.number().int().nullable(),
  bytesWritten: z.number().int().nullable(),
  truncated: z.boolean(),
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  queueName: z.string(),
  queueJobId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  completedAt: z.number().int().nullable(),
  expiresAt: z.number().int().nullable(),
  updatedAt: z.number().int(),
});

export type AdminDataExportJob = z.infer<typeof adminDataExportJobSchema>;

export const adminDataExportJobListResponseSchema = z.object({
  ok: z.literal(true),
  jobs: z.array(adminDataExportJobSchema),
});

export const adminDataExportCreateResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string().min(1),
  deduped: z.boolean().default(false),
});

export const adminDataExportDownloadLinkResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string().min(1),
  url: z.string().url(),
  expiresAt: z.number().int(),
});

export type TraderScoutingExportFilters = z.infer<typeof traderScoutingExportFiltersSchema>;
export type DeactivatedAccountsExportFilters = z.infer<typeof deactivatedAccountsExportFiltersSchema>;
export type AllTradesExportFilters = z.infer<typeof allTradesExportFiltersSchema>;
export type DailyPnlExportFilters = z.infer<typeof dailyPnlExportFiltersSchema>;
