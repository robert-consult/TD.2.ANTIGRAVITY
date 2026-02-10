// @ts-nocheck
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import { challengeEnrollments, challenges, systemConfig, traderProfiles } from "@shared/schema";
import { requireAuth } from "../middleware/auth";

const traderTalentRouter = Router();
traderTalentRouter.use(requireAuth);

const profileUpdateSchema = z.object({
  bio: z.string().trim().max(4000).optional().nullable(),
  strategy: z.string().trim().max(4000).optional().nullable(),
  pinnedTradeIds: z.array(z.number().int().positive()).max(50).optional(),
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parsePinnedTradeIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);
    } catch {
      return [];
    }
  }

  return [];
}

async function getRecruitmentConfig() {
  const [cfg] = await db
    .select({
      traderProProfilesEnabled: systemConfig.traderProProfilesEnabled,
      traderCompeteEnabled: systemConfig.traderCompeteEnabled,
      traderCommunityEnabled: systemConfig.traderCommunityEnabled,
      leaderboardMode: systemConfig.leaderboardMode,
    })
    .from(systemConfig)
    .where(eq(systemConfig.id, 1))
    .limit(1);

  return {
    traderProProfilesEnabled: Boolean(cfg?.traderProProfilesEnabled ?? false),
    traderCompeteEnabled: Boolean(cfg?.traderCompeteEnabled ?? false),
    traderCommunityEnabled: Boolean(cfg?.traderCommunityEnabled ?? false),
    leaderboardMode: ["PUBLIC", "TOP_10", "DISABLED"].includes(String(cfg?.leaderboardMode || ""))
      ? String(cfg?.leaderboardMode)
      : "PUBLIC",
  };
}

traderTalentRouter.get("/leaderboard-mode", async (_req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    return res.json({ ok: true, ...cfg });
  } catch (error) {
    console.error("[trader-talent] leaderboard-mode error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_LEADERBOARD_MODE" });
  }
});

traderTalentRouter.get("/profile", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderProProfilesEnabled) {
      return res.status(403).json({ message: "TRADER_PROFILES_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const [profile] = await db
      .select()
      .from(traderProfiles)
      .where(eq(traderProfiles.userId, userId))
      .limit(1);

    const row = profile ?? {
      userId,
      bio: null,
      strategy: null,
      pinnedTradeIds: "[]",
      updatedAt: null,
    };

    return res.json({
      ok: true,
      row: {
        userId,
        bio: row.bio ?? null,
        strategy: row.strategy ?? null,
        pinnedTradeIds: parsePinnedTradeIds(row.pinnedTradeIds),
        updatedAt: row.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("[trader-talent] profile get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PROFILE" });
  }
});

traderTalentRouter.put("/profile", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderProProfilesEnabled) {
      return res.status(403).json({ message: "TRADER_PROFILES_DISABLED" });
    }

    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const userId = Number(req.session?.userId || 0);
    const ts = nowSec();
    const pinnedTradeIds =
      parsed.data.pinnedTradeIds === undefined ? undefined : JSON.stringify(parsePinnedTradeIds(parsed.data.pinnedTradeIds));

    await db
      .insert(traderProfiles)
      .values({
        userId,
        bio: parsed.data.bio ?? null,
        strategy: parsed.data.strategy ?? null,
        pinnedTradeIds: pinnedTradeIds ?? "[]",
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: traderProfiles.userId,
        set: {
          bio: parsed.data.bio,
          strategy: parsed.data.strategy,
          pinnedTradeIds,
          updatedAt: ts,
        },
      });

    const [updated] = await db
      .select()
      .from(traderProfiles)
      .where(eq(traderProfiles.userId, userId))
      .limit(1);

    return res.json({
      ok: true,
      row: {
        userId,
        bio: updated?.bio ?? null,
        strategy: updated?.strategy ?? null,
        pinnedTradeIds: parsePinnedTradeIds(updated?.pinnedTradeIds),
        updatedAt: updated?.updatedAt ?? ts,
      },
    });
  } catch (error) {
    console.error("[trader-talent] profile update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PROFILE" });
  }
});

