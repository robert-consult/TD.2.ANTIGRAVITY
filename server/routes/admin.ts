import { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../middleware/auth";
import { insertUserSettingsSchema, insertSymbolConfigSchema, tradeAudit, orderIntentAudit, globalSettings, systemConfig, marketDataProviders, userAdminNotes, userKycProfiles, userVerification, userPayoutProfiles, signupWaitlist } from "@shared/schema";
import { db, dbClient } from "../../db";
import { eq, sql, desc, and, gte, inArray, like, or, isNull } from "drizzle-orm";
import { trades, users, symbolConfigs, userSettings } from "@shared/schema";
import { appendIdentityAudit, getRecentIdentityAudit } from "../services/identityAudit";
import { scheduleAutoClose } from "../cron/autoClose";
import { getCacheStats, reloadFeedConfig } from "../feeds/quoteFeed";
import { MarketDataProviderConfigSchema } from "@shared/marketDataProviders";
import { resolveSecretRef } from "../marketdata/secret";
import { getActiveProviderSelection } from "../marketdata/providerManager";
import { stringify } from "csv-stringify/sync";
import { z } from "zod";
import { sha256, stableStringify } from "../legal/cryptoUtils";
import { invalidateJurisdictionRestrictionPolicyCache, parseRestrictedCountriesCsv } from "../legal/regionRules";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { computeContenderEligibility } from "@shared/policyDecision";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { promotePerformerIfEligible } from "../policy/performerPromotion";
import { buildAuditContext } from "../lib/auditContext";
import { defaultPaymentCurrencyForCountry } from "../utils/paymentCurrency";
import type { AccountActionProvenance } from "../lib/accountEventMirror";
import { appendAuditEntry } from "../grift/griftAdminAudit";
import { getGriftDb } from "../grift/griftDb";
import { recalcAccount } from "../recalcAccount";
import { onLiveEvent, publishLiveEvent } from "../services/liveBus";
import { TRADER_SEARCH_CATEGORIES } from "@shared/admin/traderSearch";
import { canonicalizeInstrumentCategory, normalizeInstrumentCategory } from "@shared/instruments/categories";
import { createNotification, sendKycMailboxMessage } from "../services/messaging";

let traderScoutCategoryLiveBusSubscribed = false;

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeProviderKey(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v)) return null;
  return v;
}

function convertQuestionMarks(sql: string): string {
  let out = "";
  let index = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = i + 1 < sql.length ? sql[i + 1] : "";

    if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        out += ch + next;
        i++;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        out += ch + next;
        i++;
        inBlockComment = true;
        continue;
      }
    }

    if (ch === "'" && !inDouble) {
      out += ch;
      if (inSingle && next === "'") {
        out += next;
        i++;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (ch === "\"" && !inSingle) {
      out += ch;
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && ch === "?") {
      out += `$${index++}`;
      continue;
    }

    out += ch;
  }

  return out;
}

async function queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const text = convertQuestionMarks(sql);
  const result = await dbClient.query(text, params);
  return result.rows as T[];
}

async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, params);
  return rows[0];
}

async function exec(sql: string, params: any[] = []): Promise<void> {
  const text = convertQuestionMarks(sql);
  await dbClient.query(text, params);
}

async function ensureDefaultPayoutCurrency(user: any, userId: number, nowSec: number) {
  const preferred = defaultPaymentCurrencyForCountry({
    countryIso2: user?.countryIso2 ?? user?.country ?? null,
    regionKey: user?.regionKey ?? null,
  });

  const existing = await db.query.userPayoutProfiles.findFirst({
    where: eq(userPayoutProfiles.userId, userId),
  });

  if (existing) {
    if (!existing.preferredPaymentCurrency) {
      await db.update(userPayoutProfiles)
        .set({ preferredPaymentCurrency: preferred, updatedAt: nowSec })
        .where(eq(userPayoutProfiles.userId, userId));
    }
    return existing.preferredPaymentCurrency || preferred;
  }

  await db.insert(userPayoutProfiles).values({
    userId,
    preferredPaymentCurrency: preferred,
    createdAt: nowSec,
    updatedAt: nowSec,
  });
  return preferred;
}

async function notifyKycStatusChange(params: {
  userId: number;
  status: string;
  note?: string | null;
  actorAdminId: number;
}) {
  const status = String(params.status || "").toUpperCase();
  const title =
    status === "APPROVED"
      ? "KYC approved"
      : status === "REJECTED"
        ? "KYC rejected"
        : status === "INVITED"
          ? "KYC invited"
          : `KYC status: ${status}`;
  const message = params.note
    ? `${title}. ${params.note}`
    : `${title}. Check your account for next steps.`;

  void createNotification({
    userId: params.userId,
    type: "KYC",
    severity: status === "REJECTED" ? "WARNING" : status === "APPROVED" ? "SUCCESS" : "INFO",
    title,
    message,
    sourceEvent: `KYC_${status}:${params.userId}:${params.actorAdminId}:${Math.floor(Date.now() / 1000)}`,
    link: "/account",
    playSound: true,
  }).catch((err) => {
    console.error("[notifications] failed to create KYC notification:", err);
  });

  void sendKycMailboxMessage({
    userId: params.userId,
    actorAdminId: params.actorAdminId,
    subject: `KYC Update: ${status}`,
    body: message,
  }).catch((err) => {
    console.error("[mailbox] failed to create KYC mailbox update:", err);
  });
}

