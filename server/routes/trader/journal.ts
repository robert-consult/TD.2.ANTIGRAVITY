import type { Router, NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { insertTradeSchema, systemConfig, trades, users } from "@shared/schema";
import { getPipSize, getQuoteDecimals } from "@shared/pips";
import type { AuditContext as GriftAuditContext } from "../../grift/griftTypes";
import { storage } from "../../storage";
import { riskMiddleware, getEffectiveMinHoldSec } from "../../risk";
import { requirePolicy } from "../../middleware/requirePolicy";
import { recalcAccount } from "../../recalcAccount";
import { requiredMargin } from "../../lib/margin";
import { getExecutionQuote } from "../../services/quoteService";
import { applyUserBalanceDelta, releaseUserMargin, reserveUserMargin } from "../../services/tradeAtomic";
import { realizedPnlUsd } from "../../lib/realizedPnl";
import { computeCloseSettlementCosts, computeOpenSideCosts } from "../../services/tradeCosts";
import { clearTradeExcursion, initTradeExcursion, resolveTradeExcursionForClose } from "../../trades/excursionTracking";
import { buildAuditContext, type AuditContext } from "../../lib/auditContext";
import {
  calculateSlippagePips,
  calculateSpreadPips,
  generateCorrelationId,
  generateExecutionId,
  generateOrderId,
  generatePositionId,
  writeOrderIntentAudit,
  writeTradeAudit,
} from "../../lib/auditWriter";
import { getActiveTradeConstraintsForUser } from "../../recruitment/challengesV4/challengeService";
import {
  getGlobalSettingsCached,
  getMinPriceDistancePips,
  sanitizeMinPriceDistancePips,
} from "../../services/globalSettings";
import { botGuard } from "../../security/botGuard";
import { isPostgres } from "@db/config";
import { extractGriftContext } from "../../grift/griftGeo";
import { withGriftClient } from "../../grift/griftDb";
import { maybeApplyAutoEnforcement } from "../../grift/griftAutoEnforcement";
import { onSessionActivity, onTradeSubmit } from "../../grift/griftEngine";
import {
  priceGreaterThan,
  priceGreaterThanOrEqual,
  priceLessThan,
  priceLessThanOrEqual,
  ticksToPrice,
  toTicks,
} from "../../lib/priceUtils";
import { WS_MSG_TRADES_UPDATED } from "@shared/ws/protocol";
import {
  incTradeCloseRejectedQuoteStaleTotal,
  incTradeTargetsRejectedQuoteStaleTotal,
} from "../metricsState";
import type { TraderRouterDeps } from "./types";

export function registerJournalRoutes(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
// ====== TRADER JOURNAL API ======

const VALID_MOODS = ["confident", "calm", "anxious", "frustrated", "fearful", "greedy", "neutral"];

// Get journal entries for current user
router.get("/api/journal", ensureAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 200), 500);
    const entries = await storage.getJournalEntries(req.session.userId!, limit);
    res.json(entries);
  } catch (error) {
    console.error("Get journal error:", error);
    res.status(500).json({ message: "Failed to fetch journal entries" });
  }
});

