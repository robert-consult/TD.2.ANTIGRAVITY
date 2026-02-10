// @ts-nocheck
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, dbClient } from "@db";
import {
  challengeEnrollments,
  challenges,
  partnerAllocations,
  partnerInvites,
  partnerInquiries,
  partners,
  recruitingPipeline,
  scoutMetricsSnapshot,
  scoutWatchlists,
  systemConfig,
  users,
} from "@shared/schema";
import { requireAdmin } from "../middleware/requireAdmin";
import { appendIdentityAudit } from "../services/identityAudit";
import { buildAuditContext } from "../lib/auditContext";
import { randomToken, sha256Hex } from "../services/crypto";
import {
  PIPELINE_STAGES,
  ensurePipelineRowForUser,
  parseOptionalPipelineStage,
  updateRecruitingPipelineForUser,
} from "../recruitment/pipelineService";
import { listAdminScoutCandidates } from "../scout/scoutService";
import {
  getPartnerInquiryRoutingConfig,
  resolvePartnerInquiryRouting,
  upsertPartnerInquiryRoutingConfig,
} from "../partner/inquiryRouting";
import { getCommunicationSettings } from "../services/messaging";
import {
  DEFAULT_PARTNER_GATING_CONFIG,
  normalizePartnerGatingConfig,
  normalizePartnerGatingOverrides,
} from "../partner/onboarding";

const LEADERBOARD_MODES = ["PUBLIC", "TOP_10", "DISABLED"] as const;
const PARTNER_GATE_LEVELS = ["INVITED", "IDENTITY", "COMPLIANT", "ADMIN_APPROVED"] as const;
const PARTNER_INVITE_EMAIL_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "OPENED",
  "FAILED",
  "SKIPPED",
] as const;

const pipelineStageSchema = z.enum(PIPELINE_STAGES);
const leaderboardModeSchema = z.enum(LEADERBOARD_MODES);
const partnerGateLevelSchema = z.enum(PARTNER_GATE_LEVELS);

const watchlistInputSchema = z.object({
  userId: z.number().int().positive(),
  tier: z.enum(["A_LIST", "B_LIST", "INCUBATOR"]).optional(),
  notes: z.string().trim().max(3000).optional().nullable(),
});

const pipelineUpdateSchema = z.object({
  stage: pipelineStageSchema.optional(),
  assignedAdminId: z.number().int().positive().optional().nullable(),
  lastContactedAt: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  isPartnerVisible: z.boolean().optional(),
});

const scoutConfigPatchSchema = z.object({
  scoutTabEnabled: z.boolean().optional(),
  partnerPortalEnabled: z.boolean().optional(),
  traderProProfilesEnabled: z.boolean().optional(),
  traderCompeteEnabled: z.boolean().optional(),
  traderCommunityEnabled: z.boolean().optional(),
  partnerAllocationsEnabled: z.boolean().optional(),
  leaderboardMode: leaderboardModeSchema.optional(),
  scoutMinSharpeAlert: z.coerce.number().min(-100).max(100).optional(),
  partnerGatingConfig: z
    .object({
      viewDataRoom: partnerGateLevelSchema,
      runSimulations: partnerGateLevelSchema,
      requestAllocation: partnerGateLevelSchema,
      directContact: partnerGateLevelSchema,
    })
    .optional(),
  partnerPasswordRotationDays: z.coerce.number().int().min(7).max(365).optional(),
  partnerPasswordReminderLogins: z.coerce.number().int().min(1).max(20).optional(),
  partnerInviteDefaultExpiryDays: z.coerce.number().int().min(1).max(180).optional(),
});

const challengeUpsertSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000).optional().nullable(),
  profitTargetPct: z.number().min(0).max(10),
  maxDailyLossPct: z.number().min(0).max(10),
  maxTotalLossPct: z.number().min(0).max(10).optional().nullable(),
  minTradingDays: z.number().int().min(0).max(365).optional().nullable(),
  durationDays: z.number().int().min(1).max(365),
  startAt: z.number().int().nonnegative().optional().nullable(),
  endAt: z.number().int().nonnegative().optional().nullable(),
  isActive: z.boolean().optional(),
});

const partnerCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  ipWhitelist: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
});

const partnerPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  ipWhitelist: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
  rotateKey: z.boolean().optional(),
});

const inquiryRoutingPatchSchema = z
  .object({
    inboxAlias: z.string().trim().min(1).max(160).optional(),
    routeAdminEmails: z.array(z.string().trim().email().max(254)).max(200).optional(),
    viewerAdminEmails: z.array(z.string().trim().email().max(254)).max(200).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one inquiry routing field is required",
    path: [],
  });

const partnerInviteSchema = z.object({
  email: z.string().trim().email().max(254),
  fundName: z.string().trim().min(2).max(120).optional().nullable(),
  adminNotes: z.string().trim().max(5000).optional().nullable(),
  expiresInDays: z.coerce.number().int().min(1).max(180).optional(),
  autoActivate: z.boolean().optional(),
});

const partnerApproveSchema = z.object({
  action: z.enum(["APPROVE", "HOLD", "REVOKE"]),
  adminNotes: z.string().trim().max(5000).optional().nullable(),
});

const partnerGatingOverrideSchema = z
  .object({
    viewDataRoom: partnerGateLevelSchema.optional(),
    runSimulations: partnerGateLevelSchema.optional(),
    requestAllocation: partnerGateLevelSchema.optional(),
    directContact: partnerGateLevelSchema.optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one override field is required",
    path: [],
  });

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function parseOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function parseOptionalFloat(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseOptionalStage(raw: unknown): (typeof PIPELINE_STAGES)[number] | null {
  return parseOptionalPipelineStage(raw);
}

function netProfitSqlAlias(alias: string): string {
  return `COALESCE(
    ${alias}.net_profit_usd::numeric,
    CASE
      WHEN ${alias}.profit IS NULL OR btrim(${alias}.profit) = '' THEN 0::numeric
      WHEN ${alias}.profit ~ '^-?\\d+(\\.\\d+)?$' THEN ${alias}.profit::numeric
      ELSE 0::numeric
    END
  )`;
}

async function appendRecruitmentAudit(req: any, type: string, data: Record<string, unknown>) {
  try {
    const auditCtx = buildAuditContext(req);
    appendIdentityAudit({
      userId: auditCtx.actorUserId,
      category: "RECRUITMENT",
      type,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent,
      data,
    });
  } catch (error) {
    console.error("[admin-scout] audit append failed:", error);
  }
}

function computeMaxDrawdownFromEquitySeries(equitySeries: number[]): number {
  if (!equitySeries.length) return 0;
  let peak = equitySeries[0];
  let maxDd = 0;
  for (const value of equitySeries) {
    if (!Number.isFinite(value)) continue;
    if (value > peak) peak = value;
    if (peak <= 0) continue;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(6));
}

async function getTraderUser(userId: number): Promise<{ id: number; isAdmin: boolean; isDeleted: boolean } | null> {
  const [row] = await db
    .select({ id: users.id, isAdmin: users.isAdmin, isDeleted: users.isDeleted })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

function sanitizePartnerIpWhitelist(raw: string | undefined): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  return input
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50)
    .join(",");
}

function normalizeEmailArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const email = String(value || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 200) break;
  }
  return out;
}

function buildPartnerApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `tp_${randomToken(24)}`;
  const hash = sha256Hex(raw);
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

function normalizePartnerEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function buildPartnerUsername(email: string): string {
  const local = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  const suffix = randomToken(4).slice(0, 6).toLowerCase();
  const prefix = local || "partner";
  return `${prefix}_${suffix}`;
}

function buildPartnerTempPassword(): string {
  return `TQ!${randomToken(8)}aA1`;
}

function buildPartnerInviteDeepLink(opts: { username: string; token: string }): string {
  const portalBase =
    String(process.env.PARTNER_PORTAL_BASE_URL || process.env.APP_BASE_URL || "http://localhost:5000").trim() ||
    "http://localhost:5000";
  const safeBase = portalBase.replace(/\/+$/, "");
  const u = encodeURIComponent(opts.username);
  const t = encodeURIComponent(opts.token);
  return `${safeBase}/partner?u=${u}&t=${t}`;
}