export function registerAdminRoutes(app: Express) {
  const buildProvenance = (req: Request, actorUserId?: number): AccountActionProvenance => {
    const ctx = buildAuditContext(req);
    const resolvedActorUserId =
      typeof actorUserId === "number" && Number.isFinite(actorUserId)
        ? actorUserId
        : typeof ctx.actorUserId === "number" && Number.isFinite(ctx.actorUserId)
          ? ctx.actorUserId
          : undefined;
    return {
      actorType: ctx.actorType,
      actorUserId: resolvedActorUserId,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };
  };

  const applyGriftEnforcementSyncWithDb = async (griftDb: ReturnType<typeof getGriftDb>, params: {
    userId: number;
    adminId: number;
    action: "FREEZE" | "UNFREEZE" | "DISABLE" | "ENABLE";
    reason?: string | null;
  }) => {
    const existing = await griftDb.prepare(`
        SELECT frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(params.userId) as any;

    const wasFrozen = Boolean(existing?.frozen_at);
    const wasDisabled = Boolean(existing?.disabled_at);
    const oldStatus = wasDisabled ? "DISABLED" : wasFrozen ? "FROZEN" : "ACTIVE";

    const now = Date.now();
    let frozenAt = existing?.frozen_at ?? null;
    let frozenBy = existing?.frozen_by_admin_id ?? null;
    let disabledAt = existing?.disabled_at ?? null;
    let disabledBy = existing?.disabled_by_admin_id ?? null;
    let notes = existing?.notes ?? null;

    let statusChanged = false;
    if (params.action === "FREEZE") {
      if (!wasFrozen) {
        frozenAt = now;
        frozenBy = params.adminId;
        statusChanged = true;
      }
    } else if (params.action === "UNFREEZE") {
      if (wasFrozen) {
        frozenAt = null;
        frozenBy = null;
        statusChanged = true;
      }
    } else if (params.action === "DISABLE") {
      if (!wasDisabled) {
        disabledAt = now;
        disabledBy = params.adminId;
        statusChanged = true;
      }
    } else if (params.action === "ENABLE") {
      if (wasDisabled) {
        disabledAt = null;
        disabledBy = null;
        statusChanged = true;
      }
    }

    const normalizedReason = typeof params.reason === "string" ? params.reason.trim() : "";
    const notesChanged = normalizedReason.length > 0 && normalizedReason !== String(notes ?? "");
    if (notesChanged) notes = normalizedReason;

    const newStatus = disabledAt ? "DISABLED" : frozenAt ? "FROZEN" : "ACTIVE";
    const actionTaken = statusChanged || notesChanged;

    if (!actionTaken) {
      return { actionTaken: false, oldStatus, newStatus };
    }

    await griftDb.prepare(`
        INSERT INTO grift_user_enforcements (
          user_id, frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          frozen_at = excluded.frozen_at,
          frozen_by_admin_id = excluded.frozen_by_admin_id,
          disabled_at = excluded.disabled_at,
          disabled_by_admin_id = excluded.disabled_by_admin_id,
          notes = excluded.notes
      `).run(params.userId, frozenAt, frozenBy, disabledAt, disabledBy, notes);

    const riskScore = (await griftDb.prepare(`
        SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
      `).get(params.userId) as any)?.scoreCurrent ?? null;

    await griftDb.prepare(`
        INSERT INTO grift_enforcement_log (
          user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(params.userId, params.action, oldStatus, newStatus, params.adminId, normalizedReason || null, riskScore, now);

    await appendAuditEntry(griftDb, params.adminId, `ENFORCEMENT_${params.action}`, "user", params.userId, {
      source: "admin_users_endpoint",
      oldStatus,
      newStatus,
      riskScore,
      reason: normalizedReason || null,
    });

    return { actionTaken: true, oldStatus, newStatus };
  };

  const applyGriftEnforcementSync = async (params: {
    userId: number;
    adminId: number;
    action: "FREEZE" | "UNFREEZE" | "DISABLE" | "ENABLE";
    reason?: string | null;
  }) => {
    const griftDb = getGriftDb();
    return await applyGriftEnforcementSyncWithDb(griftDb, params);
  };

  const toIso = (value: any): string | null => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const num = Number(value);
    if (Number.isFinite(num)) {
      const ms = num < 1e12 ? num * 1000 : num;
      return new Date(ms).toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };
  const toUnixSec = (value: any): number | null => {
    if (value == null || value === "") return null;
    if (value instanceof Date) return Math.floor(value.getTime() / 1000);
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return num < 1e12 ? Math.floor(num) : Math.floor(num / 1000);
  };
  // SYMBOL MANAGEMENT ROUTES

  // Get all trading symbols
  app.get("/api/admin/symbols", requireAdmin, async (req: Request, res: Response) => {
    try {
      const symbols = await storage.getAllSymbolConfigs();
      res.json(symbols);
    } catch (error) {
      console.error("Error fetching symbol configs:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Create new trading symbol
  app.post("/api/admin/symbols", requireAdmin, async (req: Request, res: Response) => {
    try {
      const symbolData = insertSymbolConfigSchema.parse(req.body);

      // Check if symbol already exists
      const existingSymbol = await storage.getSymbolConfigBySymbol(symbolData.symbol);
      if (existingSymbol) {
        return res.status(400).json({ message: "Symbol already exists" });
      }

      const newSymbol = await storage.createSymbolConfig(symbolData);
      publishLiveEvent({
        type: "symbols:updated",
        payload: { action: "created", id: newSymbol.id, symbol: newSymbol.symbol },
      });
      res.status(201).json(newSymbol);
    } catch (error) {
      console.error("Error creating symbol config:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Update existing trading symbol
  app.put("/api/admin/symbols/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const symbolId = parseInt(getParam(req.params.id), 10);

      // Ensure symbol exists
      const existingSymbol = await storage.getSymbolConfigById(symbolId);
      if (!existingSymbol) {
        return res.status(404).json({ message: "Symbol not found" });
      }

      // Make sure symbol is unique if it's being changed
      if (req.body.symbol && req.body.symbol !== existingSymbol.symbol) {
        const symbolCheck = await storage.getSymbolConfigBySymbol(req.body.symbol);
        if (symbolCheck && symbolCheck.id !== symbolId) {
          return res.status(400).json({ message: "Symbol already exists" });
        }
      }

      const updatedSymbol = await storage.updateSymbolConfig(symbolId, req.body);
      publishLiveEvent({
        type: "symbols:updated",
        payload: { action: "updated", id: symbolId, symbol: updatedSymbol.symbol },
      });
      res.json(updatedSymbol);
    } catch (error) {
      console.error("Error updating symbol config:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  // Delete trading symbol
  app.delete("/api/admin/symbols/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const symbolId = parseInt(getParam(req.params.id), 10);

      // Check if symbol exists
      const existingSymbol = await storage.getSymbolConfigById(symbolId);
      if (!existingSymbol) {
        return res.status(404).json({ message: "Symbol not found" });
      }

      // Check if there are open trades for this symbol
      const openTrades = await storage.getTradesBySymbolId(symbolId, true);
      if (openTrades.length > 0) {
        return res.status(400).json({
          message: "Cannot delete symbol with open trades",
          openTradesCount: openTrades.length
        });
      }

      await storage.deleteSymbolConfig(symbolId);
      publishLiveEvent({
        type: "symbols:updated",
        payload: { action: "deleted", id: symbolId, symbol: existingSymbol.symbol },
      });
      res.json({ success: true, message: "Symbol deleted successfully" });
    } catch (error) {
      console.error("Error deleting symbol:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // USER MANAGEMENT ROUTES
  // fetch paginated users + settings
  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await storage.listUsersWithSettings();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users with settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // upsert settings
  app.post("/api/admin/users/:id/settings", requireAdmin, async (req, res) => {
    try {
      const data = insertUserSettingsSchema.parse({ ...req.body, userId: +req.params.id });
      await storage.upsertSettings(data);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  });

  // Update user balance
  app.post("/api/admin/users/:id/balance", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const { balance } = req.body;

      if (!balance || isNaN(parseFloat(balance))) {
        return res.status(400).json({ message: "Valid balance is required" });
      }

      await storage.updateUserBalance(userId, balance);
      await recalcAccount(userId, { emit: true, reason: "ADMIN_BALANCE_SET" });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ message: (err as Error).message });
    }
  });

  // Make user an admin (development helper route - would be removed in production)
  app.post("/api/promote-to-admin", async (req, res) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
      }

      const user = await storage.getUserById(Number(userId));

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update user to have admin role
      await storage.makeUserAdmin(Number(userId));

      // Update session if this is the current user
      if (req.session.userId === Number(userId)) {
        req.session.isAdmin = true;
      }

      res.json({ success: true, message: "User is now an admin" });
    } catch (error) {
      console.error("Error promoting user to admin:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // DATA ANALYTICS ROUTES

  // KPI Summary endpoint - aggregate metrics for hero cards
  app.get("/api/admin/kpi-summary", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = days === 0 ? 0 : nowSec - (days * 24 * 60 * 60);

      // Get all users
      const allUsers = await storage.listUsersWithSettings();
      const totalUsers = allUsers.filter((u: any) => !u.isAdmin).length;

      // Get trades for the period
      const allTrades = await db.select().from(trades);
      const periodTrades = cutoff === 0
        ? allTrades
        : allTrades.filter((t: any) => (t.openedAt || 0) >= cutoff);

      const closedTrades = periodTrades.filter((t: any) => t.status === 'CLOSED');
      const tradeNetProfit = (trade: any): number => {
        const net = Number(trade?.netProfitUsd);
        if (Number.isFinite(net)) return net;
        const legacy = Number.parseFloat(String(trade?.profit ?? "0"));
        return Number.isFinite(legacy) ? legacy : 0;
      };

      // Calculate metrics
      const activeTraders = new Set(periodTrades.map((t: any) => t.userId)).size;
      const totalTradesCount = closedTrades.length;

      // Total volume (sum of lots * 100000 for standard lot size)
      const totalVolume = closedTrades.reduce((sum: number, t: any) => {
        return sum + (parseFloat(t.lots || '0') * 100000);
      }, 0);

      // Total P/L
      const totalPnL = closedTrades.reduce((sum: number, t: any) => {
        return sum + tradeNetProfit(t);
      }, 0);

      // Average win rate
      const winningTrades = closedTrades.filter((t: any) => tradeNetProfit(t) > 0).length;
      const avgWinRate = totalTradesCount > 0 ? (winningTrades / totalTradesCount) * 100 : 0;

      res.json({
        totalUsers,
        activeTraders,
        totalTrades: totalTradesCount,
        totalVolume: Math.round(totalVolume),
        totalPnL: Math.round(totalPnL * 100) / 100,
        avgWinRate: Math.round(avgWinRate * 10) / 10
      });
    } catch (error) {
      console.error("Get KPI summary error:", error);
      res.status(500).json({ message: "Failed to fetch KPI summary" });
    }
  });

  // Get trader statistics
  app.get("/api/admin/trader-stats", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;

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
      `;

      const stats = (await dbClient.query(query, params)).rows;
      res.json(stats);
    } catch (error) {
      console.error("Error fetching trader statistics:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get all trades for export (includes audit fields for admin trail)
  app.get("/api/admin/all-trades", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get recent trades (limit to last 5000 to avoid huge payloads)
      const allTrades = await db.select({
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
        // Audit fields for admin trail
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

      res.json(allTrades);
    } catch (error) {
      console.error("Error fetching trades for export:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get daily P&L data
  app.get("/api/admin/daily-pnl", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get daily P&L data from daily_closes table
      const dailyData = await queryAll(`
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
      `);

      res.json(dailyData);
    } catch (error) {
      console.error("Error fetching daily P&L data:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const parseDaysParam = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(365, Math.trunc(parsed)));
  };

  const TRADER_SCOUT_CATEGORY_CACHE_TTL_MS = 60_000;
  let traderScoutCategoriesCache: { loadedAtMs: number; categories: string[]; set: Set<string> } | null = null;

  if (!traderScoutCategoryLiveBusSubscribed) {
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

  const loadTraderScoutAllowedCategories = async () => {
    const now = Date.now();
    if (traderScoutCategoriesCache && now - traderScoutCategoriesCache.loadedAtMs < TRADER_SCOUT_CATEGORY_CACHE_TTL_MS) {
      return traderScoutCategoriesCache;
    }

    const set = new Set<string>();
    for (const c of TRADER_SEARCH_CATEGORIES as unknown as string[]) set.add(String(c));

    try {
      const res = await dbClient.query(`
        SELECT DISTINCT LOWER(COALESCE(NULLIF(category, ''), 'unknown')) AS category
        FROM symbol_configs
      `);
      for (const row of res.rows ?? []) {
        const v = String((row as any)?.category ?? "").trim();
        if (!v) continue;
        set.add(normalizeInstrumentCategory(v, "unknown"));
      }
    } catch {
      // ignore: fall back to static list
    }

    const categories = Array.from(set.values()).sort();
    traderScoutCategoriesCache = { loadedAtMs: now, categories, set };
    return traderScoutCategoriesCache;
  };

  const readQuery = (value: unknown): string | undefined => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
    return undefined;
  };

  const clampInt = (raw: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(readQuery(raw));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
  };

  const clampFloat = (raw: unknown): number | null => {
    const parsed = Number(readQuery(raw));
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  };

  const normalizePct01 = (raw: unknown): number | null => {
    const parsed = clampFloat(raw);
    if (parsed === null) return null;
    const value = parsed > 1 ? parsed / 100 : parsed;
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(1, value));
  };

  const LEGACY_TRADE_PROFIT_NUMERIC_SQL = `
    CASE
      WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
      WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
      ELSE 0::numeric
    END
  `;

  const TRADE_NET_PROFIT_SQL = `
    COALESCE(
      t.net_profit_usd::numeric,
      ${LEGACY_TRADE_PROFIT_NUMERIC_SQL}
    )
  `;

  const TRADER_SCOUT_CATEGORY_SQL = `
    CASE
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('fx', 'forex', 'forex_pair', 'forex_pairs', 'physical_currency') THEN 'forex'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('stock', 'stocks', 'common_stock', 'preferred_stock', 'american_depositary_receipt', 'depositary_receipt', 'global_depositary_receipt', 'reit', 'right', 'warrant', 'limited_partnership', 'structured_product') THEN 'stocks'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('etf', 'etfs', 'exchange_traded_note', 'exchange_traded_fund') THEN 'etf'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('crypto', 'cryptocurrency', 'cryptocurrencies', 'digital_currency', 'crypto_pair', 'crypto_pairs') THEN 'crypto'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('commodity', 'commodities', 'agricultural_product', 'energy', 'energies', 'energy_resource', 'livestock', 'metal', 'metals', 'precious_metal', 'precious_metals', 'industrial_metal', 'industrial_metals', 'gold', 'silver', 'platinum', 'palladium', 'oil', 'gas', 'natural_gas', 'crude_oil') THEN 'commodities'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('bond', 'bonds') THEN 'bonds'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('fund', 'funds', 'bond_fund', 'closed_end_fund', 'trust', 'unit') THEN 'funds'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('mutual_fund', 'mutual_funds') THEN 'mutual_funds'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('index', 'indices') THEN 'indices'
      WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) = 'unknown' THEN 'unknown'
      ELSE LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown'))
    END
  `;

  const TRADER_SCOUT_SEARCH_SQL = `
WITH ft AS (
  SELECT
    t.user_id,
    t.opened_at,
    t.closed_at,
    ${TRADE_NET_PROFIT_SQL} AS profit,
    t.stop_loss,
    t.take_profit,
    ${TRADER_SCOUT_CATEGORY_SQL} AS category
  FROM trades t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND t.closed_at >= $1::int
    AND u.is_admin = FALSE
    AND ($2::text[] IS NULL OR ${TRADER_SCOUT_CATEGORY_SQL} = ANY($2::text[]))
    AND ($3::text IS NULL OR u.username ILIKE $3::text OR u.email ILIKE $3::text)
),
agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS trades,
    SUM(profit) AS net_profit,
    SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) AS gross_profit,
    SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END) AS gross_loss,
    (SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS win_rate,
    AVG((closed_at - opened_at)::float) AS avg_hold_sec,
    MAX((closed_at - opened_at)::float) AS max_hold_sec,
    MIN((closed_at - opened_at)::float) AS min_hold_sec,
    (SUM(CASE WHEN stop_loss IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS sl_usage,
    (SUM(CASE WHEN take_profit IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS tp_usage
  FROM ft
  GROUP BY user_id
  HAVING COUNT(*) >= $6::int
),
candidates AS (
  SELECT
    a.*,
    CASE
      WHEN ABS(a.gross_loss) < 0.0001 THEN CASE WHEN a.gross_profit > 0 THEN 999.0 ELSE NULL END
      ELSE (a.gross_profit / ABS(a.gross_loss))
    END AS profit_factor
  FROM agg a
  WHERE ($7::float IS NULL OR a.win_rate >= $7::float)
    AND ($8::numeric IS NULL OR a.net_profit >= $8::numeric)
    AND ($4::int IS NULL OR a.avg_hold_sec >= $4::int)
    AND ($5::int IS NULL OR a.avg_hold_sec <= $5::int)
    AND ($12::float IS NULL OR a.sl_usage >= $12::float)
    AND ($13::float IS NULL OR a.tp_usage >= $13::float)
),
candidates2 AS (
  SELECT *
  FROM candidates c
  WHERE ($11::float IS NULL OR (c.profit_factor IS NOT NULL AND c.profit_factor >= $11::float))
),
day_pnl AS (
  SELECT
    ft.user_id,
    date_trunc('day', to_timestamp(ft.closed_at)) AS day,
    SUM(ft.profit) AS pnl
  FROM ft
  JOIN candidates2 c ON c.user_id = ft.user_id
  GROUP BY ft.user_id, day
),
day_equity AS (
  SELECT
    dp.user_id,
    dp.day,
    SUM(dp.pnl) OVER (PARTITION BY dp.user_id ORDER BY dp.day) AS cum_pnl
  FROM day_pnl dp
),
day_equity2 AS (
  SELECT
    de.user_id,
    de.day,
    de.cum_pnl,
    MAX(de.cum_pnl) OVER (
      PARTITION BY de.user_id
      ORDER BY de.day
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS peak_cum_pnl
  FROM day_equity de
),
dd AS (
  SELECT
    de.user_id,
    MAX(
      CASE
        WHEN (u.starting_equity::numeric + de.peak_cum_pnl) <= 0 THEN NULL
        ELSE (de.peak_cum_pnl - de.cum_pnl) / NULLIF((u.starting_equity::numeric + de.peak_cum_pnl), 0)
      END
    ) AS max_drawdown
  FROM day_equity2 de
  JOIN users u ON u.id = de.user_id
  GROUP BY de.user_id
),
best_day AS (
  SELECT
    user_id,
    MAX(pnl) AS best_day_pnl,
    SUM(pnl) AS total_pnl
  FROM day_pnl
  GROUP BY user_id
),
best_day_pct AS (
  SELECT
    user_id,
    CASE WHEN total_pnl > 0 THEN (best_day_pnl / total_pnl) ELSE NULL END AS best_day_pct
  FROM best_day
),
mix AS (
  SELECT
    ft.user_id,
    ft.category,
    COUNT(*)::int AS trades
  FROM ft
  JOIN candidates2 c ON c.user_id = ft.user_id
  GROUP BY ft.user_id, ft.category
),
mix_totals AS (
  SELECT user_id, SUM(trades)::int AS total_trades
  FROM mix
  GROUP BY user_id
),
mix_json AS (
  SELECT
    m.user_id,
    jsonb_object_agg(m.category, (m.trades::float / NULLIF(mt.total_trades, 0))) AS asset_mix
  FROM mix m
  JOIN mix_totals mt ON mt.user_id = m.user_id
  GROUP BY m.user_id
)
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  c.trades,
  c.win_rate,
  c.net_profit,
  c.gross_profit,
  c.gross_loss,
  c.profit_factor,
  c.avg_hold_sec,
  c.max_hold_sec,
  c.min_hold_sec,
  d.max_drawdown,
  b.best_day_pct,
  c.sl_usage,
  c.tp_usage,
  mj.asset_mix
FROM candidates2 c
JOIN users u ON u.id = c.user_id
LEFT JOIN dd d ON d.user_id = c.user_id
LEFT JOIN best_day_pct b ON b.user_id = c.user_id
LEFT JOIN mix_json mj ON mj.user_id = c.user_id
WHERE ($9::float IS NULL OR (d.max_drawdown IS NOT NULL AND d.max_drawdown <= $9::float))
  AND ($10::float IS NULL OR (b.best_day_pct IS NOT NULL AND b.best_day_pct <= $10::float))
ORDER BY c.net_profit DESC, c.trades DESC, u.id ASC
LIMIT $14::int OFFSET $15::int;
  `;

  const runTraderScoutSearch = async (args: {
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
  }> => {
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
  };

  const normalizeTraderScoutCategory = (raw: string): string | null => {
    return canonicalizeInstrumentCategory(raw);
  };

  // Trader Search / Scouting (Admin > Data mini-tab)
  app.get("/api/admin/trader-scouting/categories", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const allowed = await loadTraderScoutAllowedCategories();
      res.json({ ok: true, categories: allowed.categories });
    } catch (error) {
      console.error("Trader scouting categories list error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/trader-scouting/search", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseDaysParam(readQuery(req.query.days), 30);
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

      const qRaw = (readQuery(req.query.q) || "").trim();
      const q = qRaw.length ? `%${qRaw.slice(0, 200)}%` : null;

      const categoriesRaw =
        (readQuery(req.query.categories) || readQuery(req.query.assetClasses) || "").trim();
      const categoriesList = categoriesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const allowed = await loadTraderScoutAllowedCategories();
      const allowedCategories = allowed.set;
      const categories: string[] = [];
      for (const rawCategory of categoriesList) {
        const normalizedCategory = normalizeTraderScoutCategory(rawCategory);
        if (!normalizedCategory) {
          return res.status(400).json({
            message: `Invalid category: ${rawCategory}`,
            allowed: allowed.categories,
          });
        }
        categories.push(normalizedCategory);
      }
      const normalizedCategories = Array.from(new Set(categories));
      for (const c of normalizedCategories) {
        if (!allowedCategories.has(c)) {
          return res.status(400).json({
            message: `Invalid category: ${c}`,
            allowed: allowed.categories,
          });
        }
      }

      const minTrades = clampInt(req.query.minTrades, 0, 0, 200_000);
      const minWinRate = normalizePct01(readQuery(req.query.minWinRate) ?? readQuery(req.query.minWinRatePct));
      const maxDrawdown = normalizePct01(readQuery(req.query.maxDrawdown) ?? readQuery(req.query.maxDrawdownPct));
      const maxBestDayPct = normalizePct01(readQuery(req.query.maxBestDayPct));

      const minNetProfitRaw = clampFloat(readQuery(req.query.minNetProfit) ?? readQuery(req.query.minProfit));
      const minNetProfit = minNetProfitRaw === null ? null : minNetProfitRaw;

      const minHoldSec = clampFloat(readQuery(req.query.minHoldSec));
      const maxHoldSec = clampFloat(readQuery(req.query.maxHoldSec));

      const minProfitFactorRaw = clampFloat(readQuery(req.query.minProfitFactor));
      const minProfitFactor = minProfitFactorRaw === null ? null : Math.max(0, minProfitFactorRaw);
      const minSlUsage = normalizePct01(readQuery(req.query.minSlUsage) ?? readQuery(req.query.minSlUsagePct));
      const minTpUsage = normalizePct01(readQuery(req.query.minTpUsage) ?? readQuery(req.query.minTpUsagePct));

      const limit = clampInt(req.query.limit, 25, 1, 200);
      const offset = clampInt(req.query.offset, 0, 0, 200_000);

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

      // Audit: only record materially-filtered searches (avoid noisy keystroke churn)
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
            minHoldSec: minHoldSec === null ? null : Math.max(0, Math.trunc(minHoldSec)),
            maxHoldSec: maxHoldSec === null ? null : Math.max(0, Math.trunc(maxHoldSec)),
            minProfitFactor,
            minSlUsage,
            minTpUsage,
          });
        } catch (auditErr) {
          console.error("Trader scouting audit write failed:", auditErr);
        }
      }

      res.json({
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
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/trader-scouting/export", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseDaysParam(readQuery(req.query.days), 30);
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

      const formatRaw = String(readQuery(req.query.format) ?? "csv").trim().toLowerCase();
      const format = formatRaw === "excel" ? "csv" : formatRaw === "ndjson" ? "jsonl" : formatRaw;
      if (format !== "csv" && format !== "jsonl") {
        return res.status(400).json({ message: "Invalid format (expected csv or jsonl)" });
      }

      const exportLimit = clampInt(req.query.exportLimit, 5000, 1, 50_000);

      const qRaw = (readQuery(req.query.q) || "").trim();
      const q = qRaw.length ? `%${qRaw.slice(0, 200)}%` : null;

      const categoriesRaw = (readQuery(req.query.categories) || readQuery(req.query.assetClasses) || "").trim();
      const categoriesList = categoriesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const allowed = await loadTraderScoutAllowedCategories();
      const allowedCategories = allowed.set;
      const categories: string[] = [];
      for (const rawCategory of categoriesList) {
        const normalizedCategory = normalizeTraderScoutCategory(rawCategory);
        if (!normalizedCategory) {
          return res.status(400).json({
            message: `Invalid category: ${rawCategory}`,
            allowed: allowed.categories,
          });
        }
        categories.push(normalizedCategory);
      }
      const normalizedCategories = Array.from(new Set(categories));
      for (const c of normalizedCategories) {
        if (!allowedCategories.has(c)) {
          return res.status(400).json({
            message: `Invalid category: ${c}`,
            allowed: allowed.categories,
          });
        }
      }

      const minTrades = clampInt(req.query.minTrades, 0, 0, 200_000);
      const minWinRate = normalizePct01(readQuery(req.query.minWinRate) ?? readQuery(req.query.minWinRatePct));
      const maxDrawdown = normalizePct01(readQuery(req.query.maxDrawdown) ?? readQuery(req.query.maxDrawdownPct));
      const maxBestDayPct = normalizePct01(readQuery(req.query.maxBestDayPct));

      const minNetProfitRaw = clampFloat(readQuery(req.query.minNetProfit) ?? readQuery(req.query.minProfit));
      const minNetProfit = minNetProfitRaw === null ? null : minNetProfitRaw;

      const minHoldSec = clampFloat(readQuery(req.query.minHoldSec));
      const maxHoldSec = clampFloat(readQuery(req.query.maxHoldSec));

      const minProfitFactorRaw = clampFloat(readQuery(req.query.minProfitFactor));
      const minProfitFactor = minProfitFactorRaw === null ? null : Math.max(0, minProfitFactorRaw);
      const minSlUsage = normalizePct01(readQuery(req.query.minSlUsage) ?? readQuery(req.query.minSlUsagePct));
      const minTpUsage = normalizePct01(readQuery(req.query.minTpUsage) ?? readQuery(req.query.minTpUsagePct));

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
        limit: exportLimit,
        offset: 0,
      });

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Export-Limit", String(exportLimit));
      if (hasMore) res.setHeader("X-Export-Truncated", "1");

      const dateTag = new Date().toISOString().slice(0, 10);
      const baseName = `trader-scout-${days}d-${dateTag}`;

      if (req.session?.userId) {
        try {
          const auditCtx = buildAuditContext(req);
          const griftDb = getGriftDb();
          await appendAuditEntry(griftDb, Number(req.session.userId), "TRADER_SCOUT_EXPORT", "analytics", 1, {
            correlationId: auditCtx.correlationId,
            days,
            cutoffSec,
            format,
            exportLimit,
            truncated: hasMore,
            qHash: qRaw ? sha256(qRaw) : null,
            qLen: qRaw.length || 0,
            categories: normalizedCategories,
            minTrades,
            minWinRate,
            maxDrawdown,
            minNetProfit,
            maxBestDayPct,
            minHoldSec: minHoldSec === null ? null : Math.max(0, Math.trunc(minHoldSec)),
            maxHoldSec: maxHoldSec === null ? null : Math.max(0, Math.trunc(maxHoldSec)),
            minProfitFactor,
            minSlUsage,
            minTpUsage,
          });
        } catch (auditErr) {
          console.error("Trader scouting export audit write failed:", auditErr);
        }
      }

      if (format === "jsonl") {
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}.jsonl"`);
        for (const row of results) {
          res.write(JSON.stringify(row));
          res.write("\n");
        }
        res.end();
        return;
      }

      const csvEscape = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        const s = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);
        if (/[",\n\r]/.test(s)) return `"${s.replaceAll("\"", "\"\"")}"`;
        return s;
      };

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.csv"`);

      const header = [
        "userId",
        "username",
        "email",
        "trades",
        "winRate",
        "netProfit",
        "grossProfit",
        "grossLoss",
        "profitFactor",
        "avgHoldSec",
        "maxHoldSec",
        "minHoldSec",
        "maxDrawdown",
        "bestDayPct",
        "slUsage",
        "tpUsage",
        "assetMix",
      ].join(",");

      // UTF-8 BOM helps Excel detect encoding correctly.
      res.write("\uFEFF");
      res.write(header);
      res.write("\n");

      for (const row of results) {
        const line = [
          csvEscape(row.userId),
          csvEscape(row.username),
          csvEscape(row.email),
          csvEscape(row.trades),
          csvEscape(row.winRate),
          csvEscape(row.netProfit),
          csvEscape(row.grossProfit),
          csvEscape(row.grossLoss),
          csvEscape(row.profitFactor),
          csvEscape(row.avgHoldSec),
          csvEscape(row.maxHoldSec),
          csvEscape(row.minHoldSec),
          csvEscape(row.maxDrawdown),
          csvEscape(row.bestDayPct),
          csvEscape(row.slUsage),
          csvEscape(row.tpUsage),
          csvEscape(row.assetMix),
        ].join(",");
        res.write(line);
        res.write("\n");
      }

      res.end();
    } catch (error) {
      console.error("Trader scouting export error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/trader-scouting/:userId/asset-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const readQuery = (value: unknown): string | undefined => {
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
        return undefined;
      };

      const userId = Number(getParam(req.params.userId));
      if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ message: "Invalid userId" });

      const days = parseDaysParam(readQuery(req.query.days), 30);
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
      const out = rows.map((r) => ({
        category: r.category,
        trades: Number(r.trades ?? 0),
        netProfit: Number(r.net_profit ?? 0),
        winRate: Number(r.win_rate ?? 0),
        avgHoldSec: r.avg_hold_sec == null ? null : Number(r.avg_hold_sec),
        maxHoldSec: r.max_hold_sec == null ? null : Number(r.max_hold_sec),
        minHoldSec: r.min_hold_sec == null ? null : Number(r.min_hold_sec),
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

      res.json({ ok: true, userId, days, cutoffSec, rows: out });
    } catch (error) {
      console.error("Trader scouting categories drilldown error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/trader-scouting/:userId/trade-extremes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const readQuery = (value: unknown): string | undefined => {
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
        return undefined;
      };

      const userId = Number(getParam(req.params.userId));
      if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ message: "Invalid userId" });

      const days = parseDaysParam(readQuery(req.query.days), 30);
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

      const limit = Math.max(1, Math.min(100, Math.trunc(Number(readQuery(req.query.limit)) || 10)));

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
        const v = String(value || "").toUpperCase();
        if (v === "BUY") return "buy";
        if (v === "SELL") return "sell";
        return null;
      };

      for (const r of rows) {
        const item = {
          id: Number(r.id),
          symbol: r.symbol ?? null,
          side: toSide(r.type),
          openedAt: r.opened_at == null ? null : Number(r.opened_at),
          closedAt: r.closed_at == null ? null : Number(r.closed_at),
          holdSec:
            r.closed_at != null && r.opened_at != null ? Number(r.closed_at) - Number(r.opened_at) : null,
          profit: Number(r.profit ?? 0),
          priceReturnPct: r.price_return_pct == null ? null : Number(r.price_return_pct),
        };
        if (r.bucket === "top") top.push(item);
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

      res.json({ ok: true, userId, days, cutoffSec, limit, top, bottom });
    } catch (error) {
      console.error("Trader scouting trade extremes error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const buildDeactivatedAccountsCte = (cutoff: number | null, params: any[]) => {
    let cutoffClause = "";
    if (cutoff !== null) {
      params.push(cutoff);
      cutoffClause = `AND e.created_at >= $${params.length}`;
    }

    return `
      WITH latest_events AS (
        SELECT
          e.user_id AS "userId",
          e.event_type AS "eventType",
          e.reason_code AS "reasonCode",
          e.reason_text AS "reasonText",
          e.created_at AS "actionAt",
          ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC) AS rn
        FROM user_account_events e
        WHERE e.event_type IN ('ACCOUNT_SELF_DEACTIVATED', 'ACCOUNT_SELF_DELETED')
        ${cutoffClause}
      ),
      latest AS (
        SELECT * FROM latest_events WHERE rn = 1
      ),
      trade_stats AS (
        SELECT
          t.user_id AS "userId",
          COUNT(*) FILTER (WHERE t.status = 'CLOSED') AS "closedTrades",
          SUM(
            CASE
              WHEN t.status = 'CLOSED' THEN ${TRADE_NET_PROFIT_SQL}
              ELSE 0
            END
          ) AS "profit",
          SUM(
            CASE
              WHEN t.status = 'CLOSED' AND ${TRADE_NET_PROFIT_SQL} > 0 THEN 1
              ELSE 0
            END
          ) AS "winningTrades"
        FROM trades t
        GROUP BY t.user_id
      )
    `;
  };

  app.get("/api/admin/deactivated-accounts/summary", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseDaysParam(req.query.days, 30);
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = days > 0 ? nowSec - (days * 24 * 60 * 60) : null;

      const summaryParams: any[] = [];
      const summaryCte = buildDeactivatedAccountsCte(cutoff, summaryParams);
      const summarySql = `
        ${summaryCte}
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN l."eventType" = 'ACCOUNT_SELF_DEACTIVATED' THEN 1 ELSE 0 END) AS deactivated,
          SUM(CASE WHEN l."eventType" = 'ACCOUNT_SELF_DELETED' THEN 1 ELSE 0 END) AS deleted,
          COALESCE(AVG(COALESCE(ts."profit", 0)), 0) AS avg_profit,
          COALESCE(AVG(COALESCE(ts."closedTrades", 0)), 0) AS avg_trades,
          COALESCE(
            AVG(
              CASE
                WHEN COALESCE(ts."closedTrades", 0) > 0
                  THEN (COALESCE(ts."winningTrades", 0)::float / ts."closedTrades") * 100
                ELSE 0
              END
            ),
            0
          ) AS avg_win_rate
        FROM latest l
        LEFT JOIN trade_stats ts ON ts."userId" = l."userId";
      `;
      const summaryRow = (await dbClient.query(summarySql, summaryParams)).rows[0] ?? {};

      const reasonsParams: any[] = [];
      const reasonsCte = buildDeactivatedAccountsCte(cutoff, reasonsParams);
      const reasonsSql = `
        ${reasonsCte}
        SELECT
          l."reasonCode" AS "reasonCode",
          l."reasonText" AS "reasonText",
          COUNT(*) AS count
        FROM latest l
        GROUP BY l."reasonCode", l."reasonText"
        ORDER BY COUNT(*) DESC;
      `;
      const reasonsRows = (await dbClient.query(reasonsSql, reasonsParams)).rows ?? [];

      const topParams: any[] = [];
      const topCte = buildDeactivatedAccountsCte(cutoff, topParams);
      const topSql = `
        ${topCte}
        SELECT
          l."userId" AS "userId",
          u.username AS username,
          u.email AS email,
          l."eventType" AS "eventType",
          l."reasonCode" AS "reasonCode",
          l."reasonText" AS "reasonText",
          l."actionAt" AS "actionAt",
          COALESCE(ts."profit", 0) AS "profit",
          COALESCE(ts."closedTrades", 0) AS "trades",
          CASE
            WHEN COALESCE(ts."closedTrades", 0) > 0
              THEN ROUND((COALESCE(ts."winningTrades", 0)::float / ts."closedTrades") * 100, 2)
            ELSE 0
          END AS "winRate"
        FROM latest l
        JOIN users u ON u.id = l."userId"
        LEFT JOIN trade_stats ts ON ts."userId" = l."userId"
        ORDER BY "profit" DESC NULLS LAST, l."actionAt" DESC
        LIMIT 5;
      `;
      const topRows = (await dbClient.query(topSql, topParams)).rows ?? [];

      res.json({
        totals: {
          total: Number(summaryRow.total || 0),
          deactivated: Number(summaryRow.deactivated || 0),
          deleted: Number(summaryRow.deleted || 0),
        },
        averages: {
          profitUsd: Number(summaryRow.avg_profit || 0),
          trades: Number(summaryRow.avg_trades || 0),
          winRatePct: Number(summaryRow.avg_win_rate || 0),
        },
        reasons: reasonsRows.map((row: any) => ({
          reasonCode: row.reasonCode ? String(row.reasonCode) : null,
          reasonText: row.reasonText ? String(row.reasonText) : null,
          count: Number(row.count || 0),
        })),
        top: topRows.map((row: any) => ({
          userId: Number(row.userId),
          username: row.username ? String(row.username) : null,
          email: row.email ? String(row.email) : null,
          mode: row.eventType === "ACCOUNT_SELF_DELETED" ? "DELETED" : "DEACTIVATED",
          reasonCode: row.reasonCode ? String(row.reasonCode) : null,
          reasonText: row.reasonText ? String(row.reasonText) : null,
          profitUsd: Number(row.profit || 0),
          trades: Number(row.trades || 0),
          winRatePct: Number(row.winRate || 0),
          actionAt: row.actionAt ? Number(row.actionAt) : null,
        })),
      });
    } catch (error) {
      console.error("Deactivated accounts summary error:", error);
      res.status(500).json({ message: "Failed to load deactivated account summary" });
    }
  });

  app.get("/api/admin/deactivated-accounts/export", requireAdmin, async (req: Request, res: Response) => {
    try {
      const formatRaw = String(req.query.format || "csv").toLowerCase();
      const format = formatRaw === "jsonl" ? "jsonl" : "csv";
      const includeTrades = req.query.includeTrades ? String(req.query.includeTrades) !== "0" : true;
      const days = parseDaysParam(req.query.days, 0);
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = days > 0 ? nowSec - (days * 24 * 60 * 60) : null;

      const userParams: any[] = [];
      const userCte = buildDeactivatedAccountsCte(cutoff, userParams);
      const userSql = `
        ${userCte}
        SELECT
          l."userId" AS "userId",
          u.username AS username,
          u.email AS email,
          l."eventType" AS "eventType",
          l."reasonCode" AS "reasonCode",
          l."reasonText" AS "reasonText",
          l."actionAt" AS "actionAt",
          COALESCE(ts."profit", 0) AS "profit",
          COALESCE(ts."closedTrades", 0) AS "trades",
          CASE
            WHEN COALESCE(ts."closedTrades", 0) > 0
              THEN ROUND((COALESCE(ts."winningTrades", 0)::float / ts."closedTrades") * 100, 2)
            ELSE 0
          END AS "winRate"
        FROM latest l
        JOIN users u ON u.id = l."userId"
        LEFT JOIN trade_stats ts ON ts."userId" = l."userId"
        ORDER BY l."actionAt" DESC;
      `;
      const userRows = (await dbClient.query(userSql, userParams)).rows as any[];

      const exportUsers = userRows.map((row: any) => ({
        userId: Number(row.userId),
        username: row.username ? String(row.username) : null,
        email: row.email ? String(row.email) : null,
        actionType: row.eventType === "ACCOUNT_SELF_DELETED" ? "DELETED" : "DEACTIVATED",
        reasonCode: row.reasonCode ? String(row.reasonCode) : null,
        reasonText: row.reasonText ? String(row.reasonText) : null,
        actionAt: row.actionAt ? Number(row.actionAt) : null,
        profitUsd: Number(row.profit || 0),
        trades: Number(row.trades || 0),
        winRatePct: Number(row.winRate || 0),
      }));

      const userIds = exportUsers.map((row) => row.userId).filter((id) => Number.isFinite(id));
      const userLookup = new Map(exportUsers.map((row) => [row.userId, row]));
      const tradesByUser = new Map<number, any[]>();

      if (includeTrades && userIds.length > 0) {
        const tradesSql = `
          SELECT
            t.id AS "tradeId",
            t.user_id AS "userId",
            s.symbol AS symbol,
            t.type AS type,
            t.status AS status,
            t.lots AS lots,
            t.open_price AS "openPrice",
            t.close_price AS "closePrice",
            COALESCE(
              t.net_profit_usd,
              CASE
                WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN NULL
                WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::real
                ELSE NULL
              END
            ) AS profit,
            t.gross_profit_usd AS "grossProfitUsd",
            t.net_profit_usd AS "netProfitUsd",
            t.total_costs_usd AS "totalCostsUsd",
            t.open_commission_usd AS "openCommissionUsd",
            t.close_commission_usd AS "closeCommissionUsd",
            t.open_other_fees_usd AS "openOtherFeesUsd",
            t.close_other_fees_usd AS "closeOtherFeesUsd",
            t.financing_accrued_usd AS "financingAccruedUsd",
            t.swap_accrued_usd AS "swapAccruedUsd",
            t.overnight_days AS "overnightDays",
            t.category_snapshot AS "categorySnapshot",
            t.cost_model_version AS "costModelVersion",
            t.opened_at AS "openedAt",
            t.closed_at AS "closedAt"
          FROM trades t
          LEFT JOIN symbol_configs s ON s.id = t.symbol_id
          WHERE t.user_id = ANY($1::int[])
          ORDER BY t.user_id, t.opened_at DESC;
        `;

        const tradeRows = (await dbClient.query(tradesSql, [userIds])).rows as any[];
        for (const row of tradeRows) {
          const userId = Number(row.userId);
          if (!tradesByUser.has(userId)) tradesByUser.set(userId, []);
          tradesByUser.get(userId)!.push(row);
        }
      }

      const filename = `deactivated_accounts_${Date.now()}.${format === "jsonl" ? "jsonl" : "csv"}`;
      if (format === "jsonl") {
        res.setHeader("Content-Type", "application/x-ndjson");
      } else {
        res.setHeader("Content-Type", "text/csv");
      }
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

      if (format === "jsonl") {
        const exportedAt = new Date().toISOString();
        res.write(JSON.stringify({
          type: "meta",
          exportedAt,
          totalUsers: exportUsers.length,
          totalTrades: Array.from(tradesByUser.values()).reduce((sum, rows) => sum + rows.length, 0),
          includeTrades,
        }) + "\n");

        for (const user of exportUsers) {
          res.write(JSON.stringify({
            type: "user",
            ...user,
            actionAtIso: user.actionAt ? new Date(user.actionAt * 1000).toISOString() : null,
            exportedAt,
          }) + "\n");
        }

        if (includeTrades) {
          for (const [userId, trades] of tradesByUser.entries()) {
            const user = userLookup.get(userId);
            for (const trade of trades) {
              res.write(JSON.stringify({
                type: "trade",
                userId,
                username: user?.username ?? null,
                email: user?.email ?? null,
                actionType: user?.actionType ?? null,
                reasonCode: user?.reasonCode ?? null,
                reasonText: user?.reasonText ?? null,
                actionAt: user?.actionAt ?? null,
                tradeId: Number(trade.tradeId),
                symbol: trade.symbol ? String(trade.symbol) : null,
                tradeType: trade.type ? String(trade.type) : null,
                status: trade.status ? String(trade.status) : null,
                lots: trade.lots != null ? Number(trade.lots) : null,
                openPrice: trade.openPrice != null ? Number(trade.openPrice) : null,
                closePrice: trade.closePrice != null ? Number(trade.closePrice) : null,
                profit: trade.profit != null ? Number(trade.profit) : null,
                grossProfitUsd: trade.grossProfitUsd != null ? Number(trade.grossProfitUsd) : null,
                netProfitUsd: trade.netProfitUsd != null ? Number(trade.netProfitUsd) : null,
                totalCostsUsd: trade.totalCostsUsd != null ? Number(trade.totalCostsUsd) : null,
                openCommissionUsd: trade.openCommissionUsd != null ? Number(trade.openCommissionUsd) : null,
                closeCommissionUsd: trade.closeCommissionUsd != null ? Number(trade.closeCommissionUsd) : null,
                openOtherFeesUsd: trade.openOtherFeesUsd != null ? Number(trade.openOtherFeesUsd) : null,
                closeOtherFeesUsd: trade.closeOtherFeesUsd != null ? Number(trade.closeOtherFeesUsd) : null,
                financingAccruedUsd: trade.financingAccruedUsd != null ? Number(trade.financingAccruedUsd) : null,
                swapAccruedUsd: trade.swapAccruedUsd != null ? Number(trade.swapAccruedUsd) : null,
                overnightDays: trade.overnightDays != null ? Number(trade.overnightDays) : null,
                categorySnapshot: trade.categorySnapshot ? String(trade.categorySnapshot) : null,
                costModelVersion: trade.costModelVersion ? String(trade.costModelVersion) : null,
                openedAt: trade.openedAt != null ? Number(trade.openedAt) : null,
                closedAt: trade.closedAt != null ? Number(trade.closedAt) : null,
                exportedAt,
              }) + "\n");
            }
          }
        }
        res.end();
        return;
      }

      const csvEscape = (value: any) => {
        if (value === null || value === undefined) return "";
        const text = String(value);
        if (/["\n,]/.test(text)) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      };

      const columns = [
        "user_id",
        "username",
        "email",
        "action_type",
        "action_at",
        "reason_code",
        "reason_text",
        "total_profit_usd",
        "total_trades",
        "win_rate_pct",
        "trade_id",
        "symbol",
        "trade_type",
        "trade_status",
        "lots",
        "open_price",
        "close_price",
        "net_profit_usd",
        "total_costs_usd",
        "open_commission_usd",
        "close_commission_usd",
        "financing_accrued_usd",
        "swap_accrued_usd",
        "overnight_days",
        "opened_at",
        "closed_at",
      ];

      res.write(columns.join(",") + "\n");

      for (const user of exportUsers) {
        const userTrades = includeTrades ? (tradesByUser.get(user.userId) ?? []) : [];
        const actionAtIso = user.actionAt ? new Date(user.actionAt * 1000).toISOString() : "";

        if (userTrades.length === 0) {
          const row = [
            user.userId,
            user.username || "",
            user.email || "",
            user.actionType,
            actionAtIso,
            user.reasonCode || "",
            user.reasonText || "",
            user.profitUsd,
            user.trades,
            user.winRatePct,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ];
          res.write(row.map(csvEscape).join(",") + "\n");
          continue;
        }

        for (const trade of userTrades) {
          const row = [
            user.userId,
            user.username || "",
            user.email || "",
            user.actionType,
            actionAtIso,
            user.reasonCode || "",
            user.reasonText || "",
            user.profitUsd,
            user.trades,
            user.winRatePct,
            Number(trade.tradeId),
            trade.symbol || "",
            trade.type || "",
            trade.status || "",
            trade.lots ?? "",
            trade.openPrice ?? "",
            trade.closePrice ?? "",
            trade.netProfitUsd ?? trade.profit ?? "",
            trade.totalCostsUsd ?? "",
            trade.openCommissionUsd ?? "",
            trade.closeCommissionUsd ?? "",
            trade.financingAccruedUsd ?? "",
            trade.swapAccruedUsd ?? "",
            trade.overnightDays ?? "",
            trade.openedAt ?? "",
            trade.closedAt ?? "",
          ];
          res.write(row.map(csvEscape).join(",") + "\n");
        }
      }

      res.end();
    } catch (error) {
      console.error("Deactivated accounts export error:", error);
      res.status(500).json({ message: "Failed to export deactivated accounts" });
    }
  });

  // Get trade audit records for admin analysis - INSTITUTIONAL GRADE
  app.get("/api/admin/trade-audit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { tradeId, eventType, riskResult, correlationId, limit = "1000" } = req.query;

      // Build query with ALL institutional fields
      let query = db
        .select({
          id: tradeAudit.id,
          tradeId: tradeAudit.tradeId,
          eventType: tradeAudit.eventType,
          eventCategory: tradeAudit.eventCategory,
          eventAt: tradeAudit.eventAt,
          eventAtMs: tradeAudit.eventAtMs,
          correlationId: tradeAudit.correlationId,
          orderId: tradeAudit.orderId,
          executionId: tradeAudit.executionId,
          positionId: tradeAudit.positionId,
          actorType: tradeAudit.actorType,
          actorUserId: tradeAudit.actorUserId,
          sessionId: tradeAudit.sessionId,
          ip: tradeAudit.ip,
          userAgent: tradeAudit.userAgent,
          symbol: tradeAudit.symbol,
          side: tradeAudit.side,
          orderType: tradeAudit.orderType,
          timeInForce: tradeAudit.timeInForce,
          qtyLots: tradeAudit.qtyLots,
          notionalUsd: tradeAudit.notionalUsd,
          grossProfitUsd: tradeAudit.grossProfitUsd,
          netProfitUsd: tradeAudit.netProfitUsd,
          totalCostsUsd: tradeAudit.totalCostsUsd,
          openCommissionUsd: tradeAudit.openCommissionUsd,
          closeCommissionUsd: tradeAudit.closeCommissionUsd,
          openOtherFeesUsd: tradeAudit.openOtherFeesUsd,
          closeOtherFeesUsd: tradeAudit.closeOtherFeesUsd,
          financingAccruedUsd: tradeAudit.financingAccruedUsd,
          swapAccruedUsd: tradeAudit.swapAccruedUsd,
          overnightDays: tradeAudit.overnightDays,
          categorySnapshot: tradeAudit.categorySnapshot,
          costModelVersion: tradeAudit.costModelVersion,
          requestedPrice: tradeAudit.requestedPrice,
          triggerPrice: tradeAudit.triggerPrice,
          limitPrice: tradeAudit.limitPrice,
          stopPrice: tradeAudit.stopPrice,
          fillPrice: tradeAudit.fillPrice,
          avgFillPrice: tradeAudit.avgFillPrice,
          slippage: tradeAudit.slippage,
          slippagePips: tradeAudit.slippagePips,
          slippageReference: tradeAudit.slippageReference,
          latencyMs: tradeAudit.latencyMs,
          quoteTs: tradeAudit.quoteTs,
          quoteSource: tradeAudit.quoteSource,
          quoteBid: tradeAudit.quoteBid,
          quoteAsk: tradeAudit.quoteAsk,
          quoteMid: tradeAudit.quoteMid,
          quoteSpread: tradeAudit.quoteSpread,
          spreadPips: tradeAudit.spreadPips,
          riskCheckName: tradeAudit.riskCheckName,
          riskLimitValue: tradeAudit.riskLimitValue,
          riskObservedValue: tradeAudit.riskObservedValue,
          riskResult: tradeAudit.riskResult,
          reasonCode: tradeAudit.reasonCode,
          payloadJson: tradeAudit.payloadJson,
          prevHash: tradeAudit.prevHash,
          eventHash: tradeAudit.eventHash,
          note: tradeAudit.note,
          // Join for additional context (fallback if symbol not in audit record)
          symbolFromTrade: symbolConfigs.symbol,
          userId: trades.userId,
          username: users.username,
          tradeSide: trades.type,
          tradeLots: trades.lots,
          tradeOrderType: trades.orderType,
          tradeNotionalUsd: trades.notionalUsd,
          tradeGrossProfitUsd: trades.grossProfitUsd,
          tradeNetProfitUsd: trades.netProfitUsd,
          tradeTotalCostsUsd: trades.totalCostsUsd,
          tradeOpenCommissionUsd: trades.openCommissionUsd,
          tradeCloseCommissionUsd: trades.closeCommissionUsd,
          tradeOpenOtherFeesUsd: trades.openOtherFeesUsd,
          tradeCloseOtherFeesUsd: trades.closeOtherFeesUsd,
          tradeFinancingAccruedUsd: trades.financingAccruedUsd,
          tradeSwapAccruedUsd: trades.swapAccruedUsd,
          tradeOvernightDays: trades.overnightDays,
          tradeCategorySnapshot: trades.categorySnapshot,
          tradeCostModelVersion: trades.costModelVersion,
        })
        .from(tradeAudit)
        .leftJoin(trades, eq(tradeAudit.tradeId, trades.id))
        .leftJoin(users, eq(trades.userId, users.id))
        .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
        .orderBy(desc(tradeAudit.eventAt))
        .limit(parseInt(String(limit), 10));

      const auditRecords = await query;

      // Apply filters if provided
      let filtered = auditRecords;
      if (tradeId) {
        const tid = parseInt(String(tradeId), 10);
        filtered = filtered.filter(r => r.tradeId === tid);
      }
      if (eventType && eventType !== "all") {
        filtered = filtered.filter(r => r.eventType === String(eventType));
      }
      if (riskResult && riskResult !== "all") {
        filtered = filtered.filter(r => r.riskResult === String(riskResult));
      }
      if (correlationId) {
        filtered = filtered.filter(r => r.correlationId === String(correlationId));
      }

      // Merge symbol from audit record or trade join
      const enriched = filtered.map(r => ({
        ...r,
        symbol: r.symbol || r.symbolFromTrade,
        side: r.side || r.tradeSide,
        qtyLots: r.qtyLots ?? r.tradeLots,
        orderType: r.orderType || r.tradeOrderType,
        notionalUsd: r.notionalUsd ?? r.tradeNotionalUsd,
        grossProfitUsd: r.grossProfitUsd ?? r.tradeGrossProfitUsd,
        netProfitUsd: r.netProfitUsd ?? r.tradeNetProfitUsd,
        totalCostsUsd: r.totalCostsUsd ?? r.tradeTotalCostsUsd,
        openCommissionUsd: r.openCommissionUsd ?? r.tradeOpenCommissionUsd,
        closeCommissionUsd: r.closeCommissionUsd ?? r.tradeCloseCommissionUsd,
        openOtherFeesUsd: r.openOtherFeesUsd ?? r.tradeOpenOtherFeesUsd,
        closeOtherFeesUsd: r.closeOtherFeesUsd ?? r.tradeCloseOtherFeesUsd,
        financingAccruedUsd: r.financingAccruedUsd ?? r.tradeFinancingAccruedUsd,
        swapAccruedUsd: r.swapAccruedUsd ?? r.tradeSwapAccruedUsd,
        overnightDays: r.overnightDays ?? r.tradeOvernightDays,
        categorySnapshot: r.categorySnapshot ?? r.tradeCategorySnapshot,
        costModelVersion: r.costModelVersion ?? r.tradeCostModelVersion,
      }));

      const enrichedFixed = enriched.map(r => ({
        ...r,
        eventAt: toIso(r.eventAt),
        quoteTs: toIso(r.quoteTs),
      }));

      res.json(enrichedFixed);
    } catch (error) {
      console.error("Error fetching trade audit:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get order intent audit records (RECEIVED/DECISION events)
  app.get("/api/admin/order-intent-audit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { correlationId, decision, userId, limit = "500" } = req.query;

      let query = db
        .select()
        .from(orderIntentAudit)
        .orderBy(desc(orderIntentAudit.eventAt))
        .limit(parseInt(String(limit), 10));

      let records = await query;

      // Apply filters
      if (correlationId) {
        records = records.filter(r => r.correlationId === String(correlationId));
      }
      if (decision && decision !== "all") {
        records = records.filter(r => r.decision === String(decision));
      }
      if (userId) {
        const uid = parseInt(String(userId), 10);
        records = records.filter(r => r.userId === uid);
      }

      res.json(records);
    } catch (error) {
      console.error("Error fetching order intent audit:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GLOBAL SETTINGS ROUTES

  // Get global settings
  app.get("/api/admin/global-settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const settings = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1)
      });

      // If no settings exist, insert a default row and return it
      if (!settings) {
        await db.insert(globalSettings).values({
          id: 1,
          defaultLeverage: 50,
          maxPositionSize: 100000,
          maxTradesPerUser: 10,
          maxTradesPerInstrument: 3,
          maxConcurrentLots: 50,
          marketOpenTime: "09:00",
          marketCloseTime: "17:00",
          allowWeekendTrading: false,
          enableAutoClose: true,
          autoCloseAfterDays: 4,
          autoCloseCheckFrequencyMinutes: 60,
          minHoldSec: 60,
          enableLossLimits: true,
          dailyLossLimitPct: 10,
          lifetimeLossLimitPct: 20,
        });

        const newSettings = await db.query.globalSettings.findFirst({
          where: eq(globalSettings.id, 1)
        });
        return res.json(newSettings);
      }

      res.json(settings);
    } catch (error) {
      console.error("Error fetching global settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update global settings with safe parsing
  app.put("/api/admin/global-settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const ABSOLUTE_MAX_LOTS = 50;

      // Safe parsing functions
      const parseNum = (v: any): number | undefined => {
        if (v === null || v === undefined || v === "") return undefined;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      const parseBool = (v: any): boolean | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
          const s = v.trim().toLowerCase();
          if (s === "true") return true;
          if (s === "false") return false;
        }
        return undefined;
      };

      const parseTime = (v: any): string | undefined => {
        if (v === null || v === undefined || v === "") return undefined;
        const s = String(v).trim();
        const m = /^(\d{2}):(\d{2})$/.exec(s);
        if (!m) return undefined;
        const hh = Number(m[1]);
        const mm = Number(m[2]);
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
        return `${m[1]}:${m[2]}`;
      };

      const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.trunc(n)));
      };

      const parsePresetCards = (raw: string): number[] => {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("lotPresetCards must be a JSON array");
        return parsed
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((n) => Number.isFinite(n))
          .map((n) => Math.trunc(n));
      };

      const sanitizePresetCards = (values: number[], max: number): number[] => {
        const filtered = values.filter((n) => n >= 1 && n <= max);
        const unique = Array.from(new Set(filtered));
        unique.sort((a, b) => a - b);
        if (unique.length > 0) return unique;
        const fallback = [1, 5, 10, 25, 50].filter((n) => n <= max);
        return fallback.length > 0 ? fallback : [1];
      };

      const next = {
        defaultLeverage: parseNum(body.defaultLeverage),
        maxPositionSize: parseNum(body.maxPositionSize),
        maxTradesPerUser: parseNum(body.maxTradesPerUser),
        maxTradesPerInstrument: parseNum(body.maxTradesPerInstrument),
        maxConcurrentLots: parseNum(body.maxConcurrentLots),
        minPriceDistancePips: parseNum(body.minPriceDistancePips),
        marketOpenTime: parseTime(body.marketOpenTime),
        marketCloseTime: parseTime(body.marketCloseTime),
        allowWeekendTrading: parseBool(body.allowWeekendTrading),
        enableAutoClose: parseBool(body.enableAutoClose),
        autoCloseAfterDays: parseNum(body.autoCloseAfterDays),
        autoCloseCheckFrequencyMinutes: parseNum(body.autoCloseCheckFrequencyMinutes),
        minHoldSec: parseNum(body.minHoldSec),
        enableLossLimits: parseBool(body.enableLossLimits),
        dailyLossLimitPct: parseNum(body.dailyLossLimitPct),
        lifetimeLossLimitPct: parseNum(body.lifetimeLossLimitPct),
        // Visual Lot Settings
        lotPresetCards: typeof body.lotPresetCards === "string" ? body.lotPresetCards : undefined,
        lotDropdownMax: parseNum(body.lotDropdownMax),
      };

      const nowSec = Math.floor(Date.now() / 1000);

      // Upsert the global settings (insert or update)
      const existing = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1)
      });

      if (existing) {
        const effectiveLotDropdownMax = clampInt(
          next.lotDropdownMax ?? existing.lotDropdownMax,
          1,
          ABSOLUTE_MAX_LOTS,
          ABSOLUTE_MAX_LOTS
        );
        const effectiveMinPriceDistancePips = clampInt(
          next.minPriceDistancePips ?? existing.minPriceDistancePips ?? 20,
          1,
          10_000,
          20
        );

        let presetValues: number[] = [];
        const rawPresets = next.lotPresetCards ?? existing.lotPresetCards;
        if (typeof rawPresets === "string") {
          try {
            presetValues = parsePresetCards(rawPresets);
          } catch (e) {
            if (next.lotPresetCards !== undefined) {
              return res.status(400).json({ message: "Invalid lotPresetCards JSON array" });
            }
            presetValues = [];
          }
        }
        const effectiveLotPresetCards = JSON.stringify(
          sanitizePresetCards(presetValues, effectiveLotDropdownMax)
        );

        await db.update(globalSettings)
          .set({
            defaultLeverage: next.defaultLeverage ?? existing.defaultLeverage,
            maxPositionSize: next.maxPositionSize ?? existing.maxPositionSize,
            maxTradesPerUser: next.maxTradesPerUser ?? existing.maxTradesPerUser,
            maxTradesPerInstrument: next.maxTradesPerInstrument ?? existing.maxTradesPerInstrument,
            maxConcurrentLots: next.maxConcurrentLots ?? existing.maxConcurrentLots,
            minPriceDistancePips: effectiveMinPriceDistancePips,
            marketOpenTime: next.marketOpenTime ?? existing.marketOpenTime,
            marketCloseTime: next.marketCloseTime ?? existing.marketCloseTime,
            allowWeekendTrading: next.allowWeekendTrading ?? existing.allowWeekendTrading,
            enableAutoClose: next.enableAutoClose ?? existing.enableAutoClose,
            autoCloseAfterDays: next.autoCloseAfterDays ?? existing.autoCloseAfterDays,
            autoCloseCheckFrequencyMinutes: next.autoCloseCheckFrequencyMinutes ?? existing.autoCloseCheckFrequencyMinutes,
            minHoldSec: next.minHoldSec ?? existing.minHoldSec,
            enableLossLimits: next.enableLossLimits ?? existing.enableLossLimits,
            dailyLossLimitPct: next.dailyLossLimitPct ?? existing.dailyLossLimitPct,
            lifetimeLossLimitPct: next.lifetimeLossLimitPct ?? existing.lifetimeLossLimitPct,
            lotPresetCards: effectiveLotPresetCards,
            lotDropdownMax: effectiveLotDropdownMax,
            updatedAt: nowSec
          })
          .where(eq(globalSettings.id, 1));
      } else {
        const effectiveLotDropdownMax = clampInt(next.lotDropdownMax ?? ABSOLUTE_MAX_LOTS, 1, ABSOLUTE_MAX_LOTS, ABSOLUTE_MAX_LOTS);
        const effectiveMinPriceDistancePips = clampInt(next.minPriceDistancePips ?? 20, 1, 10_000, 20);

        let presetValues: number[] = [];
        if (typeof next.lotPresetCards === "string") {
          try {
            presetValues = parsePresetCards(next.lotPresetCards);
          } catch {
            return res.status(400).json({ message: "Invalid lotPresetCards JSON array" });
          }
        }

        const effectiveLotPresetCards = JSON.stringify(
          sanitizePresetCards(presetValues, effectiveLotDropdownMax)
        );

        await db.insert(globalSettings).values({
          id: 1,
          defaultLeverage: next.defaultLeverage ?? 50,
          maxPositionSize: next.maxPositionSize ?? 100000,
          maxTradesPerUser: next.maxTradesPerUser ?? 10,
          maxTradesPerInstrument: next.maxTradesPerInstrument ?? 3,
          maxConcurrentLots: next.maxConcurrentLots ?? 50,
          minPriceDistancePips: effectiveMinPriceDistancePips,
          marketOpenTime: next.marketOpenTime ?? "09:00",
          marketCloseTime: next.marketCloseTime ?? "17:00",
          allowWeekendTrading: next.allowWeekendTrading ?? false,
          enableAutoClose: next.enableAutoClose ?? true,
          autoCloseAfterDays: next.autoCloseAfterDays ?? 4,
          autoCloseCheckFrequencyMinutes: next.autoCloseCheckFrequencyMinutes ?? 60,
          minHoldSec: next.minHoldSec ?? 60,
          enableLossLimits: next.enableLossLimits ?? true,
          dailyLossLimitPct: next.dailyLossLimitPct ?? 10,
          lifetimeLossLimitPct: next.lifetimeLossLimitPct ?? 20,
          lotPresetCards: effectiveLotPresetCards,
          lotDropdownMax: effectiveLotDropdownMax,
        });
      }

      const updated = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1)
      });

      // Propagate changes (multi-role deployments) + reschedule if scheduler is running locally.
      try {
        publishLiveEvent({ type: "global-settings:updated", payload: { updatedAt: nowSec } });
        publishLiveEvent({ type: "autoclose:reschedule", payload: { updatedAt: nowSec } });
      } catch { }
      try {
        await scheduleAutoClose();
      } catch (e) {
        console.warn("Could not reschedule auto-close:", e);
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating global settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // SYSTEM CONFIG ROUTES (Operational Controls)

  const escapeHtml = (s: string) =>
    String(s).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "\"":
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return ch;
      }
    });

  const getSignupLink = () => {
    const base = String(process.env.APP_URL || "http://localhost:5000").replace(/\/+$/, "");
    return `${base}/login`;
  };

  function renderWaitlistInvite(params: {
    fullName: string;
    email: string;
    signupLink: string;
    template: string;
  }): { text: string; html: string; renderedText: string } {
    const renderedText = String(params.template || "")
      .replaceAll("{{name}}", params.fullName || "there")
      .replaceAll("{{email}}", params.email)
      .replaceAll("{{signup_link}}", params.signupLink);

    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; line-height: 1.5;">
        <pre style="white-space: pre-wrap; margin: 0;">${escapeHtml(renderedText)}</pre>
      </div>
    `.trim();

    return { text: renderedText, html, renderedText };
  }

  async function sendInviteEmailResend(opts: { to: string; from: string; subject: string; html: string; text: string }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY missing");

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Resend failed: ${r.status} ${t || ""}`.trim());
    }
  }

  async function sendWaitlistInvites(params: {
    rows: any[];
    adminId: number | null;
    from: string;
    subject: string;
    template: string;
    batchCap: number;
  }): Promise<{ attempted: number; sent: number; failed: number; skipped: number; batchCap: number }> {
    const nowSec = Math.floor(Date.now() / 1000);
    const signupLink = getSignupLink();

    const rowsCapped = params.rows.slice(0, Math.min(500, Math.max(1, params.batchCap || 200)));
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of rowsCapped) {
      const status = String(r.status || "").toUpperCase();
      if (status === "CONVERTED" || status === "OPTED_OUT") {
        skipped++;
        continue;
      }

      const fullName = String(r.fullName || "");
      const email = String(r.email || "");
      const { text, html, renderedText } = renderWaitlistInvite({
        fullName,
        email,
        signupLink,
        template: params.template,
      });

      const bodySha = sha256(
        stableStringify({
          v: 1,
          from: params.from,
          subject: params.subject,
          renderedText,
          signupLink,
        })
      );

      const inviteSendCountNext = Number(r.inviteSendCount ?? 0) + 1;

      try {
        await sendInviteEmailResend({
          to: email,
          from: params.from,
          subject: params.subject,
          html,
          text,
        });

        await db
          .update(signupWaitlist)
          .set({
            status: status === "PENDING" ? "INVITED" : r.status,
            invitedAt: r.invitedAt ?? nowSec,
            invitedByAdminId: r.invitedByAdminId ?? params.adminId,
            inviteSendCount: inviteSendCountNext,
            lastInviteSentAt: nowSec,
            lastInviteStatus: "SENT",
            lastInviteError: null,
            lastInviteFrom: params.from,
            lastInviteSubject: params.subject,
            lastInviteBodySha256: bodySha,
            updatedAt: nowSec,
          })
          .where(eq(signupWaitlist.id, r.id));

        sent++;
      } catch (e: any) {
        await db
          .update(signupWaitlist)
          .set({
            inviteSendCount: inviteSendCountNext,
            lastInviteSentAt: nowSec,
            lastInviteStatus: "FAILED",
            lastInviteError: String(e?.message ?? e),
            lastInviteFrom: params.from,
            lastInviteSubject: params.subject,
            lastInviteBodySha256: bodySha,
            updatedAt: nowSec,
          })
          .where(eq(signupWaitlist.id, r.id));

        failed++;
      }
    }

    return {
      attempted: rowsCapped.length,
      sent,
      failed,
      skipped,
      batchCap: Math.min(500, Math.max(1, params.batchCap || 200)),
    };
  }

  // Get current system config
  app.get("/api/admin/system-config", requireAdmin, async (req: Request, res: Response) => {
    try {
      const config = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1)
      });

      if (!config) {
        // Return defaults if no config exists
        return res.json({
          id: 1,
          maintenanceMode: false,
          tradingHalt: false,
          closeOnlyMode: false,
          blockOpenOnStaleQuotes: true,
          maintenanceMessage: "System is under maintenance. Trading will resume shortly.",
          quoteRefreshMs: 870,
          feedPollMs: 870,
          staleThresholdMs: 30000,
          fxRolloverTz: "America/New_York",
          fxRolloverTime: "17:00",
          signupCaptchaEnforce: false,
          captchaProvider: "TURNSTILE",
          signupPhoneEnforce: true,
          legalCoverageEnforce: false,
          jurisdictionRestrictedIso2Csv: "KP,IR,CU,SY",
          jurisdictionRestrictedMessage: "This jurisdiction is not supported due to regulatory restrictions.",
          jurisdictionEnforceByIpGeo: false,
          jurisdictionEnforceBySignupCountry: true,
          jurisdictionBlockSignup: true,
          jurisdictionBlockLogin: true,
          // Signup freeze + waitlist
          signupFreeze: false,
          signupFreezeMessage: "Signups are temporarily paused due to capacity. Existing users can still log in.",
          signupWaitlistEnabled: true,
          signupWaitlistInviteSender: "TradeQuip <noreply@tradequip.com>",
          signupWaitlistInviteSubject: "Signup slots are open again",
          signupWaitlistInviteBodyText:
            "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}\n\nIf you did not request an invite, you can ignore this message.",
          signupWaitlistAutoInviteOnUnfreeze: false,
          signupWaitlistInviteBatchCap: 200,
          signupWaitlistPolicyVersion: "1",
          signupWaitlistPolicyContent:
            "WAITLIST COMMUNICATIONS & PRIVACY NOTICE\n\nBy requesting an invite, you consent to receive an email when signup slots reopen.\n\nWhat we collect:\n- Your name and email address\n- Basic client metadata (IP address and user agent)\n\nHow we use it:\n- To notify you when signup slots open\n- We do not sell your data\n\nRetention:\n- We retain waitlist records until you are invited or you opt out\n\nOpt-out:\n- You can opt out by replying to an invite email or contacting support.",
          allowUserTimezoneEdit: true,
          scoutTabEnabled: true,
          migrationChunkingEnabled: false,
          migrationChunkSizeMb: 51200,
          updatedAt: null,
          updatedBy: null
        });
      }

      res.json({
        ...config,
        signupCaptchaEnforce: Boolean(config.signupCaptchaEnforce),
        captchaProvider: config.captchaProvider || "TURNSTILE",
        signupPhoneEnforce: true,
        legalCoverageEnforce: Boolean((config as any).legalCoverageEnforce ?? false),
        jurisdictionRestrictedIso2Csv: String((config as any).jurisdictionRestrictedIso2Csv ?? "KP,IR,CU,SY"),
        jurisdictionRestrictedMessage: String(
          (config as any).jurisdictionRestrictedMessage ?? "This jurisdiction is not supported due to regulatory restrictions."
        ),
        jurisdictionEnforceByIpGeo: Boolean((config as any).jurisdictionEnforceByIpGeo ?? false),
        jurisdictionEnforceBySignupCountry: Boolean((config as any).jurisdictionEnforceBySignupCountry ?? true),
        jurisdictionBlockSignup: Boolean((config as any).jurisdictionBlockSignup ?? true),
        jurisdictionBlockLogin: Boolean((config as any).jurisdictionBlockLogin ?? true),
        signupFreeze: Boolean((config as any).signupFreeze ?? false),
        signupFreezeMessage: String((config as any).signupFreezeMessage ?? ""),
        signupWaitlistEnabled: Boolean((config as any).signupWaitlistEnabled ?? true),
        signupWaitlistInviteSender: String((config as any).signupWaitlistInviteSender ?? ""),
        signupWaitlistInviteSubject: String((config as any).signupWaitlistInviteSubject ?? ""),
        signupWaitlistInviteBodyText: String((config as any).signupWaitlistInviteBodyText ?? ""),
        signupWaitlistAutoInviteOnUnfreeze: Boolean((config as any).signupWaitlistAutoInviteOnUnfreeze ?? false),
        signupWaitlistInviteBatchCap: Number((config as any).signupWaitlistInviteBatchCap ?? 200),
        signupWaitlistPolicyVersion: String((config as any).signupWaitlistPolicyVersion ?? "1"),
        signupWaitlistPolicyContent: String((config as any).signupWaitlistPolicyContent ?? ""),
        allowUserTimezoneEdit: Boolean((config as any).allowUserTimezoneEdit ?? true),
        scoutTabEnabled: Boolean((config as any).scoutTabEnabled ?? true),
        fxRolloverTz: (config as any).fxRolloverTz || "America/New_York",
        fxRolloverTime: (config as any).fxRolloverTime || "17:00",
        migrationChunkingEnabled: Boolean((config as any).migrationChunkingEnabled ?? false),
        migrationChunkSizeMb: Number((config as any).migrationChunkSizeMb ?? 51200),
      });
    } catch (error) {
      console.error("Error fetching system config:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update system config
  app.put("/api/admin/system-config", requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const adminUser = req.session?.email || "admin";

      const restrictedCsvRaw =
        typeof body.jurisdictionRestrictedIso2Csv === "string" ? String(body.jurisdictionRestrictedIso2Csv) : undefined;
      const restrictedMsgRaw =
        typeof body.jurisdictionRestrictedMessage === "string" ? String(body.jurisdictionRestrictedMessage) : undefined;

      let restrictedIso2Csv: string | undefined;
      if (restrictedCsvRaw !== undefined) {
        const parsed = parseRestrictedCountriesCsv(restrictedCsvRaw);
        if (parsed.length === 0) {
          return res.status(400).json({ message: "Invalid jurisdictionRestrictedIso2Csv" });
        }
        restrictedIso2Csv = parsed.join(",");
      }

      const restrictedMessage =
        restrictedMsgRaw !== undefined
          ? restrictedMsgRaw.trim() || "This jurisdiction is not supported due to regulatory restrictions."
          : undefined;

      const existing = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1)
      });

      const prevFreeze = Boolean((existing as any)?.signupFreeze ?? false);

      const next = {
        maintenanceMode: body.maintenanceMode,
        tradingHalt: body.tradingHalt,
        closeOnlyMode: body.closeOnlyMode,
        blockOpenOnStaleQuotes: body.blockOpenOnStaleQuotes,
        maintenanceMessage: body.maintenanceMessage,
        quoteRefreshMs: body.quoteRefreshMs ? Number(body.quoteRefreshMs) : undefined,
        feedPollMs: body.feedPollMs ? Number(body.feedPollMs) : undefined,
        staleThresholdMs: body.staleThresholdMs ? Number(body.staleThresholdMs) : undefined,
        fxRolloverTz: typeof body.fxRolloverTz === "string" ? body.fxRolloverTz : undefined,
        fxRolloverTime: typeof body.fxRolloverTime === "string" ? body.fxRolloverTime : undefined,
        signupCaptchaEnforce: body.signupCaptchaEnforce,
        captchaProvider: body.captchaProvider,
        signupPhoneEnforce: true,
        legalCoverageEnforce: body.legalCoverageEnforce,
        jurisdictionRestrictedIso2Csv: restrictedIso2Csv,
        jurisdictionRestrictedMessage: restrictedMessage,
        jurisdictionEnforceByIpGeo:
          body.jurisdictionEnforceByIpGeo !== undefined ? Boolean(body.jurisdictionEnforceByIpGeo) : undefined,
        jurisdictionEnforceBySignupCountry:
          body.jurisdictionEnforceBySignupCountry !== undefined
            ? Boolean(body.jurisdictionEnforceBySignupCountry)
            : undefined,
        jurisdictionBlockSignup:
          body.jurisdictionBlockSignup !== undefined ? Boolean(body.jurisdictionBlockSignup) : undefined,
        jurisdictionBlockLogin:
          body.jurisdictionBlockLogin !== undefined ? Boolean(body.jurisdictionBlockLogin) : undefined,
        allowUserTimezoneEdit: body.allowUserTimezoneEdit,
        scoutTabEnabled: body.scoutTabEnabled !== undefined ? Boolean(body.scoutTabEnabled) : undefined,
        // Signup freeze + waitlist
        signupFreeze: body.signupFreeze !== undefined ? Boolean(body.signupFreeze) : undefined,
        signupFreezeMessage: typeof body.signupFreezeMessage === "string" ? body.signupFreezeMessage : undefined,
        signupWaitlistEnabled: body.signupWaitlistEnabled !== undefined ? Boolean(body.signupWaitlistEnabled) : undefined,
        signupWaitlistInviteSender: typeof body.signupWaitlistInviteSender === "string" ? body.signupWaitlistInviteSender : undefined,
        signupWaitlistInviteSubject: typeof body.signupWaitlistInviteSubject === "string" ? body.signupWaitlistInviteSubject : undefined,
        signupWaitlistInviteBodyText: typeof body.signupWaitlistInviteBodyText === "string" ? body.signupWaitlistInviteBodyText : undefined,
        signupWaitlistAutoInviteOnUnfreeze:
          body.signupWaitlistAutoInviteOnUnfreeze !== undefined
            ? Boolean(body.signupWaitlistAutoInviteOnUnfreeze)
            : undefined,
        signupWaitlistInviteBatchCap:
          body.signupWaitlistInviteBatchCap !== undefined ? Number(body.signupWaitlistInviteBatchCap) : undefined,
        signupWaitlistPolicyVersion: typeof body.signupWaitlistPolicyVersion === "string" ? body.signupWaitlistPolicyVersion : undefined,
        signupWaitlistPolicyContent: typeof body.signupWaitlistPolicyContent === "string" ? body.signupWaitlistPolicyContent : undefined,
        // Migration export/import chunking
        migrationChunkingEnabled:
          body.migrationChunkingEnabled !== undefined ? Boolean(body.migrationChunkingEnabled) : undefined,
        migrationChunkSizeMb:
          body.migrationChunkSizeMb !== undefined ? Number(body.migrationChunkSizeMb) : undefined,
      };

      if ((next as any).migrationChunkSizeMb !== undefined) {
        const mb = Number((next as any).migrationChunkSizeMb);
        if (!Number.isFinite(mb) || mb <= 0) {
          return res.status(400).json({ message: "Invalid migrationChunkSizeMb" });
        }
        (next as any).migrationChunkSizeMb = Math.floor(mb);
      }

      const nextFreeze = (next as any).signupFreeze ?? Boolean((existing as any)?.signupFreeze ?? false);
      const nextWaitlistEnabled = (next as any).signupWaitlistEnabled ?? Boolean((existing as any)?.signupWaitlistEnabled ?? true);
      const nextAutoInvite =
        (next as any).signupWaitlistAutoInviteOnUnfreeze ??
        Boolean((existing as any)?.signupWaitlistAutoInviteOnUnfreeze ?? false);
      const nextBatchCap = Number(
        (next as any).signupWaitlistInviteBatchCap ?? (existing as any)?.signupWaitlistInviteBatchCap ?? 200
      );

      const nowSec = Math.floor(Date.now() / 1000);

      if (existing) {
        await db.update(systemConfig)
          .set({
            maintenanceMode: next.maintenanceMode ?? existing.maintenanceMode,
            tradingHalt: next.tradingHalt ?? existing.tradingHalt,
            closeOnlyMode: next.closeOnlyMode ?? existing.closeOnlyMode,
            blockOpenOnStaleQuotes: next.blockOpenOnStaleQuotes ?? existing.blockOpenOnStaleQuotes,
            maintenanceMessage: next.maintenanceMessage ?? existing.maintenanceMessage,
            quoteRefreshMs: next.quoteRefreshMs ?? existing.quoteRefreshMs,
            feedPollMs: next.feedPollMs ?? existing.feedPollMs,
            staleThresholdMs: next.staleThresholdMs ?? existing.staleThresholdMs,
            fxRolloverTz: next.fxRolloverTz ?? (existing as any).fxRolloverTz ?? "America/New_York",
            fxRolloverTime: next.fxRolloverTime ?? (existing as any).fxRolloverTime ?? "17:00",
            signupCaptchaEnforce: next.signupCaptchaEnforce ?? existing.signupCaptchaEnforce,
            captchaProvider: next.captchaProvider ?? existing.captchaProvider,
            signupPhoneEnforce: true,
            legalCoverageEnforce: next.legalCoverageEnforce ?? existing.legalCoverageEnforce,
            jurisdictionRestrictedIso2Csv:
              (next as any).jurisdictionRestrictedIso2Csv ?? (existing as any).jurisdictionRestrictedIso2Csv ?? "KP,IR,CU,SY",
            jurisdictionRestrictedMessage:
              (next as any).jurisdictionRestrictedMessage ??
              (existing as any).jurisdictionRestrictedMessage ??
              "This jurisdiction is not supported due to regulatory restrictions.",
            jurisdictionEnforceByIpGeo:
              (next as any).jurisdictionEnforceByIpGeo ?? (existing as any).jurisdictionEnforceByIpGeo ?? false,
            jurisdictionEnforceBySignupCountry:
              (next as any).jurisdictionEnforceBySignupCountry ??
              (existing as any).jurisdictionEnforceBySignupCountry ??
              true,
            jurisdictionBlockSignup:
              (next as any).jurisdictionBlockSignup ?? (existing as any).jurisdictionBlockSignup ?? true,
            jurisdictionBlockLogin:
              (next as any).jurisdictionBlockLogin ?? (existing as any).jurisdictionBlockLogin ?? true,
            allowUserTimezoneEdit: next.allowUserTimezoneEdit ?? (existing as any).allowUserTimezoneEdit ?? true,
            scoutTabEnabled: (next as any).scoutTabEnabled ?? (existing as any).scoutTabEnabled ?? true,
            signupFreeze: (next as any).signupFreeze ?? (existing as any).signupFreeze ?? false,
            signupFreezeMessage: (next as any).signupFreezeMessage ?? (existing as any).signupFreezeMessage ?? "",
            signupWaitlistEnabled: (next as any).signupWaitlistEnabled ?? (existing as any).signupWaitlistEnabled ?? true,
            signupWaitlistInviteSender: (next as any).signupWaitlistInviteSender ?? (existing as any).signupWaitlistInviteSender ?? "",
            signupWaitlistInviteSubject: (next as any).signupWaitlistInviteSubject ?? (existing as any).signupWaitlistInviteSubject ?? "",
            signupWaitlistInviteBodyText: (next as any).signupWaitlistInviteBodyText ?? (existing as any).signupWaitlistInviteBodyText ?? "",
            signupWaitlistAutoInviteOnUnfreeze:
              (next as any).signupWaitlistAutoInviteOnUnfreeze ??
              (existing as any).signupWaitlistAutoInviteOnUnfreeze ??
              false,
            signupWaitlistInviteBatchCap: Number(
              (next as any).signupWaitlistInviteBatchCap ?? (existing as any).signupWaitlistInviteBatchCap ?? 200
            ),
            signupWaitlistPolicyVersion: (next as any).signupWaitlistPolicyVersion ?? (existing as any).signupWaitlistPolicyVersion ?? "1",
            signupWaitlistPolicyContent: (next as any).signupWaitlistPolicyContent ?? (existing as any).signupWaitlistPolicyContent ?? "",
            migrationChunkingEnabled:
              (next as any).migrationChunkingEnabled ?? (existing as any).migrationChunkingEnabled ?? false,
            migrationChunkSizeMb: Number(
              (next as any).migrationChunkSizeMb ?? (existing as any).migrationChunkSizeMb ?? 51200
            ),
            updatedAt: nowSec,
            updatedBy: adminUser
          })
          .where(eq(systemConfig.id, 1));
      } else {
        await db.insert(systemConfig).values({
          id: 1,
          maintenanceMode: next.maintenanceMode ?? false,
          tradingHalt: next.tradingHalt ?? false,
          closeOnlyMode: next.closeOnlyMode ?? false,
          blockOpenOnStaleQuotes: next.blockOpenOnStaleQuotes ?? true,
          maintenanceMessage: next.maintenanceMessage ?? "System is under maintenance. Trading will resume shortly.",
          quoteRefreshMs: next.quoteRefreshMs ?? 870,
          feedPollMs: next.feedPollMs ?? 870,
          staleThresholdMs: next.staleThresholdMs ?? 30000,
          fxRolloverTz: next.fxRolloverTz ?? "America/New_York",
          fxRolloverTime: next.fxRolloverTime ?? "17:00",
          signupCaptchaEnforce: next.signupCaptchaEnforce ?? true,
          captchaProvider: next.captchaProvider ?? "SLIDER",
          signupPhoneEnforce: true,
          legalCoverageEnforce: next.legalCoverageEnforce ?? false,
          jurisdictionRestrictedIso2Csv: (next as any).jurisdictionRestrictedIso2Csv ?? "KP,IR,CU,SY",
          jurisdictionRestrictedMessage:
            (next as any).jurisdictionRestrictedMessage ?? "This jurisdiction is not supported due to regulatory restrictions.",
          jurisdictionEnforceByIpGeo: (next as any).jurisdictionEnforceByIpGeo ?? false,
          jurisdictionEnforceBySignupCountry: (next as any).jurisdictionEnforceBySignupCountry ?? true,
          jurisdictionBlockSignup: (next as any).jurisdictionBlockSignup ?? true,
          jurisdictionBlockLogin: (next as any).jurisdictionBlockLogin ?? true,
          allowUserTimezoneEdit: next.allowUserTimezoneEdit ?? true,
          scoutTabEnabled: (next as any).scoutTabEnabled ?? true,
          signupFreeze: (next as any).signupFreeze ?? false,
          signupFreezeMessage: (next as any).signupFreezeMessage ?? "Signups are temporarily paused due to capacity. Existing users can still log in.",
          signupWaitlistEnabled: (next as any).signupWaitlistEnabled ?? true,
          signupWaitlistInviteSender: (next as any).signupWaitlistInviteSender ?? "TradeQuip <noreply@tradequip.com>",
          signupWaitlistInviteSubject: (next as any).signupWaitlistInviteSubject ?? "Signup slots are open again",
          signupWaitlistInviteBodyText:
            (next as any).signupWaitlistInviteBodyText ??
            "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}\n\nIf you did not request an invite, you can ignore this message.",
          signupWaitlistAutoInviteOnUnfreeze: (next as any).signupWaitlistAutoInviteOnUnfreeze ?? false,
          signupWaitlistInviteBatchCap: Number((next as any).signupWaitlistInviteBatchCap ?? 200),
          signupWaitlistPolicyVersion: (next as any).signupWaitlistPolicyVersion ?? "1",
          signupWaitlistPolicyContent:
            (next as any).signupWaitlistPolicyContent ??
            "WAITLIST COMMUNICATIONS & PRIVACY NOTICE\n\nBy requesting an invite, you consent to receive an email when signup slots reopen.\n\nWhat we collect:\n- Your name and email address\n- Basic client metadata (IP address and user agent)\n\nHow we use it:\n- To notify you when signup slots open\n- We do not sell your data\n\nRetention:\n- We retain waitlist records until you are invited or you opt out\n\nOpt-out:\n- You can opt out by replying to an invite email or contacting support.",
          migrationChunkingEnabled: (next as any).migrationChunkingEnabled ?? false,
          migrationChunkSizeMb: Number((next as any).migrationChunkSizeMb ?? 51200),
          updatedBy: adminUser
        });
      }

      try {
        invalidateJurisdictionRestrictionPolicyCache();
      } catch { }

      const updated = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1)
      });

      // Reload feed config immediately so changes take effect without restart
      try {
        void reloadFeedConfig();
      } catch (e) {
        console.warn("Could not reload feed config:", e);
      }

      // Broadcast config invalidations so other nodes refresh cached policy/feed settings.
      try {
        publishLiveEvent({ type: "system-config:updated", payload: { updatedAt: nowSec } });
        publishLiveEvent({ type: "feed:config-updated", payload: { updatedAt: nowSec } });
        publishLiveEvent({ type: "jurisdiction-policy:invalidate", payload: { updatedAt: nowSec } });
      } catch { }

      let autoInviteSummary: any = null;
      const isUnfreezingNow = prevFreeze === true && nextFreeze === false;
      if (isUnfreezingNow && nextAutoInvite && nextWaitlistEnabled) {
        try {
          const cfg = updated ?? (existing as any) ?? {};
          const from = String((cfg as any).signupWaitlistInviteSender ?? "TradeQuip <noreply@tradequip.com>");
          const subject = String((cfg as any).signupWaitlistInviteSubject ?? "Signup slots are open again");
          const template = String(
            (cfg as any).signupWaitlistInviteBodyText ??
            "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}"
          );

          const candidates = await db
            .select()
            .from(signupWaitlist)
            .where(eq(signupWaitlist.status as any, "PENDING"))
            .orderBy(desc(signupWaitlist.id))
            .limit(Math.min(500, Math.max(1, nextBatchCap || 200)));

          autoInviteSummary = await sendWaitlistInvites({
            rows: candidates,
            adminId: Number(req.session?.userId ?? 0) || null,
            from,
            subject,
            template,
            batchCap: nextBatchCap,
          });
        } catch (e: any) {
          autoInviteSummary = { ok: false, error: String(e?.message ?? e) };
        }
      }

      res.json({ ...(updated as any), autoInviteSummary });
    } catch (error) {
      console.error("Error updating system config:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ----------------------------------------------
  // SIGNUP WAITLIST ADMIN (Invite list management)
  // ----------------------------------------------

  function buildWaitlistWhere(params: { status?: unknown; q?: unknown }) {
    const clauses: any[] = [];
    const status = String(params.status ?? "").trim().toUpperCase();
    if (status && status !== "ALL") {
      clauses.push(eq(signupWaitlist.status as any, status));
    }
    const q = String(params.q ?? "").trim().toLowerCase();
    if (q) {
      const pat = `%${q}%`;
      clauses.push(or(like(signupWaitlist.emailLower, pat), like(signupWaitlist.fullName, pat)));
    }
    return clauses.length ? and(...clauses) : undefined;
  }

  // List waitlist entries (paged, filterable)
  app.get("/api/admin/signup-waitlist", requireAdmin, async (req: Request, res: Response) => {
    try {
      const status = String(req.query.status ?? "PENDING").trim().toUpperCase();
      const q = String(req.query.q ?? "").trim().toLowerCase();
      const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));

      const where = buildWaitlistWhere({ status, q });

      const totalRow = await db
        .select({ count: sql<number>`count(*)` })
        .from(signupWaitlist)
        .where(where as any);

      const rows = await db
        .select({
          id: signupWaitlist.id,
          fullName: signupWaitlist.fullName,
          email: signupWaitlist.email,
          emailLower: signupWaitlist.emailLower,
          source: signupWaitlist.source,
          status: signupWaitlist.status,
          consentedAt: signupWaitlist.consentedAt,
          consentDocVersion: signupWaitlist.consentDocVersion,
          consentDocSha256: signupWaitlist.consentDocSha256,
          consentSignature: signupWaitlist.consentSignature,
          invitedAt: signupWaitlist.invitedAt,
          invitedByAdminId: signupWaitlist.invitedByAdminId,
          inviteSendCount: signupWaitlist.inviteSendCount,
          lastInviteSentAt: signupWaitlist.lastInviteSentAt,
          lastInviteStatus: signupWaitlist.lastInviteStatus,
          lastInviteError: signupWaitlist.lastInviteError,
          lastInviteFrom: signupWaitlist.lastInviteFrom,
          lastInviteSubject: signupWaitlist.lastInviteSubject,
          lastInviteBodySha256: signupWaitlist.lastInviteBodySha256,
          convertedAt: signupWaitlist.convertedAt,
          convertedUserId: signupWaitlist.convertedUserId,
          prevHash: signupWaitlist.prevHash,
          recordHash: signupWaitlist.recordHash,
          createdAt: signupWaitlist.createdAt,
          updatedAt: signupWaitlist.updatedAt,
        })
        .from(signupWaitlist)
        .where(where as any)
        .orderBy(desc(signupWaitlist.id))
        .limit(limit)
        .offset(offset);

      return res.json({
        ok: true,
        total: Number(totalRow[0]?.count ?? 0),
        limit,
        offset,
        rows,
      });
    } catch (e: any) {
      console.error("waitlist list error:", e);
      return res.status(400).json({ ok: false, error: e?.message || "Failed to list waitlist." });
    }
  });

  // Export waitlist entries to CSV or JSONL
  app.get("/api/admin/signup-waitlist/export", requireAdmin, async (req: Request, res: Response) => {
    try {
      const format = String(req.query.format ?? "csv").trim().toLowerCase();
      const status = String(req.query.status ?? "PENDING").trim().toUpperCase();
      const q = String(req.query.q ?? "").trim().toLowerCase();

      const where = buildWaitlistWhere({ status, q });
      const rows = await db
        .select({
          id: signupWaitlist.id,
          fullName: signupWaitlist.fullName,
          email: signupWaitlist.email,
          status: signupWaitlist.status,
          consentedAt: signupWaitlist.consentedAt,
          consentDocVersion: signupWaitlist.consentDocVersion,
          consentDocSha256: signupWaitlist.consentDocSha256,
          invitedAt: signupWaitlist.invitedAt,
          inviteSendCount: signupWaitlist.inviteSendCount,
          lastInviteSentAt: signupWaitlist.lastInviteSentAt,
          lastInviteStatus: signupWaitlist.lastInviteStatus,
          lastInviteError: signupWaitlist.lastInviteError,
          convertedAt: signupWaitlist.convertedAt,
          convertedUserId: signupWaitlist.convertedUserId,
          createdAt: signupWaitlist.createdAt,
          updatedAt: signupWaitlist.updatedAt,
        })
        .from(signupWaitlist)
        .where(where as any)
        .orderBy(desc(signupWaitlist.id));

      if (format === "jsonl") {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader("Content-Disposition", `attachment; filename="signup_waitlist.jsonl"`);
        const lines = rows.map((r) => JSON.stringify(r));
        return res.send(lines.join("\n") + "\n");
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="signup_waitlist.csv"`);

      const csv = stringify(rows, { header: true });
      return res.send(csv);
    } catch (e: any) {
      console.error("waitlist export error:", e);
      return res.status(400).json({ ok: false, error: e?.message || "Failed to export waitlist." });
    }
  });

  // Send invite email(s) to waitlist entries
  app.post("/api/admin/signup-waitlist/invite", requireAdmin, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        ids: z.array(z.number().int()).optional(),
        selectAll: z.boolean().optional(),
        status: z.string().optional(),
        q: z.string().optional(),
      });

      const body = schema.parse(req.body || {});
      const adminId = Number(req.session?.userId ?? 0) || null;

      const cfg = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
      const batchCap = Math.min(500, Math.max(1, Number((cfg as any)?.signupWaitlistInviteBatchCap ?? 200)));
      const from = String((cfg as any)?.signupWaitlistInviteSender ?? "TradeQuip <noreply@tradequip.com>");
      const subject = String((cfg as any)?.signupWaitlistInviteSubject ?? "Signup slots are open again");
      const template = String(
        (cfg as any)?.signupWaitlistInviteBodyText ??
        "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}"
      );

      let recipients: any[] = [];
      if (body.ids?.length) {
        const ids = body.ids.slice(0, batchCap);
        recipients = await db.select().from(signupWaitlist).where(inArray(signupWaitlist.id, ids));
      } else if (body.selectAll) {
        const where = buildWaitlistWhere({ status: body.status, q: body.q });
        recipients = await db
          .select()
          .from(signupWaitlist)
          .where(where as any)
          .orderBy(desc(signupWaitlist.id))
          .limit(batchCap);
      } else {
        return res.status(400).json({ ok: false, error: "NO_RECIPIENTS" });
      }

      if (!recipients.length) {
        return res.json({ ok: true, attempted: 0, sent: 0, failed: 0, skipped: 0, batchCap });
      }

      const summary = await sendWaitlistInvites({
        rows: recipients,
        adminId,
        from,
        subject,
        template,
        batchCap,
      });

      return res.json({ ok: true, ...summary });
    } catch (e: any) {
      console.error("waitlist invite error:", e);
      return res.status(400).json({ ok: false, error: e?.message || "Failed to send invites." });
    }
  });

  // Get system health status
  app.get("/api/admin/system-health", requireAdmin, async (req: Request, res: Response) => {
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

      res.json({
        apiConnected: feedProviderConnected,
        lastSuccess: cacheStats.lastSuccessfulApiCall
          ? new Date(cacheStats.lastSuccessfulApiCall).toISOString()
          : null,
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
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== USER MANAGEMENT: Enhanced endpoints ======

  // Get all users with full details (including freeze status)
  app.get("/api/admin/users/full", requireAdmin, async (req: Request, res: Response) => {
    try {
      const usersData = await storage.getAllUsersWithDetails();
      res.json(usersData);
    } catch (error) {
      console.error("Error fetching users with details:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Toggle user enabled/disabled status
  app.post("/api/admin/users/:id/toggle-status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const { disabled } = req.body;
      const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
      const adminIdNum = Number(adminIdRaw);
      if (!Number.isFinite(adminIdNum)) {
        return res.status(401).json({ message: "Admin session missing" });
      }

      const user = await storage.setUserDisabled(
        userId,
        disabled,
        adminIdNum,
        buildProvenance(req, adminIdNum)
      );

      try {
        await applyGriftEnforcementSync({
          userId,
          adminId: adminIdNum,
          action: disabled ? "DISABLE" : "ENABLE",
          reason: disabled ? "Admin toggle-status: disabled" : "Admin toggle-status: enabled",
        });
      } catch (griftErr) {
        console.error("[Grift] Failed to sync enforcement (toggle-status):", griftErr);
      }
      res.json({ success: true, user });
    } catch (error) {
      console.error("Error toggling user status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Freeze user account
  app.post("/api/admin/users/:id/freeze", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const { reasonCode, reasonText } = req.body;
      const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
      const adminIdNum = Number(adminIdRaw);
      if (!Number.isFinite(adminIdNum)) {
        return res.status(401).json({ message: "Admin session missing" });
      }

      if (!reasonCode) {
        return res.status(400).json({ message: "Reason code is required" });
      }

      const user = await storage.freezeUserAccount({
        userId,
        adminId: adminIdNum,
        reasonCode,
        reasonText,
        provenance: buildProvenance(req, adminIdNum),
      });

      try {
        const reason = reasonText ? `${reasonCode}: ${reasonText}` : String(reasonCode);
        await applyGriftEnforcementSync({
          userId,
          adminId: adminIdNum,
          action: "FREEZE",
          reason,
        });
      } catch (griftErr) {
        console.error("[Grift] Failed to sync enforcement (freeze):", griftErr);
      }
      res.json({ success: true, user });
    } catch (error: any) {
      console.error("Error freezing user account:", error);
      if (error.message?.includes("User not found")) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Unfreeze user account
  app.post("/api/admin/users/:id/unfreeze", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const reason = typeof (req.body as any)?.reason === "string" ? String((req.body as any).reason) : undefined;
      const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
      const adminIdNum = Number(adminIdRaw);
      if (!Number.isFinite(adminIdNum)) {
        return res.status(401).json({ message: "Admin session missing" });
      }

      const user = await storage.unfreezeUserAccount({
        userId,
        adminId: adminIdNum,
        reason,
        provenance: buildProvenance(req, adminIdNum),
      });

      try {
        await applyGriftEnforcementSync({
          userId,
          adminId: adminIdNum,
          action: "UNFREEZE",
          reason: typeof reason === "string" ? reason : "Admin unfreeze",
        });
      } catch (griftErr) {
        console.error("[Grift] Failed to sync enforcement (unfreeze):", griftErr);
      }
      res.json({ success: true, user });
    } catch (error: any) {
      console.error("Error unfreezing user account:", error);
      if (error.message?.includes("User not found")) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get user timeline (activity history)
  app.get("/api/admin/users/:id/timeline", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 200;

      const timeline = await storage.getUserTimeline(userId, limit);
      res.json(timeline);
    } catch (error) {
      console.error("Error fetching user timeline:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get user login history
  app.get("/api/admin/users/:id/logins", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const logins = await storage.getUserLoginHistory(userId, limit);
      res.json(logins);
    } catch (error) {
      console.error("Error fetching login history:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get user notes/flags
  app.get("/api/admin/users/:id/notes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const notes = await storage.getUserNotes(userId);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching user notes:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Add note/flag to user
  app.post("/api/admin/users/:id/notes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const { type, severity, flagCode, content } = req.body;
      const adminId = (req as any).user?.id || req.session?.userId;

      if (!content) {
        return res.status(400).json({ message: "Content is required" });
      }

      const note = await storage.addUserNote({
        userId,
        adminId,
        type: type || 'NOTE',
        severity: severity || 'INFO',
        flagCode,
        content,
        provenance: buildProvenance(req, adminId),
      });
      res.json({ success: true, note });
    } catch (error) {
      console.error("Error adding user note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Resolve a note/flag
  app.post("/api/admin/notes/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
    try {
      const noteId = parseInt(getParam(req.params.id), 10);
      const adminId = (req as any).user?.id || req.session?.userId;

      const note = await storage.resolveUserNote(noteId, adminId);
      res.json({ success: true, note });
    } catch (error) {
      console.error("Error resolving note:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== LOGIN HISTORY ======

  // Get all login history (for Login History tab)
  app.get("/api/admin/login-history", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 200;
      const history = await storage.getAllLoginHistory(limit);
      res.json(history);
    } catch (error) {
      console.error("Error fetching login history:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get online/offline user status
  app.get("/api/admin/online-users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const data = await storage.getOnlineUsers();
      res.json(data);
    } catch (error) {
      console.error("Error fetching online users:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== BULK ACTIONS ======

  // Bulk enable/disable users
  app.post("/api/admin/users/bulk/toggle-status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userIds, disabled } = req.body;
      const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
      const adminIdNum = Number(adminIdRaw);
      if (!Number.isFinite(adminIdNum)) {
        return res.status(401).json({ message: "Admin session missing" });
      }

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "User IDs array is required" });
      }

      const count = await storage.bulkSetUsersDisabled(
        userIds,
        disabled,
        adminIdNum,
        buildProvenance(req, adminIdNum)
      );

      try {
        const action = disabled ? "DISABLE" : "ENABLE";
        const reason =
          disabled
            ? `Admin bulk toggle-status: disabled ${userIds.length} users`
            : `Admin bulk toggle-status: enabled ${userIds.length} users`;
        const griftDb = getGriftDb();
        for (const rawId of userIds) {
          const userId = Number(rawId);
          if (!Number.isFinite(userId)) continue;
          await applyGriftEnforcementSyncWithDb(griftDb, {
            userId,
            adminId: adminIdNum,
            action,
            reason,
          });
        }
      } catch (griftErr) {
        console.error("[Grift] Failed to sync enforcement (bulk toggle-status):", griftErr);
      }
      res.json({ success: true, affected: count });
    } catch (error) {
      console.error("Error bulk toggling user status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Bulk apply risk profile
  app.post("/api/admin/users/bulk/risk-profile", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userIds, settings } = req.body;
      const adminId = (req as any).user?.id || req.session?.userId;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "User IDs array is required" });
      }

      if (!settings || Object.keys(settings).length === 0) {
        return res.status(400).json({ message: "Settings object is required" });
      }

      const count = await storage.bulkApplyRiskProfile(
        userIds,
        settings,
        adminId,
        buildProvenance(req, adminId)
      );
      res.json({ success: true, affected: count });
    } catch (error) {
      console.error("Error bulk applying risk profile:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== EXPORT ENDPOINTS ======

  // Export users to CSV
  app.get("/api/admin/export/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const usersData = await storage.getAllUsersWithDetails();
      const loginStatsMap = await storage.getAllUsersLoginStats();

      // Derive status column based on isFrozen and isDisabled flags
      const getStatus = (user: any) => {
        if (user.isFrozen && user.isDisabled) return 'Frozen+Disabled';
        if (user.isFrozen) return 'Frozen';
        if (user.isDisabled) return 'Disabled';
        return 'Active';
      };

      const formatTimestamp = (ts: Date | null) => {
        if (!ts) return '';
        return ts.toISOString();
      };

      const formatSessionLength = (seconds: number) => {
        if (!seconds) return '';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
      };

      const csvData = stringify(usersData.map(u => {
        const stats = loginStatsMap.get(u.id) || {
          lastLoginTime: null,
          lastLoginIp: null,
          lastLogoutTime: null,
          totalSessionLengthSec: 0,
        };

        return {
          id: u.id,
          name: u.name || '',
          email: u.email,
          username: u.username,
          phone: u.phone || '',
          balance: u.balance,
          status: getStatus(u),
          isAdmin: u.isAdmin ? 'Yes' : 'No',
          isDisabled: u.isDisabled ? 'Yes' : 'No',
          isFrozen: u.isFrozen ? 'Yes' : 'No',
          freezeReason: u.freezeReasonCode || '',
          leverage: u.leverage || '',
          maxConcurrent: u.maxConcurrent || '',
          maxConcurrentLots: u.maxConcurrentLots || '',
          minHoldSec: u.minHoldSec || '',
          maxHoldSec: u.maxHoldSec || '',
          createdAt: u.createdAt ? new Date(Number(u.createdAt) * 1000).toISOString() : '',
          lastLoginTime: formatTimestamp(stats.lastLoginTime),
          lastLoginIp: stats.lastLoginIp || '',
          totalSessionsLength: formatSessionLength(stats.totalSessionLengthSec),
          totalSessionsLengthSec: stats.totalSessionLengthSec || '',
          lastLogoutTime: formatTimestamp(stats.lastLogoutTime),
        };
      }), {
        header: true,
        columns: ['id', 'name', 'email', 'username', 'phone', 'balance', 'status', 'isAdmin', 'isDisabled', 'isFrozen', 'freezeReason', 'leverage', 'maxConcurrent', 'maxConcurrentLots', 'minHoldSec', 'maxHoldSec', 'createdAt', 'lastLoginTime', 'lastLoginIp', 'totalSessionsLength', 'totalSessionsLengthSec', 'lastLogoutTime']
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=users_export_${Date.now()}.csv`);
      res.send(csvData);
    } catch (error) {
      console.error("Error exporting users:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Export all users to JSONL format
  app.get("/api/admin/export/users/jsonl", requireAdmin, async (req: Request, res: Response) => {
    try {
      const usersData = await storage.getAllUsersWithDetails();
      const loginStatsMap = await storage.getAllUsersLoginStats();

      const getStatus = (user: any) => {
        if (user.isFrozen && user.isDisabled) return 'Frozen+Disabled';
        if (user.isFrozen) return 'Frozen';
        if (user.isDisabled) return 'Disabled';
        return 'Active';
      };

      const formatTimestamp = (ts: Date | null) => {
        if (!ts) return null;
        return ts.toISOString();
      };

      const jsonlLines = usersData.map(u => {
        const stats = loginStatsMap.get(u.id) || {
          lastLoginTime: null,
          lastLoginIp: null,
          lastLogoutTime: null,
          totalSessionLengthSec: 0,
        };

        return JSON.stringify({
          id: u.id,
          name: u.name || null,
          email: u.email,
          username: u.username,
          phone: u.phone || null,
          balance: Number(u.balance),
          status: getStatus(u),
          isAdmin: u.isAdmin,
          isDisabled: u.isDisabled,
          isFrozen: u.isFrozen,
          freezeReasonCode: u.freezeReasonCode || null,
          leverage: u.leverage ? Number(u.leverage) : null,
          maxConcurrent: u.maxConcurrent ? Number(u.maxConcurrent) : null,
          maxConcurrentLots: u.maxConcurrentLots ? Number(u.maxConcurrentLots) : null,
          minHoldSec: u.minHoldSec ? Number(u.minHoldSec) : null,
          maxHoldSec: u.maxHoldSec ? Number(u.maxHoldSec) : null,
          createdAt: u.createdAt ? new Date(Number(u.createdAt) * 1000).toISOString() : null,
          lastLoginTime: formatTimestamp(stats.lastLoginTime),
          lastLoginIp: stats.lastLoginIp || null,
          totalSessionLengthSec: stats.totalSessionLengthSec || 0,
          lastLogoutTime: formatTimestamp(stats.lastLogoutTime),
          exportedAt: new Date().toISOString(),
        });
      }).join('\n');

      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename=users_export_${Date.now()}.jsonl`);
      res.send(jsonlLines);
    } catch (error) {
      console.error("Error exporting users to JSONL:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Export user activity/timeline to CSV (includes login/logout with session tracking)
  app.get("/api/admin/export/users/:id/timeline", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);

      // Get user info for header columns
      const user = await storage.getUserById(userId);
      const timeline = await storage.getUserTimeline(userId, 1000);

      const formatTimestamp = (ts: any) => {
        if (!ts) return '';
        if (ts instanceof Date) return ts.toISOString();
        const num = Number(ts);
        if (isNaN(num)) return '';
        return new Date(num > 1e12 ? num : num * 1000).toISOString();
      };

      const formatSessionLength = (seconds: number | null | undefined) => {
        if (!seconds) return '';
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
      };

      // Build CSV rows with user info on first row only
      const csvData = stringify(timeline.map((e, index) => ({
        // User info columns - only populated on first row
        userId: index === 0 ? userId : '',
        phone: index === 0 ? (user?.phone || '') : '',
        username: index === 0 ? (user?.username || '') : '',
        email: index === 0 ? (user?.email || '') : '',
        // Event columns
        eventId: e.id,
        type: e.type,
        title: e.title,
        description: e.description || '',
        severity: e.severity,
        timestamp: formatTimestamp(e.timestamp),
        reasonCode: e.reasonCode || '',
        loginTime: formatTimestamp(e.loginTime),
        loginIp: e.loginIp || '',
        sessionLength: formatSessionLength(e.sessionLengthSec),
        sessionLengthSec: e.sessionLengthSec || '',
        logoutTime: formatTimestamp(e.logoutTime),
      })), {
        header: true,
        columns: ['userId', 'phone', 'username', 'email', 'eventId', 'type', 'title', 'description', 'severity', 'timestamp', 'reasonCode', 'loginTime', 'loginIp', 'sessionLength', 'sessionLengthSec', 'logoutTime']
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=user_${userId}_timeline_${Date.now()}.csv`);
      res.send(csvData);
    } catch (error) {
      console.error("Error exporting user timeline:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Export user activity/timeline to JSONL format
  app.get("/api/admin/export/users/:id/timeline/jsonl", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);

      const user = await storage.getUserById(userId);
      const timeline = await storage.getUserTimeline(userId, 1000);

      const formatTimestamp = (ts: any) => {
        if (!ts) return null;
        if (ts instanceof Date) return ts.toISOString();
        const num = Number(ts);
        if (isNaN(num)) return null;
        return new Date(num > 1e12 ? num : num * 1000).toISOString();
      };

      const jsonlLines = timeline.map(e => JSON.stringify({
        userId,
        userPhone: user?.phone || null,
        userUsername: user?.username || null,
        userEmail: user?.email || null,
        eventId: e.id,
        type: e.type,
        title: e.title,
        description: e.description || null,
        severity: e.severity,
        timestamp: formatTimestamp(e.timestamp),
        reasonCode: e.reasonCode || null,
        loginTime: formatTimestamp(e.loginTime),
        loginIp: e.loginIp || null,
        sessionLengthSec: e.sessionLengthSec || null,
        logoutTime: formatTimestamp(e.logoutTime),
        metadata: e.metadata || null,
        exportedAt: new Date().toISOString(),
      })).join('\n');

      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename=user_${userId}_timeline_${Date.now()}.jsonl`);
      res.send(jsonlLines);
    } catch (error) {
      console.error("Error exporting user timeline to JSONL:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== VIEW AS (Admin Impersonation) ======

  // Start impersonating a user
  app.post("/api/admin/view-as/start", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      const targetUserId = parseInt(userId);

      if (isNaN(targetUserId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Can't impersonate yourself
      if (targetUserId === req.session.userId) {
        return res.status(400).json({ message: "Cannot impersonate yourself" });
      }

      // Check if already impersonating
      if (req.session.isImpersonating) {
        return res.status(400).json({ message: "Already impersonating a user. Stop current session first." });
      }

      // Get the target user
      const targetUser = await storage.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Don't allow impersonating other admins
      if (targetUser.isAdmin) {
        return res.status(403).json({ message: "Cannot impersonate admin users" });
      }

      // Store real admin info before switching
      const realAdminId = req.session.userId!;
      const realAdminEmail = req.session.email!;

      // Log the impersonation action
      await storage.logAdminAction({
        adminId: realAdminId,
        userId: targetUserId,
        actionType: "VIEW_AS_START",
        metadata: { targetEmail: targetUser.email },
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
      });

      // Switch session to target user (keeping admin's real info for exit)
      req.session.isImpersonating = true;
      req.session.realAdminId = realAdminId;
      req.session.realAdminEmail = realAdminEmail;
      req.session.impersonatedUserId = targetUserId;
      req.session.impersonationStartedAt = Date.now(); // TTL tracking
      req.session.userId = targetUserId;
      req.session.email = targetUser.email;
      req.session.isAdmin = false; // Temporarily remove admin flag for safety

      res.json({
        success: true,
        message: `Now viewing as ${targetUser.email}`,
        impersonatedUser: {
          id: targetUser.id,
          email: targetUser.email,
          username: targetUser.username,
        },
      });
    } catch (error) {
      console.error("View As start error:", error);
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  // Stop impersonating - return to admin session
  app.post("/api/admin/view-as/stop", async (req: Request, res: Response) => {
    try {
      // Check if currently impersonating
      if (!req.session.isImpersonating || !req.session.realAdminId) {
        return res.status(400).json({ message: "Not currently impersonating any user" });
      }

      const realAdminId = req.session.realAdminId;
      const impersonatedUserId = req.session.impersonatedUserId;

      // Get admin user info to restore session
      const adminUser = await storage.getUserById(realAdminId);
      if (!adminUser) {
        // Fallback - destroy session if admin doesn't exist
        req.session.destroy(() => { });
        return res.status(401).json({ message: "Admin session invalid, please login again" });
      }

      // Log the end of impersonation
      await storage.logAdminAction({
        adminId: realAdminId,
        userId: impersonatedUserId || 0,
        actionType: "VIEW_AS_STOP",
        metadata: null,
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
      });

      // Restore admin session
      req.session.userId = adminUser.id;
      req.session.email = adminUser.email;
      req.session.isAdmin = true;
      req.session.isImpersonating = false;
      req.session.realAdminId = undefined;
      req.session.realAdminEmail = undefined;
      req.session.impersonatedUserId = undefined;
      req.session.impersonationStartedAt = undefined;

      res.json({
        success: true,
        message: "Returned to admin session",
        adminUser: {
          id: adminUser.id,
          email: adminUser.email,
        },
      });
    } catch (error) {
      console.error("View As stop error:", error);
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });

  // Get current impersonation status
  app.get("/api/admin/view-as/status", async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      if (req.session.isImpersonating && req.session.impersonatedUserId) {
        const impersonatedUser = await storage.getUserById(req.session.impersonatedUserId);
        res.json({
          isImpersonating: true,
          realAdminId: req.session.realAdminId,
          realAdminEmail: req.session.realAdminEmail,
          impersonatedUser: impersonatedUser ? {
            id: impersonatedUser.id,
            email: impersonatedUser.email,
            username: impersonatedUser.username,
          } : null,
        });
      } else {
        res.json({
          isImpersonating: false,
        });
      }
    } catch (error) {
      console.error("View As status error:", error);
      res.status(500).json({ message: "Failed to get impersonation status" });
    }
  });

  // Search users for impersonation (quick search)
  app.get("/api/admin/users/search", requireAdmin, async (req: Request, res: Response) => {
    try {
      const query = String(req.query.q || "").trim().toLowerCase();
      if (!query || query.length < 2) {
        return res.json([]);
      }

      const allUsers = await storage.listUsersWithSettings();
      const matches = allUsers
        .filter((u: { isAdmin: boolean; email: string; username: string | null; id: number }) =>
          !u.isAdmin && // Exclude admins
          (u.email.toLowerCase().includes(query) ||
            (u.username && u.username.toLowerCase().includes(query)) ||
            String(u.id).includes(query))
        )
        .slice(0, 10)
        .map((u: { id: number; email: string; username: string | null; balance: string | null }) => ({
          id: u.id,
          email: u.email,
          username: u.username,
          balance: u.balance,
        }));

      res.json(matches);
    } catch (error) {
      console.error("User search error:", error);
      res.status(500).json({ message: "Failed to search users" });
    }
  });

  // Get admin action audit log
  app.get("/api/admin/audit-log", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 500);
      const actions = await storage.getAdminActions(limit);
      res.json(actions);
    } catch (error) {
      console.error("Get audit log error:", error);
      res.status(500).json({ message: "Failed to fetch audit log" });
    }
  });

  // Combined audit trail endpoint (signups, logins, admin actions)
  app.get("/api/admin/audit-trail", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 500);

      // Get recent signups (users created in last 30 days)
      const thirtyDaysAgoMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const allUsers = await storage.listUsersWithSettings();
      const signups = allUsers
        .filter((u: any) => {
          if (!u.createdAt) return false;
          const createdAtMs = typeof u.createdAt === 'object' ? u.createdAt.getTime() : u.createdAt * 1000;
          return createdAtMs >= thirtyDaysAgoMs;
        })
        .slice(0, limit)
        .map((u: any) => ({
          id: u.id,
          email: u.email,
          username: u.username,
          createdAt: typeof u.createdAt === 'object' ? Math.floor(u.createdAt.getTime() / 1000) : u.createdAt,
          // Signup fingerprint data
          signupIp: u.signupIp || null,
          signupIpHash: u.signupIpHash || null,
          signupUserAgent: u.signupUserAgent || null,
          signupCountryCode: u.signupCountryCode || null,
          signupRegion: u.signupRegion || null,
          signupCity: u.signupCity || null,
          signupLatitude: u.signupLatitude || null,
          signupLongitude: u.signupLongitude || null,
          signupDeviceType: u.signupDeviceType || null,
          signupBrowser: u.signupBrowser || null,
          signupOs: u.signupOs || null,
          signupClientTz: u.signupClientTz || null,
          signupInferredTz: u.signupInferredTz || null,
        }));

      // Get recent login history
      const loginHistory = await storage.getAllLoginHistory(limit);
      const logins = loginHistory.map((l: any) => ({
        id: l.id,
        email: l.email,
        success: l.success,
        ip: l.ipAddress || l.ip || null,
        createdAt: typeof l.createdAt === 'object' ? Math.floor(l.createdAt.getTime() / 1000) : l.createdAt,
        // Geo-enrichment for logins
        userAgent: l.userAgent || null,
        countryCode: l.countryCode || null,
        region: l.region || null,
        city: l.city || null,
        latitude: l.latitude || null,
        longitude: l.longitude || null,
        clientTz: l.clientTz || null,
      }));

      // Get recent admin actions
      const adminActions = await storage.getAdminActions(limit);

      // Get identity audit events (verification, KYC, tier changes)
      const identityEvents = await getRecentIdentityAudit({ limit });

      res.json({
        signups,
        logins,
        adminActions: adminActions.map((a: any) => ({
          id: a.id,
          adminId: a.adminId,
          userId: a.userId,
          actionType: a.actionType,
          createdAt: typeof a.createdAt === 'object' ? Math.floor(a.createdAt.getTime() / 1000) : a.createdAt,
          metadata: a.metadata,
          ip: a.ip || null,
          userAgent: a.userAgent || null,
        })),
        identityEvents: identityEvents.map((e: any) => ({
          id: e.id,
          at: e.at,
          userId: e.userId,
          email: e.email,
          username: e.username,
          category: e.category,
          type: e.type,
          title: e.title,
          description: e.description,
          actorAdminId: e.actorAdminId,
          actorType: e.actorType,
          actorUserId: e.actorUserId,
          sessionId: e.sessionId,
          correlationId: e.correlationId,
          data: e.dataJson ? (() => {
            try { return JSON.parse(e.dataJson); } catch { return null; }
          })() : null,
          eventHash: e.eventHash,
        }))
      });
    } catch (error) {
      console.error("Get audit trail error:", error);
      res.status(500).json({ message: "Failed to fetch audit trail" });
    }
  });

  // KYC Queue endpoint - returns users who meet contender criteria
  app.get("/api/admin/kyc-queue", requireAdmin, async (req: Request, res: Response) => {
    try {
      const policyConfig = await loadPolicyConfig();
      const auditCtx = buildAuditContext(req);
      const baseCorrelationId = auditCtx.correlationId;
      const nowMs = Date.now();

      const userRows = await db.select({
        id: users.id,
        email: users.email,
        username: users.username,
        isAdmin: users.isAdmin,
      }).from(users);

      const candidates: Array<any> = [];

      for (const user of userRows) {
        if (user.isAdmin) continue;

        const ctx = await buildDecisionContext({
          userId: user.id,
          nowMs,
          request: {
            correlationId: `${baseCorrelationId}:${user.id}`,
            actorType: "ADMIN",
            actorUserId: auditCtx.actorUserId,
            sessionId: auditCtx.sessionId,
            ip: auditCtx.ip,
            userAgent: auditCtx.userAgent,
          },
          policyConfig,
        });

        const eligibility = computeContenderEligibility(ctx, policyConfig);
        if (!eligibility.eligible) continue;

        const promotion = await promotePerformerIfEligible({
          ctx,
          policyConfig,
          correlationId: `${baseCorrelationId}:${user.id}`,
          actorType: "ADMIN",
          actorUserId: auditCtx.actorUserId,
          sessionId: auditCtx.sessionId,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent,
        });

        if (promotion.promoted) {
          ctx.user.userTier = "PERFORMER";
        }
        if (promotion.eligible && (ctx.user.contenderTier === "NONE" || ctx.user.contenderTier === "CANDIDATE_EMAIL_ONLY")) {
          ctx.user.contenderTier = "CANDIDATE_SMS_REQUIRED";
        }

        if (ctx.user.userTier === "SELECTED" || ctx.user.selectedAt) {
          continue;
        }

        candidates.push({
          userId: user.id,
          email: user.email,
          username: user.username,
          accountAgeDays: ctx.metrics.accountAgeDays,
          tradesLifetime: ctx.metrics.tradesLifetime,
          tradesLast90d: ctx.metrics.tradesLast90d,
          balancePctOfStart: ctx.metrics.balancePctOfStart,
          returnLast90d: ctx.metrics.returnLast90d,
          contenderPath1: eligibility.path1,
          contenderPath2: eligibility.path2,
          userTier: ctx.user.userTier,
          contenderTier: ctx.user.contenderTier,
          selectedAt: toIso(ctx.user.selectedAt),
        });
      }

      candidates.sort((a, b) => {
        if (b.returnLast90d !== a.returnLast90d) return b.returnLast90d - a.returnLast90d;
        return b.balancePctOfStart - a.balancePctOfStart;
      });

      res.json({ candidates });
    } catch (error) {
      console.error("Get KYC queue error:", error);
      res.status(500).json({ message: "Failed to fetch KYC queue" });
    }
  });

  // KYC Status Update endpoint - updates userKycProfiles table
  app.post("/api/admin/users/:id/kyc-status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const adminId = req.session.userId!;
      const { status, notes } = req.body;

      if (!status || !['INVITED', 'APPROVED', 'REJECTED', 'PENDING_DOCS', 'UNDER_REVIEW'].includes(status)) {
        return res.status(400).json({ message: "Valid status is required (INVITED, APPROVED, REJECTED, PENDING_DOCS, UNDER_REVIEW)" });
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const existing = await db.query.userKycProfiles.findFirst({
        where: eq(userKycProfiles.userId, userId),
      });

      const previousStatus = existing?.status ?? "NOT_STARTED";

      if (existing) {
        const updateData: any = {
          status,
          updatedAt: nowSec,
        };

        if (status === "INVITED" && !existing.invitedAt) {
          updateData.invitedAt = nowSec;
          updateData.invitedByAdminId = adminId;
        }

        if (status === "APPROVED" || status === "REJECTED") {
          updateData.reviewedAt = nowSec;
          updateData.reviewedByAdminId = adminId;
          if (notes) updateData.reviewerNote = notes;
          if (status === "REJECTED") updateData.rejectionReason = notes || "Not specified";
        }

        await db.update(userKycProfiles)
          .set(updateData)
          .where(eq(userKycProfiles.userId, userId));
      } else {
        await db.insert(userKycProfiles).values({
          userId,
          status,
          invitedAt: status === "INVITED" ? nowSec : null,
          invitedByAdminId: status === "INVITED" ? adminId : null,
          inviteNote: notes || null,
        });
      }

      if (status === "INVITED") {
        const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
        const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;
        await db.update(users)
          .set({
            userTier: "SELECTED",
            selectedAt,
            tierPromotedAt,
            tierPromotedBy: adminId,
          })
          .where(eq(users.id, userId));

        const verification = await db.query.userVerification.findFirst({
          where: eq(userVerification.userId, userId),
        });
        if (verification && verification.contenderTier !== "SELECTED_REAL_CAPITAL") {
          await db.update(userVerification)
            .set({
              contenderTier: "SELECTED_REAL_CAPITAL",
              updatedAt: nowSec,
            })
            .where(eq(userVerification.userId, userId));
        }

        await ensureDefaultPayoutCurrency(user, userId, nowSec);
      }

      if (status === "APPROVED") {
        const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
        const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;
        await db.update(users)
          .set({
            userTier: "SELECTED",
            selectedAt,
            tierPromotedAt,
            tierPromotedBy: adminId,
          })
          .where(eq(users.id, userId));

        const verification = await db.query.userVerification.findFirst({
          where: eq(userVerification.userId, userId),
        });

        if (verification) {
          await db.update(userVerification)
            .set({
              contenderTier: "SELECTED_REAL_CAPITAL",
              updatedAt: nowSec,
            })
            .where(eq(userVerification.userId, userId));
        }

        await ensureDefaultPayoutCurrency(user, userId, nowSec);
      }

      await storage.logAdminAction({
        adminId,
        userId,
        actionType: `KYC_STATUS_${status}`,
        metadata: { previousStatus, newStatus: status, notes: notes || null },
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
      });

      appendIdentityAudit({
        userId,
        email: user.email,
        category: "KYC",
        type: `KYC_${status}`,
        title: `KYC status updated to ${status}`,
        description: notes || `Admin updated KYC status from ${previousStatus} to ${status}`,
        actorAdminId: adminId,
        ip: req.ip || (req.headers["x-forwarded-for"] as string),
        userAgent: req.headers["user-agent"],
      });

      await notifyKycStatusChange({
        userId,
        status,
        note: typeof notes === "string" ? notes : null,
        actorAdminId: adminId,
      });

      res.json({ success: true, message: `KYC status updated to ${status}` });
    } catch (error) {
      console.error("Update KYC status error:", error);
      res.status(500).json({ message: "Failed to update KYC status" });
    }
  });

  // KYC Invite endpoint - Send KYC invitation to eligible trader
  app.post("/api/admin/kyc/invite", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, note } = req.body;
      const adminId = req.session.userId!;

      if (!userId || typeof userId !== "number") {
        return res.status(400).json({ message: "User ID is required" });
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const existing = await db.query.userKycProfiles.findFirst({
        where: eq(userKycProfiles.userId, userId),
      });

      if (existing && ["INVITED", "SUBMITTED", "APPROVED"].includes(existing.status)) {
        return res.status(400).json({ message: `User already has KYC status: ${existing.status}` });
      }

      const nowSec = Math.floor(Date.now() / 1000);

      const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
      const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;

      if ((user as any).userTier !== "SELECTED" || !(user as any).selectedAt) {
        await db.update(users)
          .set({
            userTier: "SELECTED",
            selectedAt,
            tierPromotedAt,
            tierPromotedBy: adminId,
          })
          .where(eq(users.id, userId));
      }

      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, userId),
      });
      if (verification && verification.contenderTier !== "SELECTED_REAL_CAPITAL") {
        await db.update(userVerification)
          .set({
            contenderTier: "SELECTED_REAL_CAPITAL",
            updatedAt: nowSec,
          })
          .where(eq(userVerification.userId, userId));
      }

      await ensureDefaultPayoutCurrency(user, userId, nowSec);

      if (existing) {
        await db.update(userKycProfiles)
          .set({
            status: "INVITED",
            invitedAt: nowSec,
            invitedByAdminId: adminId,
            inviteNote: note || null,
            updatedAt: nowSec,
          })
          .where(eq(userKycProfiles.userId, userId));
      } else {
        await db.insert(userKycProfiles).values({
          userId,
          status: "INVITED",
          invitedAt: nowSec,
          invitedByAdminId: adminId,
          inviteNote: note || null,
        });
      }

      appendIdentityAudit({
        userId,
        email: user.email,
        category: "KYC",
        type: "KYC_INVITED",
        title: "KYC invitation sent",
        description: note || "Admin invited user for KYC verification",
        actorAdminId: adminId,
        ip: req.ip || (req.headers["x-forwarded-for"] as string),
        userAgent: req.headers["user-agent"],
      });

      await notifyKycStatusChange({
        userId,
        status: "INVITED",
        note: typeof note === "string" ? note : null,
        actorAdminId: adminId,
      });

      res.json({ success: true, message: "KYC invitation sent" });
    } catch (error) {
      console.error("KYC invite error:", error);
      res.status(500).json({ message: "Failed to send KYC invitation" });
    }
  });

  // KYC Review endpoint - Admin reviews KYC submission
  app.post("/api/admin/kyc/review", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, decision, note, rejectionReason } = req.body;
      const adminId = req.session.userId!;

      if (!userId || typeof userId !== "number") {
        return res.status(400).json({ message: "User ID is required" });
      }

      if (!decision || !["APPROVED", "REJECTED"].includes(decision)) {
        return res.status(400).json({ message: "Decision must be APPROVED or REJECTED" });
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const kycProfile = await db.query.userKycProfiles.findFirst({
        where: eq(userKycProfiles.userId, userId),
      });

      if (!kycProfile) {
        return res.status(404).json({ message: "No KYC profile found for user" });
      }

      if (kycProfile.status !== "SUBMITTED") {
        return res.status(400).json({ message: `Cannot review KYC with status: ${kycProfile.status}` });
      }

      const nowSec = Math.floor(Date.now() / 1000);

      await db.update(userKycProfiles)
        .set({
          status: decision,
          reviewedAt: nowSec,
          reviewedByAdminId: adminId,
          reviewerNote: note || null,
          rejectionReason: decision === "REJECTED" ? (rejectionReason || "Not specified") : null,
          updatedAt: nowSec,
        })
        .where(eq(userKycProfiles.userId, userId));

      if (decision === "APPROVED") {
        const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
        const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;
        await db.update(users)
          .set({
            userTier: "SELECTED",
            selectedAt,
            tierPromotedAt,
            tierPromotedBy: adminId,
          })
          .where(eq(users.id, userId));

        const verification = await db.query.userVerification.findFirst({
          where: eq(userVerification.userId, userId),
        });

        if (verification) {
          await db.update(userVerification)
            .set({
              contenderTier: "SELECTED_REAL_CAPITAL",
              updatedAt: nowSec,
            })
            .where(eq(userVerification.userId, userId));
        }

        await ensureDefaultPayoutCurrency(user, userId, nowSec);
      }

      appendIdentityAudit({
        userId,
        email: user.email,
        category: "KYC",
        type: decision === "APPROVED" ? "KYC_APPROVED" : "KYC_REJECTED",
        title: `KYC ${decision.toLowerCase()}`,
        description: rejectionReason || note || `Admin ${decision.toLowerCase()} KYC`,
        actorAdminId: adminId,
        ip: req.ip || (req.headers["x-forwarded-for"] as string),
        userAgent: req.headers["user-agent"],
      });

      await notifyKycStatusChange({
        userId,
        status: decision,
        note: typeof rejectionReason === "string" && rejectionReason
          ? rejectionReason
          : typeof note === "string"
            ? note
            : null,
        actorAdminId: adminId,
      });

      res.json({
        success: true,
        message: `KYC ${decision.toLowerCase()}`,
        newTier: decision === "APPROVED" ? "SELECTED" : undefined,
      });
    } catch (error) {
      console.error("KYC review error:", error);
      res.status(500).json({ message: "Failed to process KYC review" });
    }
  });

  // Admin tier management endpoint
  const tierChangeSchema = z.object({
    tier: z.enum(["CANDIDATE", "PERFORMER", "SELECTED"]),
    reason: z.string().optional(),
  });

  app.post("/api/admin/users/:id/tier", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.id), 10);
      const adminId = req.session.userId!;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const parsed = tierChangeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid request body",
          errors: parsed.error.issues
        });
      }

      const { tier, reason } = parsed.data;

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const oldTier = (user as any).userTier || "CANDIDATE";
      if (oldTier === tier) {
        return res.status(400).json({ message: `User is already in ${tier} tier` });
      }

      const isPromotion = ["CANDIDATE", "PERFORMER", "SELECTED"].indexOf(tier) >
        ["CANDIDATE", "PERFORMER", "SELECTED"].indexOf(oldTier);

      const nowSec = Math.floor(Date.now() / 1000);
      const updateUserData: any = { userTier: tier };
      if (tier === "SELECTED") {
        updateUserData.selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
        if (isPromotion) {
          updateUserData.tierPromotedAt = nowSec;
          updateUserData.tierPromotedBy = adminId;
        }
      } else if ((user as any).selectedAt) {
        updateUserData.selectedAt = null;
      }

      await db.update(users)
        .set(updateUserData)
        .where(eq(users.id, userId));

      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, userId),
      });

      if (verification) {
        let newContenderTier: string;
        if (tier === "SELECTED") {
          newContenderTier = "SELECTED_REAL_CAPITAL";
        } else if (tier === "PERFORMER") {
          // When demoting to PERFORMER, preserve verification state:
          // - If they had SMS verified, keep VERIFIED_SMS
          // - If they had email verified, set CANDIDATE_SMS_REQUIRED (eligible for SMS)
          // - Otherwise set NONE
          if (verification.smsVerifiedAt) {
            newContenderTier = "VERIFIED_SMS";
          } else if (verification.emailVerifiedAt) {
            newContenderTier = "CANDIDATE_SMS_REQUIRED";
          } else {
            newContenderTier = "NONE";
          }
        } else {
          // CANDIDATE tier resets to NONE
          newContenderTier = "NONE";
        }

        await db.update(userVerification)
          .set({
            contenderTier: newContenderTier,
            updatedAt: nowSec,
          })
          .where(eq(userVerification.userId, userId));
      }

      if (tier === "SELECTED") {
        await ensureDefaultPayoutCurrency(user, userId, nowSec);
      }

      appendIdentityAudit({
        userId,
        email: user.email,
        username: user.username,
        category: "TIER",
        type: "TIER_CHANGED",
        title: `Tier ${isPromotion ? 'promoted' : 'demoted'}: ${oldTier} → ${tier}`,
        description: reason || `Admin ${isPromotion ? 'promoted' : 'demoted'} user tier`,
        actorAdminId: adminId,
        ip: req.ip || (req.headers["x-forwarded-for"] as string),
        userAgent: req.headers["user-agent"],
      });

      res.json({
        success: true,
        message: `User tier changed from ${oldTier} to ${tier}`,
        oldTier,
        newTier: tier,
      });
    } catch (error) {
      console.error("Tier change error:", error);
      res.status(500).json({ message: "Failed to update tier" });
    }
  });

  // Admin user-profiles endpoint - verification status for all users
  app.get("/api/admin/user-profiles", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = (req.query.q as string) || "";

      const allUsers = await storage.listUsersWithSettings();

      let filtered = allUsers.filter((u: any) => !u.isAdmin);

      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((u: any) =>
          u.email?.toLowerCase().includes(q) ||
          u.username?.toLowerCase().includes(q)
        );
      }

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit);

      const results = await Promise.all(
        paged.map(async (user: any) => {
          const verification = await db.query.userVerification.findFirst({
            where: eq(userVerification.userId, user.id),
          });

          const kyc = await db.query.userKycProfiles.findFirst({
            where: eq(userKycProfiles.userId, user.id),
          });

          const payout = await db.query.userPayoutProfiles.findFirst({
            where: eq(userPayoutProfiles.userId, user.id),
          });

          return {
            userId: user.id,
            email: user.email,
            username: user.username,
            userTier: user.userTier || "CANDIDATE",
            createdAt: user.createdAt,
            emailVerified: !!verification?.emailVerifiedAt,
            emailVerifiedAt: verification?.emailVerifiedAt,
            emailReverifyDueAt: verification?.emailReverifyDueAt,
            phoneVerified: !!verification?.smsVerifiedAt,
            phoneVerifiedAt: verification?.smsVerifiedAt,
            contenderTier: verification?.contenderTier || "NONE",
            kycStatus: kyc?.status || "NOT_STARTED",
            kycInvitedAt: kyc?.invitedAt,
            kycSubmittedAt: kyc?.submittedAt,
            kycReviewedAt: kyc?.reviewedAt,
            preferredPaymentCurrency: payout?.preferredPaymentCurrency,
          };
        })
      );

      res.json({
        users: results,
        total,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Get user profiles error:", error);
      res.status(500).json({ message: "Failed to fetch user profiles" });
    }
  });

  // Get KYC submissions pending review
  app.get("/api/admin/kyc/pending", requireAdmin, async (req: Request, res: Response) => {
    try {
      const pending = await db.query.userKycProfiles.findMany({
        where: eq(userKycProfiles.status, "SUBMITTED"),
      });

      const results = await Promise.all(
        pending.map(async (kyc) => {
          const user = await storage.getUserById(kyc.userId);
          return {
            userId: kyc.userId,
            email: user?.email,
            username: user?.username,
            submittedAt: kyc.submittedAt,
            documentType: kyc.documentType,
          };
        })
      );

      res.json(results);
    } catch (error) {
      console.error("Get pending KYC error:", error);
      res.status(500).json({ message: "Failed to fetch pending KYC" });
    }
  });

  // KYC Queue endpoint - returns INVITED and SUBMITTED users for admin review
  app.get("/api/admin/kyc/queue", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { status } = req.query;

      // Get all KYC profiles with INVITED or SUBMITTED status
      const kycProfiles = await db.query.userKycProfiles.findMany({
        where: status && status !== "all_status"
          ? eq(userKycProfiles.status, String(status))
          : inArray(userKycProfiles.status, ["INVITED", "SUBMITTED"]),
      });

      const results = await Promise.all(
        kycProfiles.map(async (kyc) => {
          const user = await storage.getUserById(kyc.userId);
          return {
            userId: kyc.userId,
            email: user?.email || "",
            username: user?.username || "",
            status: kyc.status,
            invitedAt: toUnixSec(kyc.invitedAt),
            submittedAt: toUnixSec(kyc.submittedAt),
            documentType: kyc.documentType,
            invitedByAdminId: kyc.invitedByAdminId,
            inviteNote: kyc.inviteNote,
          };
        })
      );

      // Sort: SUBMITTED first (pending review), then by most recent
      results.sort((a, b) => {
        if (a.status === "SUBMITTED" && b.status !== "SUBMITTED") return -1;
        if (a.status !== "SUBMITTED" && b.status === "SUBMITTED") return 1;
        const aTime = a.submittedAt || a.invitedAt || 0;
        const bTime = b.submittedAt || b.invitedAt || 0;
        return bTime - aTime;
      });

      res.json(results);
    } catch (error) {
      console.error("Get KYC queue error:", error);
      res.status(500).json({ message: "Failed to fetch KYC queue" });
    }
  });

  // Signup Funnel endpoint
  app.get("/api/admin/signup-funnel", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = days === 0 ? 0 : nowSec - (days * 24 * 60 * 60);

      const allUsers = await storage.listUsersWithSettings();

      // Filter by date range
      const filteredUsers = allUsers.filter((u: any) => {
        if (u.isAdmin) return false;
        const createdAt = typeof u.createdAt === 'object'
          ? Math.floor(u.createdAt.getTime() / 1000)
          : (u.createdAt || 0);
        return createdAt >= cutoff;
      });

      const totalSignups = filteredUsers.length;

      // Count users with completed profiles (has username and phone)
      const completedProfiles = filteredUsers.filter((u: any) =>
        u.username && u.phone
      ).length;

      // Get trading data for funnel calculations
      let firstTrade = 0;
      let tenTrades = 0;
      let profitable = 0;

      for (const user of filteredUsers) {
        const userTrades = await db.select().from(trades).where(eq(trades.userId, user.id));
        const closedTrades = userTrades.filter((t: any) => t.status === 'CLOSED');

        if (closedTrades.length > 0) {
          firstTrade++;

          if (closedTrades.length >= 10) {
            tenTrades++;

            const totalProfit = closedTrades.reduce((sum: number, t: any) =>
              sum +
              (Number.isFinite(Number(t?.netProfitUsd))
                ? Number(t.netProfitUsd)
                : Number.parseFloat(String(t?.profit ?? "0")) || 0),
            0);
            if (totalProfit > 0) {
              profitable++;
            }
          }
        }
      }

      res.json({
        totalSignups,
        completedProfiles,
        firstTrade,
        tenTrades,
        profitable
      });
    } catch (error) {
      console.error("Get signup funnel error:", error);
      res.status(500).json({ message: "Failed to fetch signup funnel" });
    }
  });

  // User Analytics endpoint
  app.get("/api/admin/user-analytics", requireAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const nowSec = Math.floor(Date.now() / 1000);

      // Get all users
      const allUsers = await storage.listUsersWithSettings();
      const activeUsers = allUsers.filter((u: any) => !u.isAdmin);

      // Calculate active users in different time periods
      const oneDayAgo = nowSec - (1 * 24 * 60 * 60);
      const sevenDaysAgo = nowSec - (7 * 24 * 60 * 60);
      const thirtyDaysAgo = nowSec - (30 * 24 * 60 * 60);

      // Get login history for activity analysis
      const loginHistory = await storage.getAllLoginHistory(1000);

      const activeDaily = new Set(
        loginHistory
          .filter((l: any) => {
            const createdAt = typeof l.createdAt === 'object'
              ? Math.floor(l.createdAt.getTime() / 1000)
              : (l.createdAt || 0);
            return createdAt >= oneDayAgo && l.success;
          })
          .map((l: any) => l.userId)
      ).size;

      const activeWeekly = new Set(
        loginHistory
          .filter((l: any) => {
            const createdAt = typeof l.createdAt === 'object'
              ? Math.floor(l.createdAt.getTime() / 1000)
              : (l.createdAt || 0);
            return createdAt >= sevenDaysAgo && l.success;
          })
          .map((l: any) => l.userId)
      ).size;

      const activeMonthly = new Set(
        loginHistory
          .filter((l: any) => {
            const createdAt = typeof l.createdAt === 'object'
              ? Math.floor(l.createdAt.getTime() / 1000)
              : (l.createdAt || 0);
            return createdAt >= thirtyDaysAgo && l.success;
          })
          .map((l: any) => l.userId)
      ).size;

      // Calculate average session duration (estimate from login intervals)
      // This is a rough estimate - real session tracking would be more accurate
      const avgSessionMinutes = 15; // Placeholder - would need actual session tracking

      // Calculate average trades per active user
      const allTrades = await db.select().from(trades).where(eq(trades.status, 'CLOSED'));
      const avgTradesPerUser = activeUsers.length > 0
        ? allTrades.length / activeUsers.length
        : 0;

      // Calculate retention (users who logged in again within 7/30 days of signup)
      let signupsWith7DayReturn = 0;
      let signupsWith30DayReturn = 0;
      let eligibleFor7Day = 0;
      let eligibleFor30Day = 0;

      for (const user of activeUsers) {
        const userAny = user as any;
        const createdAt = typeof userAny.createdAt === 'object'
          ? Math.floor(userAny.createdAt.getTime() / 1000)
          : (userAny.createdAt || nowSec);

        const accountAgeDays = (nowSec - createdAt) / (24 * 60 * 60);

        if (accountAgeDays >= 7) {
          eligibleFor7Day++;
          const userLogins = loginHistory.filter((l: any) => {
            if (l.userId !== user.id || !l.success) return false;
            const loginTime = typeof l.createdAt === 'object'
              ? Math.floor(l.createdAt.getTime() / 1000)
              : (l.createdAt || 0);
            return loginTime > createdAt + (7 * 24 * 60 * 60);
          });
          if (userLogins.length > 0) signupsWith7DayReturn++;
        }

        if (accountAgeDays >= 30) {
          eligibleFor30Day++;
          const userLogins = loginHistory.filter((l: any) => {
            if (l.userId !== user.id || !l.success) return false;
            const loginTime = typeof l.createdAt === 'object'
              ? Math.floor(l.createdAt.getTime() / 1000)
              : (l.createdAt || 0);
            return loginTime > createdAt + (30 * 24 * 60 * 60);
          });
          if (userLogins.length > 0) signupsWith30DayReturn++;
        }
      }

      const retentionD7 = eligibleFor7Day > 0 ? (signupsWith7DayReturn / eligibleFor7Day) * 100 : 0;
      const retentionD30 = eligibleFor30Day > 0 ? (signupsWith30DayReturn / eligibleFor30Day) * 100 : 0;

      res.json({
        activeDaily,
        activeWeekly,
        activeMonthly,
        avgSessionMinutes,
        avgTradesPerUser: Math.round(avgTradesPerUser * 10) / 10,
        retentionD7: Math.round(retentionD7 * 10) / 10,
        retentionD30: Math.round(retentionD30 * 10) / 10
      });
    } catch (error) {
      console.error("Get user analytics error:", error);
      res.status(500).json({ message: "Failed to fetch user analytics" });
    }
  });

  // Verification Compliance Metrics
  app.get("/api/admin/analytics/compliance", requireAdmin, async (req: Request, res: Response) => {
    try {
      const metrics = await storage.getVerificationComplianceMetrics();
      res.json(metrics);
    } catch (error) {
      console.error("Get compliance metrics error:", error);
      res.status(500).json({ message: "Failed to fetch compliance metrics" });
    }
  });

  // INSTITUTIONAL AUDIT EXPORT ENDPOINTS
  // Export trade audit to CSV with SHA-256 manifest
  app.get("/api/admin/trade-audit/export/csv", requireAdmin, async (req: Request, res: Response) => {
    try {
      const crypto = await import("crypto");
      const { tradeId, eventType, riskResult, correlationId, limit = "10000" } = req.query;
      const exportId = `EXP-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

      // Build WHERE conditions BEFORE query to ensure filters apply before LIMIT
      const conditions: any[] = [];
      if (tradeId) {
        conditions.push(eq(tradeAudit.tradeId, parseInt(String(tradeId), 10)));
      }
      if (eventType && eventType !== "all") {
        conditions.push(eq(tradeAudit.eventType, String(eventType)));
      }
      if (riskResult && riskResult !== "all") {
        conditions.push(eq(tradeAudit.riskResult, String(riskResult)));
      }
      if (correlationId) {
        conditions.push(eq(tradeAudit.correlationId, String(correlationId)));
      }

      let queryBuilder = db
        .select({
          id: tradeAudit.id,
          tradeId: tradeAudit.tradeId,
          eventType: tradeAudit.eventType,
          eventCategory: tradeAudit.eventCategory,
          eventAt: tradeAudit.eventAt,
          eventAtMs: tradeAudit.eventAtMs,
          correlationId: tradeAudit.correlationId,
          orderId: tradeAudit.orderId,
          executionId: tradeAudit.executionId,
          positionId: tradeAudit.positionId,
          actorType: tradeAudit.actorType,
          actorUserId: tradeAudit.actorUserId,
          sessionId: tradeAudit.sessionId,
          ip: tradeAudit.ip,
          symbol: tradeAudit.symbol,
          side: tradeAudit.side,
          orderType: tradeAudit.orderType,
          timeInForce: tradeAudit.timeInForce,
          qtyLots: tradeAudit.qtyLots,
          notionalUsd: tradeAudit.notionalUsd,
          grossProfitUsd: tradeAudit.grossProfitUsd,
          netProfitUsd: tradeAudit.netProfitUsd,
          totalCostsUsd: tradeAudit.totalCostsUsd,
          openCommissionUsd: tradeAudit.openCommissionUsd,
          closeCommissionUsd: tradeAudit.closeCommissionUsd,
          openOtherFeesUsd: tradeAudit.openOtherFeesUsd,
          closeOtherFeesUsd: tradeAudit.closeOtherFeesUsd,
          financingAccruedUsd: tradeAudit.financingAccruedUsd,
          swapAccruedUsd: tradeAudit.swapAccruedUsd,
          overnightDays: tradeAudit.overnightDays,
          categorySnapshot: tradeAudit.categorySnapshot,
          costModelVersion: tradeAudit.costModelVersion,
          requestedPrice: tradeAudit.requestedPrice,
          triggerPrice: tradeAudit.triggerPrice,
          limitPrice: tradeAudit.limitPrice,
          stopPrice: tradeAudit.stopPrice,
          fillPrice: tradeAudit.fillPrice,
          avgFillPrice: tradeAudit.avgFillPrice,
          slippage: tradeAudit.slippage,
          slippagePips: tradeAudit.slippagePips,
          slippageReference: tradeAudit.slippageReference,
          latencyMs: tradeAudit.latencyMs,
          quoteTs: tradeAudit.quoteTs,
          quoteSource: tradeAudit.quoteSource,
          quoteBid: tradeAudit.quoteBid,
          quoteAsk: tradeAudit.quoteAsk,
          quoteMid: tradeAudit.quoteMid,
          quoteSpread: tradeAudit.quoteSpread,
          spreadPips: tradeAudit.spreadPips,
          riskCheckName: tradeAudit.riskCheckName,
          riskLimitValue: tradeAudit.riskLimitValue,
          riskObservedValue: tradeAudit.riskObservedValue,
          riskResult: tradeAudit.riskResult,
          reasonCode: tradeAudit.reasonCode,
          prevHash: tradeAudit.prevHash,
          eventHash: tradeAudit.eventHash,
          note: tradeAudit.note,
          symbolFromTrade: symbolConfigs.symbol,
          userId: trades.userId,
          username: users.username,
          tradeNotionalUsd: trades.notionalUsd,
          tradeGrossProfitUsd: trades.grossProfitUsd,
          tradeNetProfitUsd: trades.netProfitUsd,
          tradeTotalCostsUsd: trades.totalCostsUsd,
          tradeOpenCommissionUsd: trades.openCommissionUsd,
          tradeCloseCommissionUsd: trades.closeCommissionUsd,
          tradeOpenOtherFeesUsd: trades.openOtherFeesUsd,
          tradeCloseOtherFeesUsd: trades.closeOtherFeesUsd,
          tradeFinancingAccruedUsd: trades.financingAccruedUsd,
          tradeSwapAccruedUsd: trades.swapAccruedUsd,
          tradeOvernightDays: trades.overnightDays,
          tradeCategorySnapshot: trades.categorySnapshot,
          tradeCostModelVersion: trades.costModelVersion,
        })
        .from(tradeAudit)
        .leftJoin(trades, eq(tradeAudit.tradeId, trades.id))
        .leftJoin(users, eq(trades.userId, users.id))
        .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id));

      // Apply filters in SQL before LIMIT for complete exports
      if (conditions.length > 0) {
        queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder;
      }

      const records = await queryBuilder
        .orderBy(desc(tradeAudit.eventAt))
        .limit(parseInt(String(limit), 10));

      // Normalize for export
      const normalized = records.map(r => ({
        ...r,
        symbol: r.symbol || r.symbolFromTrade,
        notionalUsd: r.notionalUsd ?? r.tradeNotionalUsd,
        grossProfitUsd: r.grossProfitUsd ?? r.tradeGrossProfitUsd,
        netProfitUsd: r.netProfitUsd ?? r.tradeNetProfitUsd,
        totalCostsUsd: r.totalCostsUsd ?? r.tradeTotalCostsUsd,
        openCommissionUsd: r.openCommissionUsd ?? r.tradeOpenCommissionUsd,
        closeCommissionUsd: r.closeCommissionUsd ?? r.tradeCloseCommissionUsd,
        openOtherFeesUsd: r.openOtherFeesUsd ?? r.tradeOpenOtherFeesUsd,
        closeOtherFeesUsd: r.closeOtherFeesUsd ?? r.tradeCloseOtherFeesUsd,
        financingAccruedUsd: r.financingAccruedUsd ?? r.tradeFinancingAccruedUsd,
        swapAccruedUsd: r.swapAccruedUsd ?? r.tradeSwapAccruedUsd,
        overnightDays: r.overnightDays ?? r.tradeOvernightDays,
        categorySnapshot: r.categorySnapshot ?? r.tradeCategorySnapshot,
        costModelVersion: r.costModelVersion ?? r.tradeCostModelVersion,
        eventAt: toIso(r.eventAt),
        quoteTs: toIso(r.quoteTs),
      }));

      const csv = stringify(normalized, { header: true });
      const sha256 = crypto.createHash("sha256").update(csv).digest("hex");

      // Store manifest
      try {
        await exec(
          `
          INSERT INTO audit_export_manifest (export_id, exported_at_utc_ms, export_type, export_format, filters_json, record_count, sha256)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [exportId, Date.now(), "trade_audit", "csv", JSON.stringify(req.query), normalized.length, sha256]
        );
      } catch (manifestErr) {
        console.error("Error storing export manifest:", manifestErr);
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="trade-audit-${exportId}.csv"`);
      res.setHeader("X-Export-Id", exportId);
      res.setHeader("X-SHA256", sha256);
      res.setHeader("X-Record-Count", String(normalized.length));
      res.send(csv);
    } catch (error) {
      console.error("Error exporting trade audit CSV:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Export order intent audit to CSV with SHA-256 manifest
  app.get("/api/admin/order-intent-audit/export/csv", requireAdmin, async (req: Request, res: Response) => {
    try {
      const crypto = await import("crypto");
      const { correlationId, decision, userId, limit = "10000" } = req.query;
      const exportId = `EXP-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

      // Build WHERE conditions BEFORE query to ensure filters apply before LIMIT
      const conditions: any[] = [];
      if (correlationId) {
        conditions.push(eq(orderIntentAudit.correlationId, String(correlationId)));
      }
      if (decision && decision !== "all") {
        conditions.push(eq(orderIntentAudit.decision, String(decision)));
      }
      if (userId) {
        conditions.push(eq(orderIntentAudit.userId, parseInt(String(userId), 10)));
      }

      let queryBuilder = db
        .select()
        .from(orderIntentAudit);

      // Apply filters in SQL before LIMIT for complete exports
      if (conditions.length > 0) {
        queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder;
      }

      const records = await queryBuilder
        .orderBy(desc(orderIntentAudit.eventAt))
        .limit(parseInt(String(limit), 10));

      // Normalize for export
      const normalized = records.map(r => ({
        ...r,
        eventAt: toIso(r.eventAt),
        quoteTs: toIso(r.quoteTs),
      }));

      const csv = stringify(normalized, { header: true });
      const sha256 = crypto.createHash("sha256").update(csv).digest("hex");

      // Store manifest
      try {
        await exec(
          `
          INSERT INTO audit_export_manifest (export_id, exported_at_utc_ms, export_type, export_format, filters_json, record_count, sha256)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [exportId, Date.now(), "order_intent_audit", "csv", JSON.stringify(req.query), normalized.length, sha256]
        );
      } catch (manifestErr) {
        console.error("Error storing export manifest:", manifestErr);
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="order-intent-audit-${exportId}.csv"`);
      res.setHeader("X-Export-Id", exportId);
      res.setHeader("X-SHA256", sha256);
      res.setHeader("X-Record-Count", String(normalized.length));
      res.send(csv);
    } catch (error) {
      console.error("Error exporting order intent audit CSV:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Export trade audit to JSONL (forensic replay format)
  app.get("/api/admin/trade-audit/export/jsonl", requireAdmin, async (req: Request, res: Response) => {
    try {
      const crypto = await import("crypto");
      const { tradeId, correlationId, limit = "10000" } = req.query;
      const exportId = `EXP-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

      // Build WHERE conditions BEFORE query to ensure filters apply before LIMIT
      const conditions: any[] = [];
      if (tradeId) {
        conditions.push(eq(tradeAudit.tradeId, parseInt(String(tradeId), 10)));
      }
      if (correlationId) {
        conditions.push(eq(tradeAudit.correlationId, String(correlationId)));
      }

      let queryBuilder = db
        .select()
        .from(tradeAudit);

      // Apply filters in SQL before LIMIT for complete exports
      if (conditions.length > 0) {
        queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder;
      }

      const records = await queryBuilder
        .orderBy(tradeAudit.id)
        .limit(parseInt(String(limit), 10));

      const jsonl = records.map(r => JSON.stringify(r)).join("\n");
      const sha256 = crypto.createHash("sha256").update(jsonl).digest("hex");

      // Store manifest
      try {
        await exec(
          `
          INSERT INTO audit_export_manifest (export_id, exported_at_utc_ms, export_type, export_format, filters_json, record_count, sha256)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [exportId, Date.now(), "trade_audit", "jsonl", JSON.stringify(req.query), records.length, sha256]
        );
      } catch (manifestErr) {
        console.error("Error storing export manifest:", manifestErr);
      }

      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", `attachment; filename="trade-audit-${exportId}.jsonl"`);
      res.setHeader("X-Export-Id", exportId);
      res.setHeader("X-SHA256", sha256);
      res.setHeader("X-Record-Count", String(records.length));
      res.send(jsonl);
    } catch (error) {
      console.error("Error exporting trade audit JSONL:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get export manifest history
  app.get("/api/admin/export-manifests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 100), 500);
      const manifests = await queryAll(`
        SELECT * FROM audit_export_manifest
        ORDER BY exported_at_utc_ms DESC
        LIMIT ?
      `, [limit]);
      res.json(manifests);
    } catch (error) {
      console.error("Error fetching export manifests:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // IDENTITY AUDIT ROUTES
  const identityAuditQuerySchema = z.object({
    userId: z.string().regex(/^\d+$/).optional().transform(v => v ? parseInt(v, 10) : undefined),
    category: z.string().optional(),
    type: z.string().optional(),
    limit: z.string().regex(/^\d+$/).optional().transform(v => Math.min(Math.max(1, parseInt(v || "100", 10)), 500)),
    offset: z.string().regex(/^\d+$/).optional().transform(v => Math.max(0, parseInt(v || "0", 10))),
  });

  app.get("/api/admin/identity-audit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parseResult = identityAuditQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid query parameters", errors: parseResult.error.issues });
      }

      const { userId, category, type, limit, offset } = parseResult.data;

      let whereClauses: string[] = [];
      let params: any[] = [];

      if (userId) {
        whereClauses.push(`user_id = ?`);
        params.push(userId);
      }
      if (category) {
        whereClauses.push(`category = ?`);
        params.push(category);
      }
      if (type) {
        whereClauses.push(`type = ?`);
        params.push(type);
      }

      const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const events = await queryAll(
        `
        SELECT * FROM identity_audit ${whereClause} ORDER BY at DESC LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      const countResult = await queryOne<{ total: number }>(
        `
        SELECT COUNT(*) as total FROM identity_audit ${whereClause}
        `,
        params
      );

      res.json({
        events,
        total: countResult?.total ?? 0,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Error fetching identity audit:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/identity-audit/categories", requireAdmin, async (req: Request, res: Response) => {
    try {
      const categories = await queryAll<{ category: string }>(
        `SELECT DISTINCT category FROM identity_audit ORDER BY category`
      );
      const types = await queryAll<{ type: string }>(
        `SELECT DISTINCT type FROM identity_audit ORDER BY type`
      );

      res.json({
        categories: categories.map((c) => c.category),
        types: types.map((t) => t.type),
      });
    } catch (error) {
      console.error("Error fetching identity audit categories:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/identity-audit/user/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(getParam(req.params.userId), 10);
      if (isNaN(userId) || userId < 1) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 500);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

      const events = await queryAll(
        `
        SELECT * FROM identity_audit WHERE user_id = ? ORDER BY at DESC LIMIT ? OFFSET ?
        `,
        [userId, limit, offset]
      );

      const countResult = await queryOne<{ total: number }>(
        `
        SELECT COUNT(*) as total FROM identity_audit WHERE user_id = ?
        `,
        [userId]
      );

      res.json({
        events,
        total: countResult?.total ?? 0,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Error fetching user identity audit:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/identity-audit/verify-chain", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { sha256Hex } = await import("../services/crypto");

      const events = await queryAll<any>(`SELECT * FROM identity_audit ORDER BY id ASC`);

      let valid = true;
      let brokenAt: number | null = null;
      let prevHash: string | null = null;

      for (const event of events) {
        if (event.prev_hash !== prevHash) {
          valid = false;
          brokenAt = event.id;
          break;
        }

        const payload = {
          at: event.at,
          userId: event.user_id,
          email: event.email,
          username: event.username,
          category: event.category,
          type: event.type,
          title: event.title,
          description: event.description,
          ip: event.ip,
          userAgent: event.user_agent,
          actorAdminId: event.actor_admin_id,
          prevHash: event.prev_hash,
        };

        const expectedHash = sha256Hex(`${prevHash ?? ""}|${JSON.stringify(payload)}`);

        if (event.event_hash !== expectedHash) {
          valid = false;
          brokenAt = event.id;
          break;
        }

        prevHash = event.event_hash;
      }

      res.json({
        valid,
        totalEvents: events.length,
        brokenAt,
        message: valid ? "Hash chain is intact" : `Chain broken at event ID ${brokenAt}`,
      });
    } catch (error) {
      console.error("Error verifying identity audit chain:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ====== DAILY FX CLOSES MANAGEMENT ======

  // List daily FX closes with pagination and filtering
  app.get("/api/admin/daily-fx-closes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 500);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
      const symbolName = req.query.symbol as string | undefined;
      const tradeDate = req.query.date as string | undefined;

      let whereClause = "1=1";
      const params: any[] = [];

      if (symbolName) {
        whereClause += " AND symbol_name = ?";
        params.push(symbolName);
      }
      if (tradeDate) {
        whereClause += " AND trade_date = ?";
        params.push(tradeDate);
      }

      const closes = await queryAll(
        `
        SELECT * FROM daily_fx_closes 
        WHERE ${whereClause}
        ORDER BY trade_date DESC, symbol_name ASC
        LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      const countResult = await queryOne<{ total: number }>(
        `
        SELECT COUNT(*) as total FROM daily_fx_closes WHERE ${whereClause}
        `,
        params
      );

      res.json({
        rows: closes,
        total: countResult?.total ?? 0,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Error fetching daily FX closes:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Manually snapshot current prices as daily close
  app.post("/api/admin/daily-fx-closes/snapshot", requireAdmin, async (req: Request, res: Response) => {
    try {
      const adminUser = (req as any).user?.email || "admin";
      const { tradeDate } = req.body;

      // Get current FX rollover settings
      const sysConfig = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1)
      });
      const rolloverTz = (sysConfig as any)?.fxRolloverTz || "America/New_York";
      const rolloverTime = (sysConfig as any)?.fxRolloverTime || "17:00";

      // Use provided date or compute current date in rollover timezone
      let dateToUse = tradeDate;
      if (!dateToUse) {
        // Compute the current date in the rollover timezone
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: rolloverTz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        });
        dateToUse = formatter.format(now); // YYYY-MM-DD format
      }

      // Get all enabled symbols
      const symbols = await db.query.symbolConfigs.findMany({
        where: eq(symbolConfigs.enabled, true)
      });

      // Get latest quotes for each symbol
      const { getLatestQuoteRow } = await import("../services/quoteService");

      let inserted = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const sym of symbols) {
        try {
          const quote = await getLatestQuoteRow(sym.name);
          if (!quote || !quote.mid) {
            skipped++;
            continue;
          }

          // Check if entry already exists
          const existing = await queryOne<{ id: number }>(
            `
            SELECT id FROM daily_fx_closes WHERE symbol_id = ? AND trade_date = ?
            `,
            [sym.id, dateToUse]
          );

          if (existing) {
            // Update existing entry
            await exec(
              `
              UPDATE daily_fx_closes 
              SET close_price = ?, bid_price = ?, ask_price = ?, calculated_at = ?, created_by = ?
              WHERE symbol_id = ? AND trade_date = ?
              `,
              [quote.mid, quote.bid, quote.ask, Math.floor(Date.now() / 1000), adminUser, sym.id, dateToUse]
            );
          } else {
            // Insert new entry
            await exec(
              `
              INSERT INTO daily_fx_closes (symbol_id, symbol_name, trade_date, close_price, bid_price, ask_price, source, rollover_tz, rollover_time, created_by)
              VALUES (?, ?, ?, ?, ?, ?, '1FORGE', ?, ?, ?)
              `,
              [sym.id, sym.name, dateToUse, quote.mid, quote.bid, quote.ask, rolloverTz, rolloverTime, adminUser]
            );
          }
          inserted++;
        } catch (err: any) {
          errors.push(`${sym.name}: ${err.message}`);
        }
      }

      res.json({
        success: true,
        tradeDate: dateToUse,
        inserted,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
        message: `Captured ${inserted} close prices for ${dateToUse}`,
      });
    } catch (error) {
      console.error("Error creating daily FX close snapshot:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Delete a daily FX close entry
  app.delete("/api/admin/daily-fx-closes/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(getParam(req.params.id), 10);
      if (isNaN(id) || id < 1) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const existing = await queryOne(`SELECT * FROM daily_fx_closes WHERE id = ?`, [id]);
      if (!existing) {
        return res.status(404).json({ message: "Entry not found" });
      }

      await exec(`DELETE FROM daily_fx_closes WHERE id = ?`, [id]);

      res.json({ success: true, message: "Entry deleted" });
    } catch (error) {
      console.error("Error deleting daily FX close:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Get unique trade dates for filtering
  app.get("/api/admin/daily-fx-closes/dates", requireAdmin, async (req: Request, res: Response) => {
    try {
      const dates = await queryAll<{ trade_date: string }>(`
        SELECT DISTINCT trade_date FROM daily_fx_closes ORDER BY trade_date DESC LIMIT 100
      `);

      res.json({ dates: dates.map((d) => d.trade_date) });
    } catch (error) {
      console.error("Error fetching daily FX close dates:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}
