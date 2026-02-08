import { Router } from "express";
import { db } from "@db";
import { symbolConfigs } from "@shared/schema";
import { quoteSubscriptionsSetSymbolsSchema } from "@shared/quoteSubscriptions";
import { and, asc, desc, ilike, notInArray, or } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import {
  canUserManageQuoteSubscriptions,
  getAllowedSymbolConfigsForUser,
  getQuoteSubscriptionsConfig,
  getUserQuoteModeSummary,
  getUserQuoteSubscriptions,
  setUserQuoteSubscriptionsBySymbolIds,
} from "../services/quoteSubscriptions";
import { filterAvailableRowsByAllowedIds, parseBooleanQueryParam } from "./quoteSubscriptions.utils";

export const quoteSubscriptionsRouter = Router();
quoteSubscriptionsRouter.use(requireAuth);

function parsePositiveInt(value: unknown, fallback: number, max = 200): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

quoteSubscriptionsRouter.get("/me", async (req, res) => {
  const userId = Number(req.session.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const [config, modeSummary, subscriptions] = await Promise.all([
      getQuoteSubscriptionsConfig(),
      getUserQuoteModeSummary(userId),
      getUserQuoteSubscriptions(userId),
    ]);

    return res.json({
      userId,
      config,
      ...modeSummary,
      subscriptions,
    });
  } catch (error) {
    console.error("[quote-subscriptions] failed to load /me", error);
    return res.status(500).json({ message: "Failed to load quote subscription settings" });
  }
});

quoteSubscriptionsRouter.get("/allowed-symbols", async (req, res) => {
  const userId = Number(req.session.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const [modeSummary, symbols] = await Promise.all([
      getUserQuoteModeSummary(userId),
      getAllowedSymbolConfigsForUser(userId),
    ]);

    return res.json({
      ...modeSummary,
      symbols,
    });
  } catch (error) {
    console.error("[quote-subscriptions] failed to load allowed symbols", error);
    return res.status(500).json({ message: "Failed to load allowed quote symbols" });
  }
});

quoteSubscriptionsRouter.get("/me/subscriptions", async (req, res) => {
  const userId = Number(req.session.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const subscriptions = await getUserQuoteSubscriptions(userId);
    return res.json({ subscriptions });
  } catch (error) {
    console.error("[quote-subscriptions] failed to load subscriptions", error);
    return res.status(500).json({ message: "Failed to load subscriptions" });
  }
});

quoteSubscriptionsRouter.get("/available-symbols", async (req, res) => {
  const userId = Number(req.session.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const canManage = await canUserManageQuoteSubscriptions(userId);
    if (!canManage) {
      return res.status(403).json({ message: "Quote customization is not enabled for this account" });
    }

    const q = String(req.query.q ?? "").trim();
    const limit = parsePositiveInt(req.query.limit, 100, 200);
    const excludeAllowed = parseBooleanQueryParam(req.query.excludeAllowed, false);

    const searchWhere = q
      ? or(
          ilike(symbolConfigs.symbol, `%${q}%`),
          ilike(symbolConfigs.name, `%${q}%`),
          ilike(symbolConfigs.category, `%${q}%`),
        )
      : undefined;

    const [subscriptions, allowedRows] = await Promise.all([
      getUserQuoteSubscriptions(userId),
      excludeAllowed ? getAllowedSymbolConfigsForUser(userId) : Promise.resolve([]),
    ]);

    const allowedIds = new Set<number>(allowedRows.map((row) => row.id));
    const exclusionWhere =
      excludeAllowed && allowedIds.size > 0 ? notInArray(symbolConfigs.id, Array.from(allowedIds.values())) : undefined;
    const where = searchWhere && exclusionWhere ? and(searchWhere, exclusionWhere) : searchWhere ?? exclusionWhere;

    const rows = await db
      .select({
        id: symbolConfigs.id,
        symbol: symbolConfigs.symbol,
        name: symbolConfigs.name,
        category: symbolConfigs.category,
        enabled: symbolConfigs.enabled,
      })
      .from(symbolConfigs)
      .where(where)
      .orderBy(desc(symbolConfigs.enabled), asc(symbolConfigs.symbol))
      .limit(limit);

    const filteredRows = filterAvailableRowsByAllowedIds(rows, allowedIds, excludeAllowed);
    const subscribedIds = new Set(subscriptions.map((s) => s.id));

    return res.json({
      q,
      limit,
      excludeAllowed,
      rows: filteredRows.map((row) => ({
        ...row,
        symbol: String(row.symbol).toUpperCase(),
        isSubscribed: subscribedIds.has(row.id),
      })),
    });
  } catch (error) {
    console.error("[quote-subscriptions] failed to load available symbols", error);
    return res.status(500).json({ message: "Failed to load available symbols" });
  }
});

quoteSubscriptionsRouter.put("/me/subscriptions", async (req, res) => {
  const userId = Number(req.session.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const canManage = await canUserManageQuoteSubscriptions(userId);
    if (!canManage) {
      return res.status(403).json({ message: "Quote customization is not enabled for this account" });
    }

    const parsed = quoteSubscriptionsSetSymbolsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", issues: parsed.error.flatten() });
    }

    await setUserQuoteSubscriptionsBySymbolIds(userId, parsed.data.symbolIds);

    const [subscriptions, allowed] = await Promise.all([
      getUserQuoteSubscriptions(userId),
      getAllowedSymbolConfigsForUser(userId),
    ]);

    return res.json({ ok: true, subscriptions, allowedSymbols: allowed });
  } catch (error: any) {
    const message = String(error?.message ?? "Failed to update subscriptions");
    if (message.startsWith("Unknown symbol IDs")) {
      return res.status(400).json({ message });
    }
    console.error("[quote-subscriptions] failed to update self subscriptions", error);
    return res.status(500).json({ message: "Failed to update quote subscriptions" });
  }
});
