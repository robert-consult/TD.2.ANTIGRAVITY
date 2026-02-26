import { Router } from "express";
import type { Request } from "express";
import { dbClient } from "../../db";
import { requireAdmin } from "../middleware/requireAdmin";
import { onLiveEvent } from "../services/liveBus";
import { TRADER_SEARCH_CATEGORIES } from "@shared/admin/traderSearch";
import {
  PositiveIntParamSchema,
  TraderScoutAssetClassesQuerySchema,
  TraderScoutSearchQuerySchema,
  TraderScoutTradeExtremesQuerySchema,
} from "@shared/admin/dataTab";
import { canonicalizeInstrumentCategory, normalizeInstrumentCategory } from "@shared/instruments/categories";
import {
  TRADE_NET_PROFIT_SQL,
  TRADER_SCOUT_CATEGORY_SQL,
  TRADER_SCOUT_SEARCH_SQL,
} from "../services/traderScoutQuery";
import { buildAuditContext } from "../lib/auditContext";
import { sha256 } from "../legal/cryptoUtils";
import { appendAuditEntry } from "../grift/griftAdminAudit";
import { getGriftDb } from "../grift/griftDb";
import { observeHttpRequestDuration } from "./metricsState";

const TRADER_SCOUT_CATEGORY_CACHE_TTL_MS = 60_000;
let traderScoutCategoryLiveBusSubscribed = false;
let traderScoutCategoriesCache: { loadedAtMs: number; categories: string[]; set: Set<string> } | null = null;

function ensureTraderScoutCategorySubscription(): void {
  if (traderScoutCategoryLiveBusSubscribed) return;
  traderScoutCategoryLiveBusSubscribed = true;
  onLiveEvent((event) => {
    if (!event || typeof event !== "object") return;
    if (
      event.type === "symbols:updated" ||
      event.type === "market-data:providers-updated" ||
      event.type === "quote-subscriptions:updated"
    ) {
      traderScoutCategoriesCache = null;
    }
  });
}

async function loadTraderScoutAllowedCategories(): Promise<{ loadedAtMs: number; categories: string[]; set: Set<string> }> {
  ensureTraderScoutCategorySubscription();
  const now = Date.now();
  if (traderScoutCategoriesCache && now - traderScoutCategoriesCache.loadedAtMs < TRADER_SCOUT_CATEGORY_CACHE_TTL_MS) {
    return traderScoutCategoriesCache;
  }

  const set = new Set<string>();
  for (const category of TRADER_SEARCH_CATEGORIES as unknown as string[]) {
    set.add(String(category));
  }

  try {
    const response = await dbClient.query(`
      SELECT DISTINCT LOWER(COALESCE(NULLIF(category, ''), 'unknown')) AS category
      FROM symbol_configs
    `);
    for (const row of response.rows ?? []) {
      const value = String((row as any)?.category ?? "").trim();
      if (!value) continue;
      set.add(normalizeInstrumentCategory(value, "unknown"));
    }
  } catch {
    // Fall back to static category list when symbol table read fails.
  }

  const categories = Array.from(set.values()).sort();
  traderScoutCategoriesCache = { loadedAtMs: now, categories, set };
  return traderScoutCategoriesCache;
}