async function sendPartnerInviteEmail(input: {
  to: string;
  username: string;
  tempPassword: string;
  apiKey: string;
  deepLink: string;
  expiresInDays: number;
}): Promise<{ status: (typeof PARTNER_INVITE_EMAIL_STATUSES)[number]; messageId?: string; detail?: string }> {
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!resendApiKey) {
    return {
      status: "SKIPPED",
      detail: "RESEND_API_KEY_NOT_CONFIGURED",
    };
  }

  const from = String(process.env.RESEND_FROM || "TradeQuip <noreply@tradequip.com>").trim();
  const subject = "Access Granted: TradeQuip Institutional Portal";
  const textBody = [
    "Hello,",
    "",
    "You have been invited to view our curated pool of top-performing traders.",
    "",
    "YOUR CREDENTIALS:",
    `  Username: ${input.username}`,
    `  Password: ${input.tempPassword}`,
    `  API Key:  ${input.apiKey}`,
    "",
    `Access Portal: ${input.deepLink}`,
    "",
    `This link expires in ${input.expiresInDays} day(s).`,
    "",
    "Best regards,",
    "The TradeQuip Team",
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.4;color:#111">
      <p>Hello,</p>
      <p>You have been invited to view our curated pool of top-performing traders.</p>
      <p><strong>YOUR CREDENTIALS</strong><br/>
      Username: <code>${input.username}</code><br/>
      Password: <code>${input.tempPassword}</code><br/>
      API Key: <code>${input.apiKey}</code></p>
      <p><a href="${input.deepLink}">Access Portal Now</a></p>
      <p>This link expires in ${input.expiresInDays} day(s).</p>
      <p>Best regards,<br/>The TradeQuip Team</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "FAILED",
        detail: String(payload?.message || payload?.error || `RESEND_HTTP_${response.status}`),
      };
    }

    return {
      status: "SENT",
      messageId: String(payload?.id || ""),
      detail: String(payload?.id ? "RESEND_ACCEPTED" : "RESEND_ACCEPTED_NO_ID"),
    };
  } catch (error: any) {
    return {
      status: "FAILED",
      detail: String(error?.message || "RESEND_REQUEST_FAILED"),
    };
  }
}

type RateLimitEntry = { count: number; resetAtMs: number };
const partnerInviteRateByAdmin = new Map<number, RateLimitEntry>();
const partnerInviteRateByIp = new Map<string, RateLimitEntry>();
const PARTNER_INVITE_ADMIN_LIMIT = 5;
const PARTNER_INVITE_IP_LIMIT = 20;
const PARTNER_INVITE_WINDOW_MS = 60 * 60 * 1000;

function cleanupRateLimitMap<K>(store: Map<K, RateLimitEntry>) {
  const now = Date.now();
  for (const [key, value] of Array.from(store.entries())) {
    if (value.resetAtMs <= now) store.delete(key);
  }
}

function consumeRateLimit<K>(
  store: Map<K, RateLimitEntry>,
  key: K,
  limit: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAtMs <= now) {
    store.set(key, { count: 1, resetAtMs: now + PARTNER_INVITE_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

const partnerInviteLimiterCleanupHandle = setInterval(() => {
  cleanupRateLimitMap(partnerInviteRateByAdmin);
  cleanupRateLimitMap(partnerInviteRateByIp);
}, 5 * 60 * 1000);
(partnerInviteLimiterCleanupHandle as any)?.unref?.();

export const adminScoutRouter = Router();
adminScoutRouter.use(requireAdmin);
adminScoutRouter.use(async (req, res, next) => {
  try {
    // Keep config endpoint reachable so admins can re-enable the feature.
    if (req.path === "/config") return next();

    const [cfg] = await db
      .select({ scoutTabEnabled: systemConfig.scoutTabEnabled })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    if (cfg?.scoutTabEnabled === false) {
      return res.status(403).json({ message: "SCOUT_TAB_DISABLED" });
    }
    return next();
  } catch (error) {
    console.error("[admin-scout] scout enabled check failed:", error);
    return res.status(500).json({ message: "SCOUT_TAB_GATING_FAILED" });
  }
});

adminScoutRouter.get("/candidates", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const qRaw = safeString(req.query.q).trim();
    const q = qRaw ? `%${qRaw.slice(0, 200)}%` : null;
    const stage = parseOptionalStage(req.query.stage);
    if (safeString(req.query.stage).trim() && !stage) {
      return res.status(400).json({ message: "INVALID_STAGE" });
    }

    const minSharpe = parseOptionalFloat(req.query.minSharpe);
    const minScore = parseOptionalFloat(req.query.minScore);
    const days = parsePositiveInt(req.query.days, 90, 365);
    const cutoffSec = nowSec() - days * 86400;

    const limit = parsePositiveInt(req.query.limit, 25, 200);
    const offset = parseOffset(req.query.offset);

    const out = await listAdminScoutCandidates({
      adminId,
      q,
      stage,
      minSharpe,
      minScore,
      limit,
      offset,
      cutoffSec,
    });

    return res.json({
      ok: true,
      limit,
      offset,
      total: out.total,
      hasMore: out.hasMore,
      results: out.rows,
    });
  } catch (error) {
    console.error("[admin-scout] candidates error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CANDIDATES" });
  }
});

