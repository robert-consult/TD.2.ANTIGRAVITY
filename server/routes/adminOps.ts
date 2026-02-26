import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, dbClient } from "@db";
import {
  marketDataProviders,
  symbolConfigs,
  systemConfig,
  trades,
  users,
} from "@shared/schema";
import { AdminTraderStatsQuerySchema } from "@shared/admin/dataTab";
import { MarketDataProviderConfigSchema } from "@shared/marketDataProviders";
import { requireAdmin } from "../middleware/requireAdmin";
import { storage } from "../storage";
import { getCacheStats } from "../feeds/quoteFeed";
import { resolveSecretRef } from "../marketdata/secret";
import { getActiveProviderSelection } from "../marketdata/providerManager";
import { observeHttpRequestDuration } from "./metricsState";

function normalizeProviderKey(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) return null;
  return value;
}

export const adminOpsRouter = Router();

adminOpsRouter.get("/trader-stats", requireAdmin, async (req, res) => {
  const startedAt = process.hrtime.bigint();
  try {
    const { days, limit, offset } = AdminTraderStatsQuerySchema.parse(req.query);

    const params: any[] = [];
    let havingClause = "";
    if (days > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);
      params.push(cutoffTimestamp);
      havingClause = `HAVING MAX(t.closed_at) > $${params.length}`;
    }

    const query = `
      SELECT
        u.id AS user_id,
        u.username,
        u.email,
        COUNT(t.id) AS total_trades,
        ROUND(
          SUM(
            CASE
              WHEN COALESCE(
                t.net_profit_usd::numeric,
                CASE
                  WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                  WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                  ELSE 0::numeric
                END
              ) > 0 THEN 1
              ELSE 0
            END
          ) * 100.0 / NULLIF(COUNT(t.id), 0),
          2
        ) AS win_rate,
        ROUND(
          SUM(
            COALESCE(
              t.net_profit_usd::numeric,
              CASE
                WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                ELSE 0::numeric
              END
            )
          ),
          2
        ) AS profit,
        ROUND(
          SUM(
            COALESCE(
              t.net_profit_usd::numeric,
              CASE
                WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                ELSE 0::numeric
              END
            )
          ) * 100.0 / NULLIF(COALESCE(u.starting_equity, 1000000)::numeric, 0),
          2
        ) AS profit_percent,
        ROUND(AVG((t.closed_at - t.opened_at) / 3600.0)::numeric, 2) AS avg_hold_time,
        MAX(t.closed_at) AS last_trade_date
      FROM users u
      LEFT JOIN trades t ON u.id = t.user_id AND t.status = 'CLOSED'
      GROUP BY u.id, u.username, u.email, u.starting_equity
      ${havingClause}
      ORDER BY profit DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const stats = (await dbClient.query(query, params)).rows;
    res.setHeader("X-Result-Limit", String(limit));
    res.setHeader("X-Result-Offset", String(offset));
    if (stats.length >= limit) res.setHeader("X-Result-Truncated", "1");
    return res.json(stats);
  } catch (error) {
    console.error("Error fetching trader statistics:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    observeHttpRequestDuration(
      "/api/admin/trader-stats",
      Number(process.hrtime.bigint() - startedAt) / 1e9,
    );
  }
});

adminOpsRouter.get("/all-trades", requireAdmin, async (_req, res) => {
  try {
    const allTrades = await db
      .select({
        id: trades.id,
        userId: trades.userId,
        username: users.username,
        symbol: symbolConfigs.symbol,
        type: trades.type,
        lots: trades.lots,
        openPrice: trades.openPrice,
        closePrice: trades.closePrice,
        profit: trades.profit,
        grossProfitUsd: trades.grossProfitUsd,
        netProfitUsd: trades.netProfitUsd,
        notionalUsd: trades.notionalUsd,
        totalCostsUsd: trades.totalCostsUsd,
        openCommissionUsd: trades.openCommissionUsd,
        closeCommissionUsd: trades.closeCommissionUsd,
        openOtherFeesUsd: trades.openOtherFeesUsd,
        closeOtherFeesUsd: trades.closeOtherFeesUsd,
        financingAccruedUsd: trades.financingAccruedUsd,
        swapAccruedUsd: trades.swapAccruedUsd,
        overnightDays: trades.overnightDays,
        categorySnapshot: trades.categorySnapshot,
        costModelVersion: trades.costModelVersion,
        status: trades.status,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        closeReason: trades.closeReason,
        closeQuoteTs: trades.closeQuoteTs,
        closeSource: trades.closeSource,
        closeBid: trades.closeBid,
        closeAsk: trades.closeAsk,
        closeMid: trades.closeMid,
        closeSpread: trades.closeSpread,
      })
      .from(trades)
      .leftJoin(users, eq(trades.userId, users.id))
      .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
      .orderBy(desc(trades.openedAt))
      .limit(5000);

    return res.json(allTrades);
  } catch (error) {
    console.error("Error fetching trades for export:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminOpsRouter.get("/daily-pnl", requireAdmin, async (_req, res) => {
  try {
    const dailyData = (
      await dbClient.query(`
        SELECT
          date,
          SUM(profit_day) as total_profit,
          SUM(trades_closed) as total_trades,
          SUM(trades_won) as winning_trades,
          COUNT(DISTINCT user_id) as active_users
        FROM daily_closes
        GROUP BY date
        ORDER BY date DESC
        LIMIT 90
      `)
    ).rows;

    return res.json(dailyData);
  } catch (error) {
    console.error("Error fetching daily P&L data:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminOpsRouter.get("/system-health", requireAdmin, async (req, res) => {
  try {
    const cacheStats = getCacheStats();
    const cfg = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
    const activeProviderKey = cfg?.marketDataActiveProviderKey ? String(cfg.marketDataActiveProviderKey) : null;
    const requestedProviderKey = normalizeProviderKey(req.query.providerKey) ?? activeProviderKey;

    const selection = await getActiveProviderSelection();
    const feedProviderKey = selection?.providerKey ?? null;
    const feedProviderDriver = selection?.provider?.driver ?? null;
    const feedProviderDisplayName = selection?.provider?.displayName ?? null;

    let requestedProvider: any = null;
    if (requestedProviderKey) {
      const row = await db.query.marketDataProviders.findFirst({
        where: and(eq(marketDataProviders.providerKey, requestedProviderKey), isNull(marketDataProviders.deletedAt)),
      });

      if (row && row.isEnabled) {
        const rawCfg = (() => {
          try {
            return JSON.parse(String((row as any).configJson ?? "{}"));
          } catch {
            return {};
          }
        })();
        const parsed = MarketDataProviderConfigSchema.parse({ ...(rawCfg || {}), driver: rawCfg?.driver ?? row.driver });

        const missingSecrets: string[] = [];
        let configUsable = true;

        const noteMissing = (ref: string | undefined | null) => {
          const raw = String(ref ?? "").trim();
          if (!raw.toLowerCase().startsWith("env:")) return;
          const key = raw.slice(4).trim();
          if (!key) return;
          if (!process.env[key]) missingSecrets.push(key);
        };

        if (parsed.driver === "twelvedata") {
          configUsable = Boolean(resolveSecretRef(parsed.apiKey));
          if (!configUsable) noteMissing(parsed.apiKey);
        } else if (parsed.driver === "oneforge") {
          configUsable = Boolean(resolveSecretRef(parsed.apiKey));
          if (!configUsable) noteMissing(parsed.apiKey);
        } else if (parsed.driver === "generic_rest_v1") {
          if (parsed.apiKey) {
            configUsable = Boolean(resolveSecretRef(parsed.apiKey));
            if (!configUsable) noteMissing(parsed.apiKey);
          }
        }

        requestedProvider = {
          providerKey: row.providerKey,
          displayName: row.displayName,
          driver: row.driver,
          configUsable,
          missingSecrets,
          isActiveConfigured: Boolean(activeProviderKey && row.providerKey === activeProviderKey),
        };
      } else {
        requestedProvider = {
          providerKey: requestedProviderKey,
          displayName: row?.displayName ?? null,
          driver: row?.driver ?? null,
          configUsable: false,
          missingSecrets: [],
          isActiveConfigured: Boolean(activeProviderKey && requestedProviderKey === activeProviderKey),
          error: row ? "PROVIDER_DISABLED" : "PROVIDER_NOT_FOUND",
        };
      }
    }

    const feedProviderConnected = Boolean(
      feedProviderKey &&
        cacheStats.lastProviderSuccessKey === feedProviderKey &&
        cacheStats.consecutiveApiFailures === 0 &&
        cacheStats.lastProviderSuccessAtMs > 0,
    );

    return res.json({
      apiConnected: feedProviderConnected,
      lastSuccess: cacheStats.lastSuccessfulApiCall ? new Date(cacheStats.lastSuccessfulApiCall).toISOString() : null,
      failures: cacheStats.consecutiveApiFailures,
      staleCount: cacheStats.staleCount,
      cacheSize: cacheStats.cacheSize,
      serverTime: new Date().toISOString(),

      feedSource: cacheStats.lastPublishedSource,
      feedSourceAt: cacheStats.lastPublishedAtMs ? new Date(cacheStats.lastPublishedAtMs).toISOString() : null,
      feedProviderKey,
      feedProviderDriver,
      feedProviderDisplayName,
      feedProviderConnected,
      lastProviderSuccessAt: cacheStats.lastProviderSuccessAtMs ? new Date(cacheStats.lastProviderSuccessAtMs).toISOString() : null,
      lastProviderSuccessKey: cacheStats.lastProviderSuccessKey ?? null,

      activeProviderKey,
      requestedProviderKey,
      requestedProvider,
    });
  } catch (error) {
    console.error("Error fetching system health:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminOpsRouter.get("/audit-log", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string, 10) || 100), 500);
    const actions = await storage.getAdminActions(limit);
    return res.json(actions);
  } catch (error) {
    console.error("Get audit log error:", error);
    return res.status(500).json({ message: "Failed to fetch audit log" });
  }
});