async function runTraderScoutSearch(args: {
  cutoffSec: number;
  categories: string[];
  q: string | null;
  minHoldSec: number | null;
  maxHoldSec: number | null;
  minTrades: number;
  minWinRate: number | null;
  minNetProfit: number | null;
  maxDrawdown: number | null;
  maxBestDayPct: number | null;
  minProfitFactor: number | null;
  minSlUsage: number | null;
  minTpUsage: number | null;
  limit: number;
  offset: number;
}): Promise<{
  hasMore: boolean;
  results: Array<{
    userId: number;
    username: string | null;
    email: string | null;
    trades: number;
    winRate: number;
    netProfit: number;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number | null;
    avgHoldSec: number | null;
    maxHoldSec: number | null;
    minHoldSec: number | null;
    maxDrawdown: number | null;
    bestDayPct: number | null;
    slUsage: number | null;
    tpUsage: number | null;
    assetMix: any;
  }>;
}> {
  const limit = Math.max(1, Math.min(200_000, Math.trunc(args.limit || 25)));
  const offset = Math.max(0, Math.min(200_000, Math.trunc(args.offset || 0)));
  const params = [
    args.cutoffSec,
    args.categories.length ? args.categories : null,
    args.q,
    args.minHoldSec === null ? null : Math.max(0, Math.trunc(args.minHoldSec)),
    args.maxHoldSec === null ? null : Math.max(0, Math.trunc(args.maxHoldSec)),
    Math.max(0, Math.trunc(args.minTrades)),
    args.minWinRate,
    args.minNetProfit,
    args.maxDrawdown,
    args.maxBestDayPct,
    args.minProfitFactor,
    args.minSlUsage,
    args.minTpUsage,
    limit + 1,
    offset,
  ];

  const rows = (await dbClient.query(TRADER_SCOUT_SEARCH_SQL, params)).rows as any[];
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const results = sliced.map((r) => ({
    userId: Number(r.user_id),
    username: r.username ?? null,
    email: r.email ?? null,
    trades: Number(r.trades ?? 0),
    winRate: Number(r.win_rate ?? 0),
    netProfit: Number(r.net_profit ?? 0),
    grossProfit: Number(r.gross_profit ?? 0),
    grossLoss: Number(r.gross_loss ?? 0),
    profitFactor: r.profit_factor == null ? null : Number(r.profit_factor),
    avgHoldSec: r.avg_hold_sec == null ? null : Number(r.avg_hold_sec),
    maxHoldSec: r.max_hold_sec == null ? null : Number(r.max_hold_sec),
    minHoldSec: r.min_hold_sec == null ? null : Number(r.min_hold_sec),
    maxDrawdown: r.max_drawdown == null ? null : Number(r.max_drawdown),
    bestDayPct: r.best_day_pct == null ? null : Number(r.best_day_pct),
    slUsage: r.sl_usage == null ? null : Number(r.sl_usage),
    tpUsage: r.tp_usage == null ? null : Number(r.tp_usage),
    assetMix: r.asset_mix ?? null,
  }));

  return { hasMore, results };
}

function normalizeTraderScoutCategory(raw: string): string | null {
  return canonicalizeInstrumentCategory(raw);
}

export const adminTraderScoutingRouter = Router();
adminTraderScoutingRouter.use(requireAdmin);

adminTraderScoutingRouter.get("/trader-scouting/categories", async (_req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const allowed = await loadTraderScoutAllowedCategories();
    return res.json({ ok: true, categories: allowed.categories });
  } catch (error) {
    console.error("Trader scouting categories list error:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    observeHttpRequestDuration(
      "/api/admin/trader-scouting/categories",
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  }
});