adminScoutRouter.get("/candidates/:userId", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "INVALID_USER_ID" });
    }

    const user = await getTraderUser(userId);
    if (!user || user.isAdmin || user.isDeleted) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    await ensurePipelineRowForUser(userId);

    const netProfitSql = netProfitSqlAlias("t");
    const days = parsePositiveInt(req.query.days, 180, 730);
    const cutoffSec = nowSec() - days * 86400;

    const userRes = await dbClient.query(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.name,
          u.user_tier,
          u.kyc_status,
          u.created_at,
          u.country_iso2,
          u.region_key,
          COALESCE(u.starting_equity, 1000000)::float8 AS starting_equity,
          uv.email_verified_at,
          uv.sms_verified_at,
          uv.contender_tier,
          rp.stage,
          rp.assigned_admin_id,
          rp.last_contacted_at,
          rp.notes AS pipeline_notes,
          rp.is_partner_visible,
          rp.updated_at AS pipeline_updated_at,
          sm.sharpe_ratio,
          sm.sortino_ratio,
          sm.calmar_ratio,
          sm.equity_curve_r2,
          sm.avg_mae,
          sm.avg_mfe,
          sm.style_cluster,
          sm.composite_score,
          sm.calculated_at,
          w.id AS watchlist_id,
          w.tier AS watchlist_tier,
          w.notes AS watchlist_notes
        FROM users u
        LEFT JOIN user_verification uv ON uv.user_id = u.id
        LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
        LEFT JOIN scout_metrics_snapshot sm ON sm.user_id = u.id
        LEFT JOIN scout_watchlists w ON w.user_id = u.id AND w.admin_id = $2::int
        WHERE u.id = $1::int
          AND u.is_admin = false
          AND u.is_deleted = false
        LIMIT 1
      `,
      [userId, adminId],
    );

    const row = userRes.rows?.[0];
    if (!row) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    const perfRes = await dbClient.query(
      `
        WITH src AS (
          SELECT
            t.id,
            t.opened_at,
            t.closed_at,
            ${netProfitSql}::float8 AS net_profit
          FROM trades t
          WHERE t.user_id = $1::int
            AND t.status = 'CLOSED'
            AND t.closed_at IS NOT NULL
            AND t.closed_at >= $2::int
        )
        SELECT
          COUNT(*)::int AS trades,
          COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate,
          COALESCE(AVG((closed_at - opened_at)::float8), 0)::float8 AS avg_hold_sec,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN net_profit ELSE 0 END), 0)::float8 AS gross_profit,
          COALESCE(SUM(CASE WHEN net_profit < 0 THEN -net_profit ELSE 0 END), 0)::float8 AS gross_loss
        FROM src
      `,
      [userId, cutoffSec],
    );

    const dayRows = (
      await dbClient.query(
        `
          WITH src AS (
            SELECT
              t.closed_at,
              ${netProfitSql}::float8 AS net_profit
            FROM trades t
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            to_char(to_timestamp(closed_at), 'YYYY-MM-DD') AS day_key,
            SUM(net_profit)::float8 AS pnl
          FROM src
          GROUP BY day_key
          ORDER BY day_key ASC
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ day_key: string; pnl: number }>;

    const hourlyRows = (
      await dbClient.query(
        `
          WITH src AS (
            SELECT
              EXTRACT(HOUR FROM to_timestamp(t.closed_at))::int AS hour_utc,
              ${netProfitSql}::float8 AS net_profit
            FROM trades t
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            hour_utc,
            COUNT(*)::int AS trades,
            COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
            COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate
          FROM src
          GROUP BY hour_utc
          ORDER BY hour_utc ASC
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ hour_utc: number; trades: number; net_profit: number; win_rate: number }>;

    const symbolRows = (
      await dbClient.query(
        `
          WITH src AS (
            SELECT
              COALESCE(sc.symbol, 'UNKNOWN') AS symbol,
              COALESCE(NULLIF(lower(sc.category), ''), 'unknown') AS category,
              ${netProfitSql}::float8 AS net_profit
            FROM trades t
            LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            symbol,
            category,
            COUNT(*)::int AS trades,
            COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
            COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate
          FROM src
          GROUP BY symbol, category
          ORDER BY net_profit DESC, trades DESC
          LIMIT 40
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ symbol: string; category: string; trades: number; net_profit: number; win_rate: number }>;

    const summary = perfRes.rows?.[0] ?? {};
    const startingEquity = Math.max(1, Number(row.starting_equity ?? 1_000_000));
    let runningPnl = 0;
    const equityCurve: Array<{ day: string; equity: number; pnl: number }> = [];
    for (const dayRow of dayRows) {
      const pnl = Number(dayRow.pnl ?? 0);
      runningPnl += pnl;
      equityCurve.push({
        day: String(dayRow.day_key),
        equity: Number((startingEquity + runningPnl).toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
      });
    }
    const maxDrawdown = computeMaxDrawdownFromEquitySeries(equityCurve.map((v) => v.equity));

    return res.json({
      ok: true,
      row: {
        userId: Number(row.id),
        email: row.email ?? null,
        username: row.username ?? null,
        name: row.name ?? null,
        userTier: row.user_tier ?? null,
        kycStatus: row.kyc_status ?? null,
        createdAt: row.created_at == null ? null : Number(row.created_at),
        countryIso2: row.country_iso2 ?? null,
        regionKey: row.region_key ?? null,
        verification: {
          emailVerifiedAt: row.email_verified_at == null ? null : Number(row.email_verified_at),
          smsVerifiedAt: row.sms_verified_at == null ? null : Number(row.sms_verified_at),
          contenderTier: row.contender_tier ?? null,
        },
        pipeline: {
          stage: row.stage ?? "DETECTED",
          assignedAdminId: row.assigned_admin_id == null ? null : Number(row.assigned_admin_id),
          lastContactedAt: row.last_contacted_at == null ? null : Number(row.last_contacted_at),
          notes: row.pipeline_notes ?? null,
          isPartnerVisible: Boolean(row.is_partner_visible ?? false),
          updatedAt: row.pipeline_updated_at == null ? null : Number(row.pipeline_updated_at),
        },
        watchlist: row.watchlist_id
          ? {
              id: Number(row.watchlist_id),
              tier: row.watchlist_tier ?? "B_LIST",
              notes: row.watchlist_notes ?? null,
            }
          : null,
        metrics: {
          sharpeRatio: row.sharpe_ratio == null ? null : Number(row.sharpe_ratio),
          sortinoRatio: row.sortino_ratio == null ? null : Number(row.sortino_ratio),
          calmarRatio: row.calmar_ratio == null ? null : Number(row.calmar_ratio),
          equityCurveR2: row.equity_curve_r2 == null ? null : Number(row.equity_curve_r2),
          avgMae: row.avg_mae == null ? null : Number(row.avg_mae),
          avgMfe: row.avg_mfe == null ? null : Number(row.avg_mfe),
          styleCluster: row.style_cluster ?? null,
          compositeScore: row.composite_score == null ? null : Number(row.composite_score),
          calculatedAt: row.calculated_at == null ? null : Number(row.calculated_at),
        },
        performance: {
          days,
          trades: Number(summary.trades ?? 0),
          netProfit: Number(summary.net_profit ?? 0),
          winRate: Number(summary.win_rate ?? 0),
          avgHoldSec: Number(summary.avg_hold_sec ?? 0),
          grossProfit: Number(summary.gross_profit ?? 0),
          grossLoss: Number(summary.gross_loss ?? 0),
          maxDrawdown,
        },
        equityCurve,
        attributionBySymbol: symbolRows.map((r) => ({
          symbol: r.symbol,
          category: r.category,
          trades: Number(r.trades ?? 0),
          netProfit: Number(r.net_profit ?? 0),
          winRate: Number(r.win_rate ?? 0),
        })),
        attributionByHourUtc: hourlyRows.map((r) => ({
          hourUtc: Number(r.hour_utc ?? 0),
          trades: Number(r.trades ?? 0),
          netProfit: Number(r.net_profit ?? 0),
          winRate: Number(r.win_rate ?? 0),
        })),
      },
    });
  } catch (error) {
    console.error("[admin-scout] candidate detail error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CANDIDATE" });
  }
});

adminScoutRouter.get("/watchlist", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);

    const rows = await db
      .select({
        id: scoutWatchlists.id,
        userId: scoutWatchlists.userId,
        tier: scoutWatchlists.tier,
        notes: scoutWatchlists.notes,
        createdAt: scoutWatchlists.createdAt,
        updatedAt: scoutWatchlists.updatedAt,
        username: users.username,
        email: users.email,
        name: users.name,
        stage: recruitingPipeline.stage,
        isPartnerVisible: recruitingPipeline.isPartnerVisible,
        sharpeRatio: scoutMetricsSnapshot.sharpeRatio,
        compositeScore: scoutMetricsSnapshot.compositeScore,
        styleCluster: scoutMetricsSnapshot.styleCluster,
      })
      .from(scoutWatchlists)
      .innerJoin(users, eq(users.id, scoutWatchlists.userId))
      .leftJoin(recruitingPipeline, eq(recruitingPipeline.userId, scoutWatchlists.userId))
      .leftJoin(scoutMetricsSnapshot, eq(scoutMetricsSnapshot.userId, scoutWatchlists.userId))
      .where(eq(scoutWatchlists.adminId, adminId))
      .orderBy(desc(scoutWatchlists.updatedAt), desc(scoutWatchlists.id));

    return res.json({
      ok: true,
      rows: rows.map((r) => ({
        id: Number(r.id),
        userId: Number(r.userId),
        tier: r.tier,
        notes: r.notes,
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        user: {
          username: r.username,
          email: r.email,
          name: r.name,
        },
        pipeline: {
          stage: r.stage ?? "DETECTED",
          isPartnerVisible: Boolean(r.isPartnerVisible ?? false),
        },
        metrics: {
          sharpeRatio: r.sharpeRatio == null ? null : Number(r.sharpeRatio),
          compositeScore: r.compositeScore == null ? null : Number(r.compositeScore),
          styleCluster: r.styleCluster ?? null,
        },
      })),
    });
  } catch (error) {
    console.error("[admin-scout] watchlist list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_WATCHLIST" });
  }
});

