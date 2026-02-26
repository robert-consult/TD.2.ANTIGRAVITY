import { Router } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@db";
import { adminDataExportCreateRequestSchema } from "@shared/admin/dataExports";
import { auditExportManifest, users } from "@shared/schema";
import { requireAdmin } from "../middleware/requireAdmin";
import { storage } from "../storage";
import { getRecentIdentityAudit } from "../services/identityAudit";
import {
  buildAuditTrailLinkage,
  fetchOrderIntentAuditRecords,
  fetchTradeAuditRecords,
} from "../services/adminAuditTrail";
import { createAdminDataExportJob } from "../services/adminDataExportRepo";
import { enqueueAdminDataExportJob } from "../services/adminDataExportQueue";
import { onAdminExportJobCreated } from "../services/adminDataExportMetrics";
import { getPetascaleRuntimeConfig } from "../services/petascaleEnv";

function getSessionAdminId(req: any): number | null {
  const id = Number(req?.session?.userId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function toUnixSec(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed > 1e12) return Math.floor(parsed / 1000);
  return Math.floor(parsed);
}

function cleanText(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

async function enqueueAuditExportJob(params: {
  req: any;
  type: "trade_audit" | "order_intent_audit";
  format: "csv" | "jsonl" | "parquet";
  filters: Record<string, unknown>;
  dedupeWindowSec?: number;
}): Promise<{ jobId: string; deduped: boolean; pollUrl: string }> {
  const requestedByAdminId = getSessionAdminId(params.req);
  if (!requestedByAdminId) throw new Error("Forbidden");

  const request = adminDataExportCreateRequestSchema.parse({
    type: params.type,
    format: params.format,
    filters: params.filters,
  });
  const cfg = getPetascaleRuntimeConfig();
  const created = await createAdminDataExportJob({
    request,
    requestedByAdminId,
    maxAttempts: cfg.queueMaxAttempts,
    dedupeWindowSec: params.dedupeWindowSec ?? 1800,
  });
  onAdminExportJobCreated({ deduped: created.deduped });
  await enqueueAdminDataExportJob({ jobId: created.job.id });
  return {
    jobId: created.job.id,
    deduped: created.deduped,
    pollUrl: `/api/admin/data-exports/${encodeURIComponent(created.job.id)}`,
  };
}

export const adminInstitutionalAuditRouter = Router();
adminInstitutionalAuditRouter.use(requireAdmin);

adminInstitutionalAuditRouter.get("/trade-audit", async (req, res) => {
  try {
    const tradeId = Number(req.query.tradeId);
    const records = await fetchTradeAuditRecords({
      limit: clampInt(req.query.limit, 1000, 1, 5000),
      tradeId: Number.isFinite(tradeId) && tradeId > 0 ? Math.trunc(tradeId) : null,
      eventType: cleanText(req.query.eventType, 96) ?? null,
      riskResult: cleanText(req.query.riskResult, 64) ?? null,
      correlationId: cleanText(req.query.correlationId, 160) ?? null,
    });
    return res.json(records);
  } catch (error) {
    console.error("Error fetching trade audit:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminInstitutionalAuditRouter.get("/order-intent-audit", async (req, res) => {
  try {
    const userId = Number(req.query.userId);
    const records = await fetchOrderIntentAuditRecords({
      limit: clampInt(req.query.limit, 500, 1, 5000),
      correlationId: cleanText(req.query.correlationId, 160) ?? null,
      decision: cleanText(req.query.decision, 64) ?? null,
      userId: Number.isFinite(userId) && userId > 0 ? Math.trunc(userId) : null,
    });
    return res.json(records);
  } catch (error) {
    console.error("Error fetching order intent audit:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminInstitutionalAuditRouter.get("/audit-trail", async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const deepLimit = clampInt(req.query.deepLimit, limit, 1, 5000);
    const includeDeepTrade = String(req.query.includeDeepTrade ?? "1") !== "0";
    const includeLinkage = String(req.query.includeLinkage ?? "1") !== "0";
    const correlationId = cleanText(req.query.correlationId, 160) ?? null;

    const thirtyDaysAgoSec = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const recentSignups = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        createdAt: users.createdAt,
        signupIp: users.signupIp,
        signupIpHash: users.signupIpHash,
        signupUserAgent: users.signupUserAgent,
        signupCountryCode: users.signupCountryCode,
        signupRegion: users.signupRegion,
        signupCity: users.signupCity,
        signupLatitude: users.signupLatitude,
        signupLongitude: users.signupLongitude,
        signupDeviceType: users.signupDeviceType,
        signupBrowser: users.signupBrowser,
        signupOs: users.signupOs,
        signupClientTz: users.signupClientTz,
        signupInferredTz: users.signupInferredTz,
        signupDeviceFp: users.signupDeviceFp,
        signupDeviceInstallId: users.signupDeviceInstallId,
        signupClientLang: users.signupClientLang,
      })
      .from(users)
      .where(and(eq(users.isAdmin, false), gte(users.createdAt, thirtyDaysAgoSec)))
      .orderBy(desc(users.createdAt))
      .limit(limit);

    const signups = recentSignups.map((u: any) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      createdAt: toUnixSec(u.createdAt),
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
      signupDeviceFp: u.signupDeviceFp || null,
      signupDeviceInstallId: u.signupDeviceInstallId || null,
      signupClientLang: u.signupClientLang || null,
    }));

    const loginHistory = await storage.getAllLoginHistory(limit);
    const logins = loginHistory.map((entry: any) => ({
      id: entry.id,
      userId: entry.userId ?? null,
      email: entry.email,
      success: entry.success,
      ip: entry.ipAddress || entry.ip || null,
      createdAt: toUnixSec(entry.createdAt),
      logoutAt: toUnixSec(entry.logoutAt),
      sessionLengthSec: entry.sessionLengthSec ?? null,
      sessionId: entry.sessionId || null,
      eventType: entry.eventType || null,
      userAgent: entry.userAgent || null,
      countryCode: entry.countryCode || null,
      region: entry.region || null,
      city: entry.city || null,
      latitude: entry.latitude || null,
      longitude: entry.longitude || null,
      clientTz: entry.clientTz || null,
      clientLang: entry.clientLang || null,
      deviceFp: entry.deviceFp || null,
      deviceInstallId: entry.deviceInstallId || null,
    }));

    const adminActions = await storage.getAdminActions(limit);
    const adminActionRows = adminActions.map((a: any) => ({
      id: a.id,
      adminId: a.adminId,
      userId: a.userId,
      actionType: a.actionType,
      createdAt: toUnixSec(a.createdAt),
      metadata: a.metadata,
      metadataJson:
        typeof a.metadata === "string" && a.metadata
          ? (() => {
              try {
                return JSON.parse(a.metadata);
              } catch {
                return null;
              }
            })()
          : null,
      ip: a.ip || null,
      userAgent: a.userAgent || null,
    }));

    const identityEvents = await getRecentIdentityAudit({ limit });
    const identityEventRows = identityEvents.map((e: any) => ({
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
      data:
        typeof e.dataJson === "string" && e.dataJson
          ? (() => {
              try {
                return JSON.parse(e.dataJson);
              } catch {
                return null;
              }
            })()
          : null,
      dataJson: e.dataJson ?? null,
      prevHash: e.prevHash ?? null,
      eventHash: e.eventHash,
    }));

    const tradeAuditEvents = includeDeepTrade
      ? await fetchTradeAuditRecords({
          limit: deepLimit,
          correlationId,
        })
      : [];

    const orderIntentEvents = includeDeepTrade
      ? await fetchOrderIntentAuditRecords({
          limit: deepLimit,
          correlationId,
        })
      : [];

    const linkage = includeLinkage
      ? buildAuditTrailLinkage({
          signups,
          logins,
          adminActions: adminActionRows,
          identityEvents: identityEventRows,
          tradeAuditEvents,
          orderIntentEvents,
        })
      : { byCorrelationId: [], bySessionId: [], byUserId: [] };

    return res.json({
      signups,
      logins,
      adminActions: adminActionRows,
      identityEvents: identityEventRows,
      tradeAuditEvents,
      orderIntentEvents,
      linkage,
      deepAuditMeta: {
        limit,
        deepLimit: includeDeepTrade ? deepLimit : 0,
        includeDeepTrade,
        includeLinkage,
        correlationId,
        generatedAtSec: Math.floor(Date.now() / 1000),
      },
    });
  } catch (error) {
    console.error("Get audit trail error:", error);
    return res.status(500).json({ message: "Failed to fetch audit trail" });
  }
});

adminInstitutionalAuditRouter.get("/export-manifests", async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 100, 1, 500);
    const manifests = await db
      .select()
      .from(auditExportManifest)
      .orderBy(desc(auditExportManifest.exportedAtUtcMs))
      .limit(limit);
    return res.json(manifests);
  } catch (error) {
    console.error("Error fetching export manifests:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminInstitutionalAuditRouter.get("/trade-audit/export/csv", async (req: any, res) => {
  try {
    const queued = await enqueueAuditExportJob({
      req,
      type: "trade_audit",
      format: "csv",
      filters: {
        limit: clampInt(req.query.limit, 100_000, 1, 5_000_000),
        tradeId: (() => {
          const n = Number(req.query.tradeId);
          return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
        })(),
        eventType: cleanText(req.query.eventType, 96),
        riskResult: cleanText(req.query.riskResult, 64),
        correlationId: cleanText(req.query.correlationId, 160),
      },
    });
    return res.status(202).json({
      ok: true,
      ...queued,
      status: "QUEUED",
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    console.error("Trade audit export queue error:", error);
    return res.status(400).json({ message: error?.message || "Failed to queue trade audit export" });
  }
});

adminInstitutionalAuditRouter.get("/trade-audit/export/jsonl", async (req: any, res) => {
  try {
    const queued = await enqueueAuditExportJob({
      req,
      type: "trade_audit",
      format: "jsonl",
      filters: {
        limit: clampInt(req.query.limit, 100_000, 1, 5_000_000),
        tradeId: (() => {
          const n = Number(req.query.tradeId);
          return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
        })(),
        eventType: cleanText(req.query.eventType, 96),
        riskResult: cleanText(req.query.riskResult, 64),
        correlationId: cleanText(req.query.correlationId, 160),
      },
    });
    return res.status(202).json({
      ok: true,
      ...queued,
      status: "QUEUED",
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    console.error("Trade audit export queue error:", error);
    return res.status(400).json({ message: error?.message || "Failed to queue trade audit export" });
  }
});

adminInstitutionalAuditRouter.get("/trade-audit/export/parquet", async (req: any, res) => {
  try {
    const queued = await enqueueAuditExportJob({
      req,
      type: "trade_audit",
      format: "parquet",
      filters: {
        limit: clampInt(req.query.limit, 100_000, 1, 5_000_000),
        tradeId: (() => {
          const n = Number(req.query.tradeId);
          return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
        })(),
        eventType: cleanText(req.query.eventType, 96),
        riskResult: cleanText(req.query.riskResult, 64),
        correlationId: cleanText(req.query.correlationId, 160),
      },
    });
    return res.status(202).json({
      ok: true,
      ...queued,
      status: "QUEUED",
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    console.error("Trade audit export queue error:", error);
    return res.status(400).json({ message: error?.message || "Failed to queue trade audit export" });
  }
});

adminInstitutionalAuditRouter.get("/order-intent-audit/export/csv", async (req: any, res) => {
  try {
    const queued = await enqueueAuditExportJob({
      req,
      type: "order_intent_audit",
      format: "csv",
      filters: {
        limit: clampInt(req.query.limit, 100_000, 1, 5_000_000),
        correlationId: cleanText(req.query.correlationId, 160),
        decision: cleanText(req.query.decision, 64),
        userId: (() => {
          const n = Number(req.query.userId);
          return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
        })(),
      },
    });
    return res.status(202).json({
      ok: true,
      ...queued,
      status: "QUEUED",
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    console.error("Order intent export queue error:", error);
    return res.status(400).json({ message: error?.message || "Failed to queue order intent audit export" });
  }
});

adminInstitutionalAuditRouter.get("/order-intent-audit/export/jsonl", async (req: any, res) => {
  try {
    const queued = await enqueueAuditExportJob({
      req,
      type: "order_intent_audit",
      format: "jsonl",
      filters: {
        limit: clampInt(req.query.limit, 100_000, 1, 5_000_000),
        correlationId: cleanText(req.query.correlationId, 160),
        decision: cleanText(req.query.decision, 64),
        userId: (() => {
          const n = Number(req.query.userId);
          return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
        })(),
      },
    });
    return res.status(202).json({
      ok: true,
      ...queued,
      status: "QUEUED",
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    console.error("Order intent export queue error:", error);
    return res.status(400).json({ message: error?.message || "Failed to queue order intent audit export" });
  }
});

adminInstitutionalAuditRouter.get("/order-intent-audit/export/parquet", async (req: any, res) => {
  try {
    const queued = await enqueueAuditExportJob({
      req,
      type: "order_intent_audit",
      format: "parquet",
      filters: {
        limit: clampInt(req.query.limit, 100_000, 1, 5_000_000),
        correlationId: cleanText(req.query.correlationId, 160),
        decision: cleanText(req.query.decision, 64),
        userId: (() => {
          const n = Number(req.query.userId);
          return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
        })(),
      },
    });
    return res.status(202).json({
      ok: true,
      ...queued,
      status: "QUEUED",
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    console.error("Order intent export queue error:", error);
    return res.status(400).json({ message: error?.message || "Failed to queue order intent audit export" });
  }
});