adminTraderScoutingRouter.get("/trader-scouting/search", async (req: Request, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const parsedResult = TraderScoutSearchQuerySchema.safeParse({
      ...req.query,
      categories: req.query.categories ?? req.query.assetClasses,
      minWinRate: req.query.minWinRate ?? req.query.minWinRatePct,
      maxDrawdown: req.query.maxDrawdown ?? req.query.maxDrawdownPct,
      minNetProfit: req.query.minNetProfit ?? req.query.minProfit,
      minSlUsage: req.query.minSlUsage ?? req.query.minSlUsagePct,
      minTpUsage: req.query.minTpUsage ?? req.query.minTpUsagePct,
    });
    if (!parsedResult.success) {
      return res.status(400).json({
        message: "Invalid query parameters",
        issues: parsedResult.error.issues,
      });
    }

    const parsed = parsedResult.data;

    const days = parsed.days;
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

    const qRaw = (parsed.q ?? "").trim();
    const q = qRaw ? `%${qRaw}%` : null;

    const allowed = await loadTraderScoutAllowedCategories();
    const categories: string[] = [];
    for (const rawCategory of parsed.categories ?? []) {
      const normalized = normalizeTraderScoutCategory(rawCategory);
      if (!normalized) {
        return res.status(400).json({ message: `Invalid category: ${rawCategory}`, allowed: allowed.categories });
      }
      categories.push(normalized);
    }
    const normalizedCategories = Array.from(new Set(categories));
    for (const category of normalizedCategories) {
      if (!allowed.set.has(category)) {
        return res.status(400).json({ message: `Invalid category: ${category}`, allowed: allowed.categories });
      }
    }

    const minTrades = parsed.minTrades;
    const minWinRate = parsed.minWinRate ?? null;
    const maxDrawdown = parsed.maxDrawdown ?? null;
    const maxBestDayPct = parsed.maxBestDayPct ?? null;
    const minNetProfit = parsed.minNetProfit ?? null;
    const minHoldSec = parsed.minHoldSec ?? null;
    const maxHoldSec = parsed.maxHoldSec ?? null;
    const minProfitFactor = parsed.minProfitFactor ?? null;
    const minSlUsage = parsed.minSlUsage ?? null;
    const minTpUsage = parsed.minTpUsage ?? null;
    const limit = parsed.limit;
    const offset = parsed.offset;

    const { results, hasMore } = await runTraderScoutSearch({
      cutoffSec,
      categories: normalizedCategories,
      q,
      minHoldSec,
      maxHoldSec,
      minTrades,
      minWinRate,
      minNetProfit,
      maxDrawdown,
      maxBestDayPct,
      minProfitFactor,
      minSlUsage,
      minTpUsage,
      limit,
      offset,
    });

    const shouldAuditSearch =
      (qRaw.length >= 3 ||
        normalizedCategories.length > 0 ||
        minWinRate !== null ||
        maxDrawdown !== null ||
        maxBestDayPct !== null ||
        minProfitFactor !== null ||
        minSlUsage !== null ||
        minTpUsage !== null) &&
      offset === 0;

    if (shouldAuditSearch && req.session?.userId) {
      try {
        const auditCtx = buildAuditContext(req);
        const griftDb = getGriftDb();
        await appendAuditEntry(griftDb, Number(req.session.userId), "TRADER_SCOUT_SEARCH", "analytics", 1, {
          correlationId: auditCtx.correlationId,
          days,
          cutoffSec,
          qHash: qRaw ? sha256(qRaw) : null,
          qLen: qRaw.length || 0,
          categories: normalizedCategories,
          minTrades,
          minWinRate,
          maxDrawdown,
          minNetProfit,
          maxBestDayPct,
          minHoldSec,
          maxHoldSec,
          minProfitFactor,
          minSlUsage,
          minTpUsage,
        });
      } catch (auditErr) {
        console.error("Trader scouting audit write failed:", auditErr);
      }
    }

    return res.json({
      ok: true,
      days,
      cutoffSec,
      limit,
      offset,
      hasMore,
      results,
    });
  } catch (error) {
    console.error("Trader scouting search error:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    observeHttpRequestDuration(
      "/api/admin/trader-scouting/search",
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  }
});

adminTraderScoutingRouter.get("/trader-scouting/:userId/asset-classes", async (req: Request, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const userIdResult = PositiveIntParamSchema.safeParse(req.params.userId);
    if (!userIdResult.success) return res.status(400).json({ message: "Invalid userId" });
    const userId = userIdResult.data;

    const parsedDaysResult = TraderScoutAssetClassesQuerySchema.safeParse(req.query);
    if (!parsedDaysResult.success) {
      return res.status(400).json({ message: "Invalid query parameters", issues: parsedDaysResult.error.issues });
    }
    const { days } = parsedDaysResult.data;
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;
    const sqlText = `
	WITH ft AS (
	  SELECT
    t.user_id,
    t.opened_at,
    t.closed_at,
    ${TRADE_NET_PROFIT_SQL} AS profit,
    ${TRADER_SCOUT_CATEGORY_SQL} AS category
  FROM trades t
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.user_id = $1::int
    AND t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND t.closed_at >= $2::int
)
SELECT
  category,
  COUNT(*)::int AS trades,
  SUM(profit) AS net_profit,
  (SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS win_rate,
  AVG((closed_at - opened_at)::float) AS avg_hold_sec,
  MAX((closed_at - opened_at)::float) AS max_hold_sec,
  MIN((closed_at - opened_at)::float) AS min_hold_sec
FROM ft
GROUP BY category
ORDER BY net_profit DESC;
    `;

    const rows = (await dbClient.query(sqlText, [userId, cutoffSec])).rows as any[];
    const out = rows.map((row) => ({
      category: row.category,
      trades: Number(row.trades ?? 0),
      netProfit: Number(row.net_profit ?? 0),
      winRate: Number(row.win_rate ?? 0),
      avgHoldSec: row.avg_hold_sec == null ? null : Number(row.avg_hold_sec),
      maxHoldSec: row.max_hold_sec == null ? null : Number(row.max_hold_sec),
      minHoldSec: row.min_hold_sec == null ? null : Number(row.min_hold_sec),
    }));

    if (req.session?.userId) {
      try {
        const auditCtx = buildAuditContext(req);
        const griftDb = getGriftDb();
        await appendAuditEntry(griftDb, Number(req.session.userId), "TRADER_SCOUT_DRILLDOWN", "user", userId, {
          correlationId: auditCtx.correlationId,
          endpoint: "asset-classes",
          days,
          cutoffSec,
        });
      } catch (auditErr) {
        console.error("Trader scouting drilldown audit write failed:", auditErr);
      }
    }

    return res.json({ ok: true, userId, days, cutoffSec, rows: out });
  } catch (error) {
    console.error("Trader scouting categories drilldown error:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    observeHttpRequestDuration(
      "/api/admin/trader-scouting/:userId/asset-classes",
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  }
});