adminScoutRouter.post("/watchlist", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const parsed = watchlistInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const { userId, tier, notes } = parsed.data;

    const [userRow] = await db
      .select({ id: users.id, isAdmin: users.isAdmin, isDeleted: users.isDeleted })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRow || userRow.isAdmin || userRow.isDeleted) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    await ensurePipelineRowForUser(userId);
    const ts = nowSec();

    await db
      .insert(scoutWatchlists)
      .values({
        adminId,
        userId,
        tier: tier ?? "B_LIST",
        notes: notes ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: [scoutWatchlists.adminId, scoutWatchlists.userId],
        set: {
          tier: tier ?? "B_LIST",
          notes: notes ?? null,
          updatedAt: ts,
        },
      });

    const [saved] = await db
      .select()
      .from(scoutWatchlists)
      .where(and(eq(scoutWatchlists.adminId, adminId), eq(scoutWatchlists.userId, userId)))
      .limit(1);

    await appendRecruitmentAudit(req, "SCOUT_WATCHLIST_UPSERT", {
      targetUserId: userId,
      tier: tier ?? "B_LIST",
      watchlistId: saved?.id ?? null,
    });

    return res.status(201).json({ ok: true, row: saved });
  } catch (error) {
    console.error("[admin-scout] watchlist upsert error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPSERT_WATCHLIST" });
  }
});

adminScoutRouter.delete("/watchlist/:id", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_WATCHLIST_ID" });
    }

    const [deleted] = await db
      .delete(scoutWatchlists)
      .where(and(eq(scoutWatchlists.id, id), eq(scoutWatchlists.adminId, adminId)))
      .returning({ id: scoutWatchlists.id, userId: scoutWatchlists.userId });

    if (!deleted) {
      return res.status(404).json({ message: "WATCHLIST_ITEM_NOT_FOUND" });
    }

    await appendRecruitmentAudit(req, "SCOUT_WATCHLIST_DELETE", {
      watchlistId: id,
      targetUserId: deleted.userId,
    });

    return res.json({ ok: true, id });
  } catch (error) {
    console.error("[admin-scout] watchlist delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_WATCHLIST" });
  }
});

adminScoutRouter.get("/pipeline", async (req, res) => {
  try {
    const stage = parseOptionalStage(req.query.stage);
    if (safeString(req.query.stage).trim() && !stage) {
      return res.status(400).json({ message: "INVALID_STAGE" });
    }

    const limit = parsePositiveInt(req.query.limit, 50, 300);
    const offset = parseOffset(req.query.offset);

    const rows = (
      await dbClient.query(
        `
          SELECT
            u.id AS user_id,
            u.username,
            u.email,
            u.name,
            u.user_tier,
            u.kyc_status,
            u.created_at,
            COALESCE(rp.stage, 'DETECTED') AS stage,
            COALESCE(rp.assigned_admin_id, NULL) AS assigned_admin_id,
            COALESCE(rp.last_contacted_at, NULL) AS last_contacted_at,
            COALESCE(rp.notes, NULL) AS notes,
            COALESCE(rp.is_partner_visible, false) AS is_partner_visible,
            COALESCE(rp.updated_at, u.created_at) AS updated_at,
            sm.composite_score,
            sm.sharpe_ratio,
            sm.style_cluster,
            COUNT(*) OVER()::int AS total_count
          FROM users u
          LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
          LEFT JOIN scout_metrics_snapshot sm ON sm.user_id = u.id
          WHERE u.is_admin = false
            AND u.is_deleted = false
            AND ($1::text IS NULL OR COALESCE(rp.stage, 'DETECTED') = $1::text)
          ORDER BY COALESCE(rp.updated_at, u.created_at) DESC, u.id DESC
          LIMIT $2::int OFFSET $3::int
        `,
        [stage, limit, offset],
      )
    ).rows as any[];

    const stageCountRows = (
      await dbClient.query(
        `
          SELECT
            COALESCE(rp.stage, 'DETECTED') AS stage,
            COUNT(*)::int AS count
          FROM users u
          LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
          WHERE u.is_admin = false
            AND u.is_deleted = false
          GROUP BY COALESCE(rp.stage, 'DETECTED')
        `,
      )
    ).rows as Array<{ stage: string; count: number }>;

    const stageCounts: Record<string, number> = {};
    for (const key of PIPELINE_STAGES) stageCounts[key] = 0;
    for (const row of stageCountRows) {
      const key = String(row.stage || "").toUpperCase();
      if (PIPELINE_STAGES.includes(key as any)) {
        stageCounts[key] = Number(row.count ?? 0);
      }
    }

    const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
    const hasMore = offset + rows.length < total;

    return res.json({
      ok: true,
      limit,
      offset,
      total,
      hasMore,
      stageCounts,
      rows: rows.map((r) => ({
        userId: Number(r.user_id),
        username: r.username ?? null,
        email: r.email ?? null,
        name: r.name ?? null,
        userTier: r.user_tier ?? null,
        kycStatus: r.kyc_status ?? null,
        createdAt: r.created_at == null ? null : Number(r.created_at),
        stage: r.stage ?? "DETECTED",
        assignedAdminId: r.assigned_admin_id == null ? null : Number(r.assigned_admin_id),
        lastContactedAt: r.last_contacted_at == null ? null : Number(r.last_contacted_at),
        notes: r.notes ?? null,
        isPartnerVisible: Boolean(r.is_partner_visible),
        updatedAt: r.updated_at == null ? null : Number(r.updated_at),
        metrics: {
          compositeScore: r.composite_score == null ? null : Number(r.composite_score),
          sharpeRatio: r.sharpe_ratio == null ? null : Number(r.sharpe_ratio),
          styleCluster: r.style_cluster ?? null,
        },
      })),
    });
  } catch (error) {
    console.error("[admin-scout] pipeline list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PIPELINE_LIST" });
  }
});

adminScoutRouter.get("/pipeline/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "INVALID_USER_ID" });
    }

    const ensured = await ensurePipelineRowForUser(userId);
    if (!ensured) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    const [row] = await db
      .select({
        userId: recruitingPipeline.userId,
        stage: recruitingPipeline.stage,
        assignedAdminId: recruitingPipeline.assignedAdminId,
        lastContactedAt: recruitingPipeline.lastContactedAt,
        notes: recruitingPipeline.notes,
        isPartnerVisible: recruitingPipeline.isPartnerVisible,
        updatedAt: recruitingPipeline.updatedAt,
        username: users.username,
        email: users.email,
        name: users.name,
        userTier: users.userTier,
        kycStatus: users.kycStatus,
      })
      .from(recruitingPipeline)
      .innerJoin(users, eq(users.id, recruitingPipeline.userId))
      .where(eq(recruitingPipeline.userId, userId))
      .limit(1);

    if (!row) {
      return res.status(404).json({ message: "PIPELINE_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      row: {
        userId: Number(row.userId),
        stage: row.stage,
        assignedAdminId: row.assignedAdminId == null ? null : Number(row.assignedAdminId),
        lastContactedAt: row.lastContactedAt == null ? null : Number(row.lastContactedAt),
        notes: row.notes,
        isPartnerVisible: Boolean(row.isPartnerVisible),
        updatedAt: Number(row.updatedAt),
        user: {
          username: row.username,
          email: row.email,
          name: row.name,
          userTier: row.userTier,
          kycStatus: row.kycStatus,
        },
      },
    });
  } catch (error) {
    console.error("[admin-scout] pipeline get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PIPELINE" });
  }
});

adminScoutRouter.put("/pipeline/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "INVALID_USER_ID" });
    }

    const parsed = pipelineUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const updated = await updateRecruitingPipelineForUser({
      userId,
      patch: parsed.data,
    });

    if (!updated.ok) {
      if (updated.message === "TRADER_NOT_FOUND" || updated.message === "PIPELINE_NOT_FOUND") {
        return res.status(404).json({ message: updated.message });
      }
      if (updated.message === "PARTNER_READY_GATING_FAILED") {
        return res.status(409).json({ message: updated.message, reason: updated.reason });
      }
      return res.status(409).json({ message: updated.message });
    }

    await appendRecruitmentAudit(req, "SCOUT_PIPELINE_UPDATE", {
      targetUserId: userId,
      stage: updated.applied.stage,
      isPartnerVisible: updated.applied.isPartnerVisible,
      assignedAdminId: parsed.data.assignedAdminId,
    });

    return res.json({ ok: true, row: updated.row });
  } catch (error) {
    console.error("[admin-scout] pipeline update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PIPELINE" });
  }
});

