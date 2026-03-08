import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import type { TraderCoreDeps } from "./shared";

const VALID_MOODS = ["confident", "calm", "anxious", "frustrated", "fearful", "greedy", "neutral"];

export function registerTraderJournalRoutes(app: Express, deps: TraderCoreDeps) {
  const { ensureAuth } = deps;

  app.get("/api/journal", ensureAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 200), 500);
      const entries = await storage.getJournalEntries(req.session.userId!, limit);
      res.json(entries);
    } catch (error) {
      console.error("Get journal error:", error);
      res.status(500).json({ message: "Failed to fetch journal entries" });
    }
  });

  app.post("/api/journal", ensureAuth, async (req: Request, res: Response) => {
    try {
      const { tradeId, tradeIds, note, mood, tags, attachmentUrl } = req.body;
      const noteClean = String(note || "").trim();
      if (!noteClean || noteClean.length < 3) {
        return res.status(400).json({ message: "Note must be at least 3 characters" });
      }
      if (noteClean.length > 10000) {
        return res.status(400).json({ message: "Note too long (max 10,000 characters)" });
      }

      const moodClean = mood ? String(mood).trim().toLowerCase() : null;
      if (moodClean && !VALID_MOODS.includes(moodClean)) {
        return res.status(400).json({ message: `Invalid mood. Valid options: ${VALID_MOODS.join(", ")}` });
      }

      let validatedTradeIds: number[] | null = null;
      if (tradeIds !== undefined && tradeIds !== null && Array.isArray(tradeIds) && tradeIds.length > 0) {
        validatedTradeIds = [];
        for (const tid of tradeIds.slice(0, 20)) {
          const tradeIdNum = parseInt(tid);
          if (isNaN(tradeIdNum)) continue;
          const trade = await storage.getTradeById(tradeIdNum);
          if (trade && trade.userId === req.session.userId) {
            validatedTradeIds.push(tradeIdNum);
          }
        }
        if (validatedTradeIds.length === 0) validatedTradeIds = null;
      }

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

  app.put("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
    try {
      const entryId = Number.parseInt(String(req.params.id), 10);
      if (isNaN(entryId)) {
        return res.status(400).json({ message: "Invalid entry ID" });
      }

      const { note, mood, tags, attachmentUrl, tradeId, tradeIds } = req.body;
      const noteClean = note !== undefined ? String(note || "").trim() : undefined;
      const moodClean =
        mood !== undefined ? (mood ? String(mood).trim().toLowerCase() : null) : undefined;

      if (noteClean !== undefined) {
        if (!noteClean || noteClean.length < 3) {
          return res.status(400).json({ message: "Note must be at least 3 characters" });
        }
        if (noteClean.length > 10000) {
          return res.status(400).json({ message: "Note too long (max 10,000 characters)" });
        }
      }

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

      let validatedTradeId: number | null | undefined = undefined;
      if (validatedTradeIds === undefined && tradeId !== undefined) {
        if (tradeId === null) {
          validatedTradeId = null;
        } else {
          const parsedTradeId = parseInt(tradeId);
          if (!isNaN(parsedTradeId)) {
            const trade = await storage.getTradeById(parsedTradeId);
            if (trade && trade.userId === req.session.userId!) {
              validatedTradeId = parsedTradeId;
            }
          }
        }
      }

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

  app.delete("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
    try {
      const entryId = Number.parseInt(String(req.params.id), 10);
      if (isNaN(entryId)) {
        return res.status(400).json({ message: "Invalid entry ID" });
      }

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