adminTraderScoutingRouter.get("/trader-scouting/:userId/trade-extremes", async (req: Request, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const userIdResult = PositiveIntParamSchema.safeParse(req.params.userId);
    if (!userIdResult.success) return res.status(400).json({ message: "Invalid userId" });
    const userId = userIdResult.data;

    const parsedQueryResult = TraderScoutTradeExtremesQuerySchema.safeParse(req.query);
    if (!parsedQueryResult.success) {
      return res.status(400).json({ message: "Invalid query parameters", issues: parsedQueryResult.error.issues });
    }
    const { days, limit } = parsedQueryResult.data;
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;
    const sqlText = `
	WITH ft AS (
	  SELECT
	    t.id,
    sc.symbol,
    t.type,
    t.open_price,
    t.close_price,
    t.opened_at,
    t.closed_at,
    ${TRADE_NET_PROFIT_SQL} AS profit,
    CASE
      WHEN t.open_price IS NULL OR t.open_price = 0 OR t.close_price IS NULL THEN NULL
      WHEN t.type = 'BUY' THEN (t.close_price - t.open_price) / t.open_price
      WHEN t.type = 'SELL' THEN (t.open_price - t.close_price) / t.open_price
      ELSE NULL
    END AS price_return_pct
  FROM trades t
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.user_id = $1::int
    AND t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND t.closed_at >= $2::int
)
SELECT 'top' AS bucket, *
FROM (
  SELECT * FROM ft ORDER BY profit DESC, closed_at DESC LIMIT $3::int
) a
UNION ALL
SELECT 'bottom' AS bucket, *
FROM (
  SELECT * FROM ft ORDER BY profit ASC, closed_at DESC LIMIT $3::int
) b;
    `;
    const rows = (await dbClient.query(sqlText, [userId, cutoffSec, limit])).rows as any[];
    const top: any[] = [];
    const bottom: any[] = [];

    const toSide = (value: any): "buy" | "sell" | null => {
      const normalized = String(value || "").toUpperCase();
      if (normalized === "BUY") return "buy";
      if (normalized === "SELL") return "sell";
      return null;
    };

    for (const row of rows) {
      const item = {
        id: Number(row.id),
        symbol: row.symbol ?? null,
        side: toSide(row.type),
        openedAt: row.opened_at == null ? null : Number(row.opened_at),
        closedAt: row.closed_at == null ? null : Number(row.closed_at),
        holdSec: row.closed_at != null && row.opened_at != null ? Number(row.closed_at) - Number(row.opened_at) : null,
        profit: Number(row.profit ?? 0),
        priceReturnPct: row.price_return_pct == null ? null : Number(row.price_return_pct),
      };
      if (row.bucket === "top") top.push(item);
      else bottom.push(item);
    }

    if (req.session?.userId) {
      try {
        const auditCtx = buildAuditContext(req);
        const griftDb = getGriftDb();
        await appendAuditEntry(griftDb, Number(req.session.userId), "TRADER_SCOUT_DRILLDOWN", "user", userId, {
          correlationId: auditCtx.correlationId,
          endpoint: "trade-extremes",
          days,
          cutoffSec,
          limit,
        });
      } catch (auditErr) {
        console.error("Trader scouting drilldown audit write failed:", auditErr);
      }
    }

    return res.json({ ok: true, userId, days, cutoffSec, limit, top, bottom });
  } catch (error) {
    console.error("Trader scouting trade extremes error:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    observeHttpRequestDuration(
      "/api/admin/trader-scouting/:userId/trade-extremes",
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  }
});