traderTalentRouter.get("/challenges", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const ts = nowSec();

    const rows = await db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.description,
        c.profit_target_pct,
        c.max_daily_loss_pct,
        c.max_total_loss_pct,
        c.min_trading_days,
        c.duration_days,
        c.start_at,
        c.end_at,
        c.is_active,
        c.created_at,
        c.updated_at,
        e.id AS enrollment_id,
        e.status AS enrollment_status,
        e.enrolled_at,
        e.completed_at,
        e.current_pnl_pct,
        e.max_daily_loss_hit,
        e.trading_days
      FROM challenges c
      LEFT JOIN challenge_enrollments e
        ON e.challenge_id = c.id
       AND e.user_id = ${userId}
      WHERE c.is_active = true
        AND (c.start_at IS NULL OR c.start_at <= ${ts})
        AND (c.end_at IS NULL OR c.end_at >= ${ts})
      ORDER BY c.start_at NULLS FIRST, c.created_at DESC, c.id DESC
    `);

    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[trader-talent] challenges list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGES" });
  }
});

traderTalentRouter.post("/challenges/:id/enroll", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const ts = nowSec();
    const [challenge] = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challenge || !challenge.isActive) {
      return res.status(404).json({ message: "CHALLENGE_NOT_ACTIVE" });
    }

    if (challenge.startAt != null && challenge.startAt > ts) {
      return res.status(409).json({ message: "CHALLENGE_NOT_STARTED" });
    }
    if (challenge.endAt != null && challenge.endAt < ts) {
      return res.status(409).json({ message: "CHALLENGE_EXPIRED" });
    }

    const [existing] = await db
      .select()
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(challengeEnrollments)
        .values({
          challengeId,
          userId,
          status: "ACTIVE",
          enrolledAt: ts,
          completedAt: null,
          currentPnlPct: 0,
          maxDailyLossHit: null,
          tradingDays: 0,
          updatedAt: ts,
        })
        .returning();
      return res.status(201).json({ ok: true, row: created });
    }

    if (String(existing.status) === "ACTIVE") {
      return res.status(409).json({ message: "ALREADY_ENROLLED" });
    }

    const [reactivated] = await db
      .update(challengeEnrollments)
      .set({
        status: "ACTIVE",
        enrolledAt: ts,
        completedAt: null,
        currentPnlPct: 0,
        maxDailyLossHit: null,
        tradingDays: 0,
        updatedAt: ts,
      })
      .where(eq(challengeEnrollments.id, existing.id))
      .returning();

    return res.json({ ok: true, row: reactivated });
  } catch (error) {
    console.error("[trader-talent] challenge enroll error:", error);
    return res.status(500).json({ message: "FAILED_TO_ENROLL_CHALLENGE" });
  }
});

traderTalentRouter.post("/challenges/:id/withdraw", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [updated] = await db
      .update(challengeEnrollments)
      .set({
        status: "WITHDRAWN",
        completedAt: nowSec(),
        updatedAt: nowSec(),
      })
      .where(
        and(
          eq(challengeEnrollments.challengeId, challengeId),
          eq(challengeEnrollments.userId, userId),
          eq(challengeEnrollments.status, "ACTIVE"),
        ),
      )
      .returning();

    if (!updated) {
      return res.status(404).json({ message: "ACTIVE_ENROLLMENT_NOT_FOUND" });
    }

    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[trader-talent] challenge withdraw error:", error);
    return res.status(500).json({ message: "FAILED_TO_WITHDRAW_CHALLENGE" });
  }
});

traderTalentRouter.get("/challenges/:id/status", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [challengeRow] = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!challengeRow) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const [enrollment] = await db
      .select()
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .limit(1);

    if (!enrollment) {
      return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      challenge: challengeRow,
      enrollment,
    });
  } catch (error) {
    console.error("[trader-talent] challenge status error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_STATUS" });
  }
});

export { traderTalentRouter };