adminScoutRouter.get("/inquiry-routing", async (_req, res) => {
  try {
    const [config, resolved, messagingSettings, adminRows] = await Promise.all([
      getPartnerInquiryRoutingConfig(),
      resolvePartnerInquiryRouting(),
      getCommunicationSettings(),
      db
        .select({
          userId: users.id,
          email: users.email,
          username: users.username,
          name: users.name,
          mailboxPublicKey: users.mailboxPublicKey,
          mailboxPublicKeyUpdatedAt: users.mailboxPublicKeyUpdatedAt,
        })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.isDisabled, false), eq(users.isDeleted, false)))
        .orderBy(sql`lower(${users.email}) asc`, sql`${users.id} asc`),
    ]);

    const routeSet = new Set(resolved.routeAdmins.map((row) => row.userId));
    const viewerSet = new Set(resolved.viewerAdmins.map((row) => row.userId));

    return res.json({
      ok: true,
      config,
      resolved: {
        routeAdminCount: resolved.routeAdmins.length,
        viewerAdminCount: resolved.viewerAdmins.length,
        participantAdminCount: resolved.participantAdmins.length,
        unresolvedRouteEmails: resolved.unresolvedRouteEmails,
        unresolvedViewerEmails: resolved.unresolvedViewerEmails,
        missingKeyAdminIds: resolved.missingKeyAdminIds,
      },
      messaging: {
        messagingEnabled: messagingSettings.messagingEnabled,
        messagingE2eeEnabled: messagingSettings.messagingE2eeEnabled,
        messagingE2eeRequired: messagingSettings.messagingE2eeRequired,
      },
      availableAdmins: adminRows.map((row) => ({
        userId: Number(row.userId),
        email: String(row.email || "").toLowerCase(),
        username: row.username ?? null,
        name: row.name ?? null,
        routeRecipient: routeSet.has(Number(row.userId)),
        viewerRecipient: viewerSet.has(Number(row.userId)),
        hasMailboxKey: String(row.mailboxPublicKey || "").trim().length > 0,
        mailboxPublicKeyUpdatedAt:
          row.mailboxPublicKeyUpdatedAt == null ? null : Number(row.mailboxPublicKeyUpdatedAt),
      })),
    });
  } catch (error) {
    console.error("[admin-scout] inquiry routing get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_INQUIRY_ROUTING" });
  }
});

adminScoutRouter.put("/inquiry-routing", async (req, res) => {
  try {
    const parsed = inquiryRoutingPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const routeAdminEmails =
      parsed.data.routeAdminEmails === undefined ? undefined : normalizeEmailArray(parsed.data.routeAdminEmails);
    const viewerAdminEmails =
      parsed.data.viewerAdminEmails === undefined ? undefined : normalizeEmailArray(parsed.data.viewerAdminEmails);

    const activeAdminRows = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.isDisabled, false), eq(users.isDeleted, false)));
    const activeAdminEmailSet = new Set(
      activeAdminRows
        .map((row) => String(row.email || "").trim().toLowerCase())
        .filter((email) => email.length > 0),
    );

    const unknownRouteEmails = (routeAdminEmails ?? []).filter((email) => !activeAdminEmailSet.has(email));
    if (unknownRouteEmails.length) {
      return res.status(400).json({ message: "UNKNOWN_ROUTE_ADMIN_EMAILS", emails: unknownRouteEmails });
    }

    const unknownViewerEmails = (viewerAdminEmails ?? []).filter((email) => !activeAdminEmailSet.has(email));
    if (unknownViewerEmails.length) {
      return res.status(400).json({ message: "UNKNOWN_VIEWER_ADMIN_EMAILS", emails: unknownViewerEmails });
    }

    const config = await upsertPartnerInquiryRoutingConfig({
      inboxAlias: parsed.data.inboxAlias,
      routeAdminEmails,
      viewerAdminEmails,
      updatedBy: String(req.session?.email || "admin"),
    });
    const resolved = await resolvePartnerInquiryRouting();
    if (!resolved.routeAdmins.length) {
      return res.status(409).json({ message: "NO_ACTIVE_ADMIN_RECIPIENTS" });
    }

    await appendRecruitmentAudit(req, "PARTNER_INQUIRY_ROUTING_UPDATE", {
      inboxAlias: config.inboxAlias,
      routeAdminCount: config.routeAdminEmails.length,
      viewerAdminCount: config.viewerAdminEmails.length,
      routeAdminEmails: config.routeAdminEmails,
      viewerAdminEmails: config.viewerAdminEmails,
    });

    return res.json({
      ok: true,
      config,
      resolved: {
        routeAdminCount: resolved.routeAdmins.length,
        viewerAdminCount: resolved.viewerAdmins.length,
        participantAdminCount: resolved.participantAdmins.length,
        missingKeyAdminIds: resolved.missingKeyAdminIds,
      },
    });
  } catch (error) {
    console.error("[admin-scout] inquiry routing update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_INQUIRY_ROUTING" });
  }
});

adminScoutRouter.get("/inquiries", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 80, 300);
    const offset = parseOffset(req.query.offset);
    const statusRaw = safeString(req.query.status).trim().toUpperCase();
    const statusFilter = statusRaw
      ? ["OPEN", "FORWARDED", "ANSWERED", "CLOSED"].includes(statusRaw)
        ? statusRaw
        : null
      : null;
    if (statusRaw && !statusFilter) {
      return res.status(400).json({ message: "INVALID_STATUS" });
    }

    const rows = (
      await dbClient.query(
        `
          SELECT
            i.id,
            i.partner_id,
            p.name AS partner_name,
            i.user_hash_id,
            i.sender_name,
            i.sender_email,
            i.subject,
            i.body,
            i.status,
            i.mailbox_thread_id,
            i.created_at,
            i.updated_at,
            COUNT(*) OVER()::int AS total_count
          FROM partner_inquiries i
          INNER JOIN partners p ON p.id = i.partner_id
          WHERE ($1::text IS NULL OR i.status = $1::text)
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT $2::int OFFSET $3::int
        `,
        [statusFilter, limit, offset],
      )
    ).rows as any[];

    const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
    const hasMore = offset + rows.length < total;

    await appendRecruitmentAudit(req, "PARTNER_INQUIRIES_ADMIN_LIST", {
      statusFilter: statusFilter ?? null,
      limit,
      offset,
      rowsReturned: rows.length,
      total,
    });

    return res.json({
      ok: true,
      limit,
      offset,
      total,
      hasMore,
      rows: rows.map((row) => ({
        id: Number(row.id),
        partnerId: Number(row.partner_id),
        partnerName: row.partner_name ?? null,
        userHashId: row.user_hash_id ?? null,
        senderName: row.sender_name ?? null,
        senderEmail: row.sender_email ?? null,
        subject: row.subject ?? null,
        body: row.body ?? null,
        status: row.status ?? null,
        mailboxThreadId: row.mailbox_thread_id == null ? null : Number(row.mailbox_thread_id),
        createdAt: row.created_at == null ? null : Number(row.created_at),
        updatedAt: row.updated_at == null ? null : Number(row.updated_at),
      })),
    });
  } catch (error) {
    console.error("[admin-scout] inquiries list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PARTNER_INQUIRIES" });
  }
});