// Create a new journal entry
router.post("/api/journal", ensureAuth, async (req: Request, res: Response) => {
  try {
    const { tradeId, tradeIds, note, mood, tags, attachmentUrl } = req.body;

    // Validate note
    const noteClean = String(note || "").trim();
    if (!noteClean || noteClean.length < 3) {
      return res.status(400).json({ message: "Note must be at least 3 characters" });
    }
    if (noteClean.length > 10000) {
      return res.status(400).json({ message: "Note too long (max 10,000 characters)" });
    }

    // Validate mood if provided
    const moodClean = mood ? String(mood).trim().toLowerCase() : null;
    if (moodClean && !VALID_MOODS.includes(moodClean)) {
      return res.status(400).json({ message: `Invalid mood. Valid options: ${VALID_MOODS.join(", ")}` });
    }

    // Validate tradeIds array if provided - all must belong to user
    let validatedTradeIds: number[] | null = null;
    if (tradeIds !== undefined && tradeIds !== null && Array.isArray(tradeIds) && tradeIds.length > 0) {
      validatedTradeIds = [];
      for (const tid of tradeIds.slice(0, 20)) { // Limit to 20 trades
        const tradeIdRaw = typeof tid === "string" ? tid : String(tid);
        const tradeIdNum = parseInt(tradeIdRaw, 10);
        if (isNaN(tradeIdNum)) continue;
        const trade = await storage.getTradeById(tradeIdNum);
        if (trade && trade.userId === req.session.userId) {
          validatedTradeIds.push(tradeIdNum);
        }
      }
      if (validatedTradeIds.length === 0) validatedTradeIds = null;
    }

    // Legacy: Validate single tradeId if provided (backward compatibility)
    let validatedTradeId: number | null = null;
    if (!validatedTradeIds && tradeId !== undefined && tradeId !== null && tradeId !== "") {
      const tradeIdNum = parseInt(tradeId);
      if (!isNaN(tradeIdNum)) {
        const trade = await storage.getTradeById(tradeIdNum);
        if (trade && trade.userId === req.session.userId) {
          validatedTradeId = tradeIdNum;
        }
      }
    }

    // Validate tags - must be array of strings
    let validatedTags: string[] | null = null;
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) {
        return res.status(400).json({ message: "Tags must be an array" });
      }
      validatedTags = tags
        .filter((t: any) => typeof t === "string" && t.trim().length > 0)
        .map((t: string) => t.trim().toLowerCase().slice(0, 50))
        .slice(0, 20);
    }

    const entry = await storage.createJournalEntry({
      userId: req.session.userId!,
      tradeId: validatedTradeId,
      tradeIds: validatedTradeIds,
      note: noteClean,
      mood: moodClean,
      tags: validatedTags,
      attachmentUrl: attachmentUrl ? String(attachmentUrl).slice(0, 2000) : null,
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error("Create journal entry error:", error);
    res.status(500).json({ message: "Failed to create journal entry" });
  }
});

