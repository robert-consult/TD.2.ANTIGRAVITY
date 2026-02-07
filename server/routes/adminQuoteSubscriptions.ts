import { Router } from "express";
import { db } from "@db";
import { symbolConfigs, users } from "@shared/schema";
import {
  quoteModeSchema,
  quoteSubscriptionsBulkModeSchema,
  quoteSubscriptionsConfigSchema,
  quoteSubscriptionsSetSymbolsSchema,
} from "@shared/quoteSubscriptions";
import { asc, desc, eq, ilike, or } from "drizzle-orm";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  clearUserQuoteModeOverride,
  getQuoteSubscriptionsConfig,
  getTraderSubscriptionSummaryRows,
  getUserQuoteModeSummary,
  getUserQuoteSubscriptions,
  setUserQuoteMode,
  setUserQuoteSubscriptionsBySymbolIds,
  setUsersQuoteMode,
  upsertQuoteSubscriptionsConfig,
} from "../services/quoteSubscriptions";

export const adminQuoteSubscriptionsRouter = Router();
adminQuoteSubscriptionsRouter.use(requireAdmin);

function parsePositiveInt(value: unknown, fallback: number, max = 200): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

function parseOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

adminQuoteSubscriptionsRouter.get("/config", async (_req, res) => {
  try {
    const config = await getQuoteSubscriptionsConfig();
    return res.json(config);
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed to load config", error);
    return res.status(500).json({ message: "Failed to load quote subscription config" });
  }
});

adminQuoteSubscriptionsRouter.put("/config", async (req, res) => {
  try {
    const parsed = quoteSubscriptionsConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid payload",
        issues: parsed.error.flatten(),
      });
    }

    await upsertQuoteSubscriptionsConfig({
      globalEnabled: parsed.data.globalEnabled,
      defaultMode: parsed.data.defaultMode,
      updatedBy: req.session?.email ?? null,
    });

    const config = await getQuoteSubscriptionsConfig();
    return res.json({ ok: true, config });
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed to save config", error);
    return res.status(500).json({ message: "Failed to update quote subscription config" });
  }
});

adminQuoteSubscriptionsRouter.get("/traders", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = parsePositiveInt(req.query.limit, 50, 200);
    const offset = parseOffset(req.query.offset);
    const includeAdmins = String(req.query.includeAdmins ?? "false").toLowerCase() === "true";

    const payload = await getTraderSubscriptionSummaryRows({
      q,
      limit,
      offset,
      includeAdmins,
    });

    return res.json(payload);
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed to list traders", error);
    return res.status(500).json({ message: "Failed to load traders" });
  }
});

adminQuoteSubscriptionsRouter.put("/traders/mode", async (req, res) => {
  try {
    const parsed = quoteSubscriptionsBulkModeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid payload",
        issues: parsed.error.flatten(),
      });
    }

    await setUsersQuoteMode(parsed.data.userIds, parsed.data.mode);
    return res.json({ ok: true, updated: parsed.data.userIds.length, mode: parsed.data.mode });
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed bulk mode update", error);
    return res.status(500).json({ message: "Failed to update trader quote modes" });
  }
});

adminQuoteSubscriptionsRouter.get("/traders/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid userId" });
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        email: true,
        username: true,
        name: true,
        isAdmin: true,
        isDeleted: true,
      },
    });

    if (!user || user.isDeleted) {
      return res.status(404).json({ message: "User not found" });
    }

    const [modeSummary, subscriptions] = await Promise.all([
      getUserQuoteModeSummary(userId),
      getUserQuoteSubscriptions(userId),
    ]);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        isAdmin: user.isAdmin,
      },
      ...modeSummary,
      subscriptions,
    });
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed to load trader detail", error);
    return res.status(500).json({ message: "Failed to load trader quote subscription detail" });
  }
});

adminQuoteSubscriptionsRouter.put("/traders/:userId/mode", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid userId" });
  }

  try {
    const modeRaw = (req.body ?? {}).mode;
    if (modeRaw === null) {
      await clearUserQuoteModeOverride(userId);
      const summary = await getUserQuoteModeSummary(userId);
      return res.json({ ok: true, ...summary });
    }

    const parsedMode = quoteModeSchema.safeParse(modeRaw);
    if (!parsedMode.success) {
      return res.status(400).json({ message: "Invalid mode", issues: parsedMode.error.flatten() });
    }

    await setUserQuoteMode(userId, parsedMode.data);
    const summary = await getUserQuoteModeSummary(userId);
    return res.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed to update trader mode", error);
    return res.status(500).json({ message: "Failed to update trader quote mode" });
  }
});

adminQuoteSubscriptionsRouter.put("/traders/:userId/subscriptions", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid userId" });
  }

  try {
    const parsed = quoteSubscriptionsSetSymbolsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid payload",
        issues: parsed.error.flatten(),
      });
    }

    await setUserQuoteSubscriptionsBySymbolIds(userId, parsed.data.symbolIds);
    const subscriptions = await getUserQuoteSubscriptions(userId);
    return res.json({ ok: true, subscriptions });
  } catch (error: any) {
    const message = String(error?.message ?? "Failed to update subscriptions");
    if (message.startsWith("Unknown symbol IDs")) {
      return res.status(400).json({ message });
    }
    console.error("[admin-quote-subscriptions] failed to update trader subscriptions", error);
    return res.status(500).json({ message: "Failed to update trader quote subscriptions" });
  }
});

adminQuoteSubscriptionsRouter.get("/symbols", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const limit = parsePositiveInt(req.query.limit, 50, 200);
    const where = q
      ? or(
          ilike(symbolConfigs.symbol, `%${q}%`),
          ilike(symbolConfigs.name, `%${q}%`),
          ilike(symbolConfigs.category, `%${q}%`),
        )
      : undefined;

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

    return res.json({
      rows: rows.map((row) => ({ ...row, symbol: String(row.symbol).toUpperCase() })),
      limit,
      q,
    });
  } catch (error) {
    console.error("[admin-quote-subscriptions] failed to search symbols", error);
    return res.status(500).json({ message: "Failed to search symbols" });
  }
});