adminScoutRouter.get("/config", async (_req, res) => {
  try {
    const [cfg] = await db
      .select({
        scoutTabEnabled: systemConfig.scoutTabEnabled,
        partnerPortalEnabled: systemConfig.partnerPortalEnabled,
        traderProProfilesEnabled: systemConfig.traderProProfilesEnabled,
        traderCompeteEnabled: systemConfig.traderCompeteEnabled,
        traderCommunityEnabled: systemConfig.traderCommunityEnabled,
        partnerAllocationsEnabled: systemConfig.partnerAllocationsEnabled,
        partnerGatingConfig: systemConfig.partnerGatingConfig,
        partnerPasswordRotationDays: systemConfig.partnerPasswordRotationDays,
        partnerPasswordReminderLogins: systemConfig.partnerPasswordReminderLogins,
        partnerInviteDefaultExpiryDays: systemConfig.partnerInviteDefaultExpiryDays,
        leaderboardMode: systemConfig.leaderboardMode,
        scoutMinSharpeAlert: systemConfig.scoutMinSharpeAlert,
        updatedAt: systemConfig.updatedAt,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    return res.json({
      ok: true,
      config: {
        scoutTabEnabled: Boolean(cfg?.scoutTabEnabled ?? true),
        partnerPortalEnabled: Boolean(cfg?.partnerPortalEnabled ?? false),
        traderProProfilesEnabled: Boolean(cfg?.traderProProfilesEnabled ?? false),
        traderCompeteEnabled: Boolean(cfg?.traderCompeteEnabled ?? false),
        traderCommunityEnabled: Boolean(cfg?.traderCommunityEnabled ?? false),
        partnerAllocationsEnabled: Boolean(cfg?.partnerAllocationsEnabled ?? false),
        partnerGatingConfig: normalizePartnerGatingConfig(cfg?.partnerGatingConfig),
        partnerPasswordRotationDays: Math.max(7, Math.min(365, Number(cfg?.partnerPasswordRotationDays ?? 90))),
        partnerPasswordReminderLogins: Math.max(
          1,
          Math.min(20, Number(cfg?.partnerPasswordReminderLogins ?? 3)),
        ),
        partnerInviteDefaultExpiryDays: Math.max(
          1,
          Math.min(180, Number(cfg?.partnerInviteDefaultExpiryDays ?? 7)),
        ),
        leaderboardMode: LEADERBOARD_MODES.includes(String(cfg?.leaderboardMode || "") as any)
          ? String(cfg?.leaderboardMode)
          : "PUBLIC",
        scoutMinSharpeAlert: Number(cfg?.scoutMinSharpeAlert ?? 2),
        updatedAt: cfg?.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("[admin-scout] config get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_SCOUT_CONFIG" });
  }
});

adminScoutRouter.put("/config", async (req, res) => {
  try {
    const parsed = scoutConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const [existing] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    if (!existing) {
      await db.insert(systemConfig).values({ id: 1 });
    }

    const ts = nowSec();
    await db
      .update(systemConfig)
      .set({
        scoutTabEnabled: parsed.data.scoutTabEnabled,
        partnerPortalEnabled: parsed.data.partnerPortalEnabled,
        traderProProfilesEnabled: parsed.data.traderProProfilesEnabled,
        traderCompeteEnabled: parsed.data.traderCompeteEnabled,
        traderCommunityEnabled: parsed.data.traderCommunityEnabled,
        partnerAllocationsEnabled: parsed.data.partnerAllocationsEnabled,
        partnerGatingConfig:
          parsed.data.partnerGatingConfig === undefined
            ? undefined
            : JSON.stringify(normalizePartnerGatingConfig(parsed.data.partnerGatingConfig)),
        partnerPasswordRotationDays: parsed.data.partnerPasswordRotationDays,
        partnerPasswordReminderLogins: parsed.data.partnerPasswordReminderLogins,
        partnerInviteDefaultExpiryDays: parsed.data.partnerInviteDefaultExpiryDays,
        leaderboardMode: parsed.data.leaderboardMode,
        scoutMinSharpeAlert: parsed.data.scoutMinSharpeAlert,
        updatedAt: ts,
        updatedBy: String(req.session?.email || "admin"),
      })
      .where(eq(systemConfig.id, 1));

    const [updated] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);

    await appendRecruitmentAudit(req, "SCOUT_CONFIG_UPDATE", {
      patchKeys: Object.keys(parsed.data),
    });

    return res.json({ ok: true, config: updated });
  } catch (error) {
    console.error("[admin-scout] config update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_SCOUT_CONFIG" });
  }
});

export const adminChallengesRouter = Router();
adminChallengesRouter.use(requireAdmin);

adminChallengesRouter.get("/", async (_req, res) => {
  try {
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
        c.created_by,
        c.created_at,
        c.updated_at,
        COUNT(e.id)::int AS enrollment_count,
        SUM(CASE WHEN e.status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_enrollment_count,
        SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::int AS passed_count,
        SUM(CASE WHEN e.status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed_count
      FROM challenges c
      LEFT JOIN challenge_enrollments e ON e.challenge_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC, c.id DESC
    `);

    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenges list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGES" });
  }
});

adminChallengesRouter.post("/", async (req, res) => {
  try {
    const parsed = challengeUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const data = parsed.data;
    if (data.startAt != null && data.endAt != null && data.endAt < data.startAt) {
      return res.status(400).json({ message: "INVALID_TIME_WINDOW" });
    }

    const ts = nowSec();
    const [created] = await db
      .insert(challenges)
      .values({
        name: data.name,
        description: data.description ?? null,
        profitTargetPct: data.profitTargetPct,
        maxDailyLossPct: data.maxDailyLossPct,
        maxTotalLossPct: data.maxTotalLossPct ?? null,
        minTradingDays: data.minTradingDays ?? null,
        durationDays: data.durationDays,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        isActive: Boolean(data.isActive ?? false),
        createdBy: Number(req.session?.userId || 0) || null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();

    await appendRecruitmentAudit(req, "CHALLENGE_CREATE", { challengeId: created.id });
    return res.status(201).json({ ok: true, row: created });
  } catch (error) {
    console.error("[admin-scout] challenge create error:", error);
    return res.status(500).json({ message: "FAILED_TO_CREATE_CHALLENGE" });
  }
});

adminChallengesRouter.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [challengeRow] = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!challengeRow) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const enrollmentRows = await db
      .select({
        id: challengeEnrollments.id,
        userId: challengeEnrollments.userId,
        status: challengeEnrollments.status,
        enrolledAt: challengeEnrollments.enrolledAt,
        completedAt: challengeEnrollments.completedAt,
        currentPnlPct: challengeEnrollments.currentPnlPct,
        tradingDays: challengeEnrollments.tradingDays,
        maxDailyLossHit: challengeEnrollments.maxDailyLossHit,
      })
      .from(challengeEnrollments)
      .where(eq(challengeEnrollments.challengeId, id))
      .orderBy(desc(challengeEnrollments.id))
      .limit(500);

    return res.json({ ok: true, row: challengeRow, enrollments: enrollmentRows });
  } catch (error) {
    console.error("[admin-scout] challenge get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE" });
  }
});

adminChallengesRouter.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const parsed = challengeUpsertSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const [existing] = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const nextStartAt = parsed.data.startAt ?? existing.startAt;
    const nextEndAt = parsed.data.endAt ?? existing.endAt;
    if (nextStartAt != null && nextEndAt != null && nextEndAt < nextStartAt) {
      return res.status(400).json({ message: "INVALID_TIME_WINDOW" });
    }

    const [updated] = await db
      .update(challenges)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        profitTargetPct: parsed.data.profitTargetPct,
        maxDailyLossPct: parsed.data.maxDailyLossPct,
        maxTotalLossPct: parsed.data.maxTotalLossPct,
        minTradingDays: parsed.data.minTradingDays,
        durationDays: parsed.data.durationDays,
        startAt: parsed.data.startAt,
        endAt: parsed.data.endAt,
        isActive: parsed.data.isActive,
        updatedAt: nowSec(),
      })
      .where(eq(challenges.id, id))
      .returning();

    await appendRecruitmentAudit(req, "CHALLENGE_UPDATE", { challengeId: id, patchKeys: Object.keys(parsed.data) });
    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] challenge update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE" });
  }
});

adminChallengesRouter.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [deleted] = await db.delete(challenges).where(eq(challenges.id, id)).returning({ id: challenges.id });
    if (!deleted) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    await appendRecruitmentAudit(req, "CHALLENGE_DELETE", { challengeId: id });
    return res.json({ ok: true, id });
  } catch (error) {
    console.error("[admin-scout] challenge delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE" });
  }
});

export const adminPartnersRouter = Router();
adminPartnersRouter.use(requireAdmin);

adminPartnersRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.name,
        p.api_key_prefix,
        p.ip_whitelist,
        p.is_active,
        p.contact_email,
        p.contact_username,
        p.invite_status,
        p.onboarding_step,
        p.invite_expires_at,
        p.agreements_signed_at,
        p.contact_access_requested_at,
        p.approved_at,
        p.gating_overrides,
        p.profile_data,
        p.aum_range,
        p.hq_location,
        p.strategy_tags,
        p.kyb_doc_url,
        p.admin_notes,
        p.created_at,
        p.updated_at,
        p.last_key_rotated_at,
        COUNT(DISTINCT a.id)::int AS allocation_count,
        COUNT(DISTINCT i.id)::int AS inquiry_count,
        MAX(pi.invited_at)::int AS latest_invited_at,
        MAX(pi.email_status) FILTER (WHERE pi.invited_at = (
          SELECT MAX(pi2.invited_at) FROM partner_invites pi2 WHERE pi2.partner_id = p.id
        )) AS latest_invite_email_status
      FROM partners p
      LEFT JOIN partner_allocations a ON a.partner_id = p.id
      LEFT JOIN partner_inquiries i ON i.partner_id = p.id
      LEFT JOIN partner_invites pi ON pi.partner_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC, p.id DESC
    `);

    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] partners list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PARTNERS" });
  }
});

adminPartnersRouter.post("/", async (req, res) => {
  try {
    const parsed = partnerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const { raw, hash, prefix } = buildPartnerApiKey();
    const ts = nowSec();

    const [created] = await db
      .insert(partners)
      .values({
        name: parsed.data.name,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        ipWhitelist: sanitizePartnerIpWhitelist(parsed.data.ipWhitelist),
        isActive: parsed.data.isActive ?? true,
        inviteStatus: "ACTIVE",
        onboardingStep: "COMPLETED",
        profileData: "{}",
        strategyTags: "[]",
        gatingOverrides: "{}",
        createdAt: ts,
        updatedAt: ts,
        lastKeyRotatedAt: ts,
      })
      .returning({
        id: partners.id,
        name: partners.name,
        apiKeyPrefix: partners.apiKeyPrefix,
        ipWhitelist: partners.ipWhitelist,
        isActive: partners.isActive,
        createdAt: partners.createdAt,
        updatedAt: partners.updatedAt,
        lastKeyRotatedAt: partners.lastKeyRotatedAt,
      });

    await appendRecruitmentAudit(req, "PARTNER_CREATE", { partnerId: created.id, name: created.name });

    return res.status(201).json({
      ok: true,
      row: created,
      apiKey: raw,
      warning: "Store this key now. It will not be shown again.",
    });
  } catch (error: any) {
    console.error("[admin-scout] partner create error:", error);
    if (String(error?.message || "").includes("partners_api_key_hash_uidx")) {
      return res.status(409).json({ message: "PARTNER_KEY_CONFLICT_RETRY" });
    }
    return res.status(500).json({ message: "FAILED_TO_CREATE_PARTNER" });
  }
});

adminPartnersRouter.post("/invite", async (req, res) => {
  try {
    const parsed = partnerInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const adminId = Number(req.session?.userId || 0);
    const adminEmail = String(req.session?.email || "admin");
    const ipKey = String(req.ip || "unknown");
    const adminRate = consumeRateLimit(partnerInviteRateByAdmin, adminId, PARTNER_INVITE_ADMIN_LIMIT);
    if (!adminRate.allowed) {
      res.setHeader("Retry-After", String(adminRate.retryAfterSec));
      return res.status(429).json({ message: "PARTNER_INVITE_ADMIN_RATE_LIMIT", retryAfterSec: adminRate.retryAfterSec });
    }
    const ipRate = consumeRateLimit(partnerInviteRateByIp, ipKey, PARTNER_INVITE_IP_LIMIT);
    if (!ipRate.allowed) {
      res.setHeader("Retry-After", String(ipRate.retryAfterSec));
      return res.status(429).json({ message: "PARTNER_INVITE_IP_RATE_LIMIT", retryAfterSec: ipRate.retryAfterSec });
    }

    const contactEmail = normalizePartnerEmail(parsed.data.email);
    if (!contactEmail) {
      return res.status(400).json({ message: "INVALID_EMAIL" });
    }
    const fundNameInput = String(parsed.data.fundName || "").trim();
    const adminNotes = String(parsed.data.adminNotes || "").trim() || null;

    const [cfg] = await db
      .select({
        partnerInviteDefaultExpiryDays: systemConfig.partnerInviteDefaultExpiryDays,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    const defaultExpiry = Math.max(1, Math.min(180, Number(cfg?.partnerInviteDefaultExpiryDays ?? 7)));
    const expiresInDays = Math.max(1, Math.min(180, Number(parsed.data.expiresInDays ?? defaultExpiry)));
    const ts = nowSec();
    const inviteExpiresAt = ts + expiresInDays * 86400;

    const existingEmailRows = (
      await db.execute(sql`
        SELECT id
        FROM partners
        WHERE lower(contact_email) = ${contactEmail}
        LIMIT 1
      `)
    ).rows as Array<{ id: number }>;
    if (existingEmailRows.length > 0) {
      return res.status(409).json({ message: "PARTNER_EMAIL_ALREADY_EXISTS" });
    }

    const username = buildPartnerUsername(contactEmail);
    const tempPassword = buildPartnerTempPassword();
    const tempPasswordHash = await bcrypt.hash(tempPassword, 10);
    const inviteToken = randomToken(24);
    const inviteTokenHash = sha256Hex(inviteToken);
    const apiKey = buildPartnerApiKey();
    const partnerName =
      fundNameInput || contactEmail.split("@")[0]?.replace(/[^a-zA-Z0-9\s._-]/g, "").trim() || `Partner-${ts}`;
    const inviteStatus = parsed.data.autoActivate ? "ACTIVE" : "INVITED";
    const profileData = JSON.stringify({
      fundName: fundNameInput || null,
      aumRange: null,
      hqLocation: null,
      strategyTags: [],
    });

    const [created] = await db
      .insert(partners)
      .values({
        name: partnerName.slice(0, 120),
        apiKeyHash: apiKey.hash,
        apiKeyPrefix: apiKey.prefix,
        ipWhitelist: "",
        isActive: true,
        contactEmail,
        contactUsername: username,
        tempPasswordHash,
        inviteTokenHash,
        inviteExpiresAt,
        loginCount: 0,
        inviteStatus,
        onboardingStep: "PROFILE",
        profileData,
        strategyTags: "[]",
        gatingOverrides: "{}",
        adminNotes,
        createdAt: ts,
        updatedAt: ts,
        lastKeyRotatedAt: ts,
      })
      .returning({
        id: partners.id,
        name: partners.name,
        apiKeyPrefix: partners.apiKeyPrefix,
        contactEmail: partners.contactEmail,
        contactUsername: partners.contactUsername,
        inviteStatus: partners.inviteStatus,
        onboardingStep: partners.onboardingStep,
        inviteExpiresAt: partners.inviteExpiresAt,
      });

    const [inviteAudit] = await db
      .insert(partnerInvites)
      .values({
        adminId: adminId || null,
        partnerId: Number(created.id),
        partnerEmail: contactEmail,
        fundName: fundNameInput || null,
        adminNotes,
        expiresInDays,
        invitedAt: ts,
        emailStatus: "QUEUED",
        inviteTokenHash,
      })
      .returning({
        id: partnerInvites.id,
      });

    const deepLink = buildPartnerInviteDeepLink({ username, token: inviteToken });
    const emailSend = await sendPartnerInviteEmail({
      to: contactEmail,
      username,
      tempPassword,
      apiKey: apiKey.raw,
      deepLink,
      expiresInDays,
    });

    await db
      .update(partnerInvites)
      .set({
        emailStatus: emailSend.status,
        emailProviderMessageId: emailSend.messageId || null,
        emailStatusDetail: emailSend.detail || null,
      })
      .where(eq(partnerInvites.id, Number(inviteAudit.id)));

    await appendRecruitmentAudit(req, "PARTNER_INVITE_CREATE", {
      partnerId: Number(created.id),
      partnerEmail: contactEmail,
      inviteStatus,
      expiresInDays,
      emailStatus: emailSend.status,
    });

    return res.status(201).json({
      ok: true,
      row: created,
      invite: {
        expiresInDays,
        inviteExpiresAt,
        emailStatus: emailSend.status,
        emailDetail: emailSend.detail || null,
      },
      credentials: {
        username,
        tempPassword,
        apiKey: apiKey.raw,
        inviteToken,
        deepLink,
      },
      warning: "Store these credentials now. API key and temporary password are shown once.",
    });
  } catch (error: any) {
    console.error("[admin-scout] partner invite error:", error);
    if (String(error?.message || "").includes("partners_api_key_hash_uidx")) {
      return res.status(409).json({ message: "PARTNER_KEY_CONFLICT_RETRY" });
    }
    return res.status(500).json({ message: "FAILED_TO_INVITE_PARTNER" });
  }
});

adminPartnersRouter.get("/:id/onboarding", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }

    const [partnerRow] = await db
      .select({
        id: partners.id,
        name: partners.name,
        contactEmail: partners.contactEmail,
        contactUsername: partners.contactUsername,
        inviteStatus: partners.inviteStatus,
        onboardingStep: partners.onboardingStep,
        inviteExpiresAt: partners.inviteExpiresAt,
        profileData: partners.profileData,
        fundLogoUrl: partners.fundLogoUrl,
        aumRange: partners.aumRange,
        hqLocation: partners.hqLocation,
        strategyTags: partners.strategyTags,
        kybDocUrl: partners.kybDocUrl,
        agreementsSignedAt: partners.agreementsSignedAt,
        contactAccessRequestedAt: partners.contactAccessRequestedAt,
        approvedAt: partners.approvedAt,
        gatingOverrides: partners.gatingOverrides,
        adminNotes: partners.adminNotes,
        updatedAt: partners.updatedAt,
      })
      .from(partners)
      .where(eq(partners.id, id))
      .limit(1);

    if (!partnerRow) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    const inviteRows = await db
      .select({
        id: partnerInvites.id,
        adminId: partnerInvites.adminId,
        partnerEmail: partnerInvites.partnerEmail,
        fundName: partnerInvites.fundName,
        adminNotes: partnerInvites.adminNotes,
        expiresInDays: partnerInvites.expiresInDays,
        invitedAt: partnerInvites.invitedAt,
        emailStatus: partnerInvites.emailStatus,
        emailStatusDetail: partnerInvites.emailStatusDetail,
      })
      .from(partnerInvites)
      .where(eq(partnerInvites.partnerId, id))
      .orderBy(desc(partnerInvites.invitedAt), desc(partnerInvites.id))
      .limit(20);

    return res.json({
      ok: true,
      row: {
        ...partnerRow,
        gateOverrides: normalizePartnerGatingOverrides(partnerRow.gatingOverrides),
      },
      invites: inviteRows,
    });
  } catch (error) {
    console.error("[admin-scout] partner onboarding get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PARTNER_ONBOARDING" });
  }
});