// Update a journal entry (only owner can update - enforced in storage layer via userId WHERE clause)
router.put("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
  try {
    const entryIdRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const entryId = parseInt(entryIdRaw, 10);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }

    const { note, mood, tags, attachmentUrl, tradeId, tradeIds } = req.body;
    const noteClean = note !== undefined ? String(note || "").trim() : undefined;
    const moodClean =
      mood !== undefined ? (mood ? String(mood).trim().toLowerCase() : null) : undefined;

    // Validate note if provided
    if (noteClean !== undefined) {
      if (!noteClean || noteClean.length < 3) {
        return res.status(400).json({ message: "Note must be at least 3 characters" });
      }
      if (noteClean.length > 10000) {
        return res.status(400).json({ message: "Note too long (max 10,000 characters)" });
      }
    }

    // Validate mood if provided
    if (moodClean !== undefined && moodClean !== null) {
      if (moodClean && !VALID_MOODS.includes(moodClean)) {
        return res.status(400).json({ message: `Invalid mood. Valid options: ${VALID_MOODS.join(", ")}` });
      }
    }

    let tradeIdsInput: unknown = tradeIds;
    if (typeof tradeIdsInput === "string") {
      const trimmed = tradeIdsInput.trim();
      if (!trimmed) {
        tradeIdsInput = [];
      } else {
        try {
          tradeIdsInput = JSON.parse(trimmed);
        } catch {
          tradeIdsInput = trimmed.split(",").map((v) => v.trim()).filter(Boolean);
        }
      }
    }

    let tagsInput: unknown = tags;
    if (typeof tagsInput === "string") {
      const trimmed = tagsInput.trim();
      if (!trimmed) {
        tagsInput = [];
      } else {
        try {
          tagsInput = JSON.parse(trimmed);
        } catch {
          tagsInput = trimmed.split(",").map((v) => v.trim()).filter(Boolean);
        }
      }
    }

    // Validate tradeIds array if provided - all must belong to user
    let validatedTradeIds: number[] | null | undefined = undefined;
    if (tradeIdsInput !== undefined) {
      if (tradeIdsInput === null || (Array.isArray(tradeIdsInput) && tradeIdsInput.length === 0)) {
        validatedTradeIds = null;
      } else if (Array.isArray(tradeIdsInput)) {
        validatedTradeIds = [];
        for (const tid of tradeIdsInput.slice(0, 20)) {
          const tradeIdNum = parseInt(tid);
          if (isNaN(tradeIdNum)) continue;
          const trade = await storage.getTradeById(tradeIdNum);
          if (trade && trade.userId === req.session.userId) {
            validatedTradeIds.push(tradeIdNum);
          }
        }
        if (validatedTradeIds.length === 0) validatedTradeIds = null;
      }
    }

    // Legacy: Validate single tradeId if provided (backward compatibility)
    let validatedTradeId: number | null | undefined = undefined;
    if (validatedTradeIds === undefined && tradeId !== undefined) {
      if (tradeId === null) {
        validatedTradeId = null;
      } else {
        const parsedTradeId = parseInt(Array.isArray(tradeId) ? tradeId[0] : String(tradeId), 10);
        if (!isNaN(parsedTradeId)) {
          const trade = await storage.getTradeById(parsedTradeId);
          if (trade && trade.userId === req.session.userId!) {
            validatedTradeId = parsedTradeId;
          }
        }
      }
    }

    // Validate tags if provided
    let validatedTags: string[] | undefined = undefined;
    if (tagsInput !== undefined) {
      if (tagsInput === null) {
        validatedTags = [];
      } else if (!Array.isArray(tagsInput)) {
        return res.status(400).json({ message: "Tags must be an array" });
      } else {
        validatedTags = tagsInput
          .filter((t: any) => typeof t === "string" && t.trim().length > 0)
          .map((t: string) => t.trim().toLowerCase().slice(0, 50))
          .slice(0, 20);
      }
    }

    // Storage layer ensures only entries belonging to req.session.userId can be updated
    const updated = await storage.updateJournalEntry(entryId, req.session.userId!, {
      note: noteClean,
      mood: moodClean,
      tags: validatedTags,
      attachmentUrl: attachmentUrl !== undefined ? (attachmentUrl ? String(attachmentUrl).slice(0, 2000) : null) : undefined,
      tradeId: validatedTradeId,
      tradeIds: validatedTradeIds,
    });

    if (!updated) {
      return res.status(404).json({ message: "Entry not found or access denied" });
    }

    res.json(updated);
  } catch (error) {
    const body = req.body ?? {};
    console.error("Update journal entry error:", {
      entryId: req.params.id,
      userId: req.session.userId ?? null,
      bodyKeys: Object.keys(body),
      noteLen: typeof body.note === "string" ? body.note.trim().length : null,
      tagsType: Array.isArray(body.tags) ? "array" : body.tags === null ? "null" : typeof body.tags,
      tradeIdsType: Array.isArray(body.tradeIds) ? "array" : body.tradeIds === null ? "null" : typeof body.tradeIds,
      error,
    });
    const message = "Failed to update journal entry";
    const detail =
      process.env.NODE_ENV !== "production"
        ? (error instanceof Error ? error.message : String(error))
        : undefined;
    res.status(500).json(detail ? { message, detail } : { message });
  }
});

// Delete a journal entry (only owner can delete - enforced in storage layer via userId WHERE clause)
router.delete("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
  try {
    const entryIdRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const entryId = parseInt(entryIdRaw, 10);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }

    // Storage layer ensures only entries belonging to req.session.userId can be deleted
    const deleted = await storage.deleteJournalEntry(entryId, req.session.userId!);

    if (!deleted) {
      return res.status(404).json({ message: "Entry not found or access denied" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete journal entry error:", error);
    res.status(500).json({ message: "Failed to delete journal entry" });
  }
});
}