adminPartnersRouter.put("/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }

    const parsed = partnerApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const [existing] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    const ts = nowSec();
    const nextNotes = String(parsed.data.adminNotes || "").trim();
    const setPatch: any = {
      adminNotes: nextNotes || existing.adminNotes || null,
      updatedAt: ts,
    };

    if (parsed.data.action === "APPROVE") {
      setPatch.inviteStatus = "ACTIVE";
      setPatch.isActive = true;
      setPatch.onboardingStep = "COMPLETED";
      setPatch.approvedAt = ts;
    } else if (parsed.data.action === "HOLD") {
      setPatch.inviteStatus = "ACTIVE";
      setPatch.onboardingStep = "WAITING_APPROVAL";
      setPatch.isActive = true;
    } else if (parsed.data.action === "REVOKE") {
      setPatch.inviteStatus = "REVOKED";
      setPatch.isActive = false;
    }

    const [updated] = await db
      .update(partners)
      .set(setPatch)
      .where(eq(partners.id, id))
      .returning();

    await appendRecruitmentAudit(req, "PARTNER_APPROVAL_ACTION", {
      partnerId: id,
      action: parsed.data.action,
      inviteStatus: updated?.inviteStatus ?? null,
      onboardingStep: updated?.onboardingStep ?? null,
    });

    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] partner approval update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PARTNER_APPROVAL" });
  }
});

adminPartnersRouter.put("/:id/gating-overrides", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }

    const parsed = partnerGatingOverrideSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const [existing] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    const normalized = normalizePartnerGatingOverrides(parsed.data);
    const [updated] = await db
      .update(partners)
      .set({
        gatingOverrides: JSON.stringify(normalized),
        updatedAt: nowSec(),
      })
      .where(eq(partners.id, id))
      .returning({
        id: partners.id,
        gatingOverrides: partners.gatingOverrides,
        updatedAt: partners.updatedAt,
      });

    await appendRecruitmentAudit(req, "PARTNER_GATING_OVERRIDE_UPDATE", {
      partnerId: id,
      overrides: normalized,
    });

    return res.json({
      ok: true,
      row: {
        id: updated.id,
        gatingOverrides: normalizePartnerGatingOverrides(updated.gatingOverrides),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("[admin-scout] partner gating overrides update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PARTNER_GATING_OVERRIDES" });
  }
});

adminPartnersRouter.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }

    const parsed = partnerPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const [existing] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    let rotatedApiKey: string | null = null;
    let apiKeyHash: string | undefined;
    let apiKeyPrefix: string | undefined;
    let lastKeyRotatedAt: number | undefined;

    if (parsed.data.rotateKey) {
      const generated = buildPartnerApiKey();
      rotatedApiKey = generated.raw;
      apiKeyHash = generated.hash;
      apiKeyPrefix = generated.prefix;
      lastKeyRotatedAt = nowSec();
    }

    const [updated] = await db
      .update(partners)
      .set({
        name: parsed.data.name,
        ipWhitelist: parsed.data.ipWhitelist === undefined ? undefined : sanitizePartnerIpWhitelist(parsed.data.ipWhitelist),
        isActive: parsed.data.isActive,
        apiKeyHash,
        apiKeyPrefix,
        lastKeyRotatedAt,
        updatedAt: nowSec(),
      })
      .where(eq(partners.id, id))
      .returning({
        id: partners.id,
        name: partners.name,
        apiKeyPrefix: partners.apiKeyPrefix,
        ipWhitelist: partners.ipWhitelist,
        isActive: partners.isActive,
        createdAt: partners.createdAt,
        updatedAt: partners.updatedAt,
        lastKeyRotatedAt: partners.lastKeyRotatedAt,
      });

    await appendRecruitmentAudit(req, parsed.data.rotateKey ? "PARTNER_KEY_ROTATE" : "PARTNER_UPDATE", {
      partnerId: id,
      rotateKey: Boolean(parsed.data.rotateKey),
      patchKeys: Object.keys(parsed.data),
    });

    return res.json({
      ok: true,
      row: updated,
      apiKey: rotatedApiKey,
      warning: rotatedApiKey ? "Store the rotated key now. It will not be shown again." : undefined,
    });
  } catch (error: any) {
    console.error("[admin-scout] partner update error:", error);
    if (String(error?.message || "").includes("partners_api_key_hash_uidx")) {
      return res.status(409).json({ message: "PARTNER_KEY_CONFLICT_RETRY" });
    }
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PARTNER" });
  }
});

adminPartnersRouter.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }

    const [updated] = await db
      .update(partners)
      .set({
        isActive: false,
        updatedAt: nowSec(),
      })
      .where(eq(partners.id, id))
      .returning({
        id: partners.id,
        name: partners.name,
        isActive: partners.isActive,
        updatedAt: partners.updatedAt,
      });

    if (!updated) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    await appendRecruitmentAudit(req, "PARTNER_DEACTIVATE", { partnerId: id });
    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] partner delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DEACTIVATE_PARTNER" });
  }
});
