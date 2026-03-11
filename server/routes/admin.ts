import { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAdmin } from "../middleware/auth";
import {
  insertUserSettingsSchema,
  insertSymbolConfigSchema,
  globalSettings,
  systemConfig,
  marketDataProviders,
  userAdminNotes,
  signupWaitlist,
} from "@shared/schema";
import { db, dbClient } from "../../db";
import { eq, sql, desc, and, gte, inArray, like, or } from "drizzle-orm";
import { trades, users, symbolConfigs, userSettings } from "@shared/schema";
import { appendIdentityAudit, getRecentIdentityAudit } from "../services/identityAudit";
import { scheduleAutoClose } from "../cron/autoClose";
import { reloadFeedConfig } from "../feeds/quoteFeed";
import { stringify } from "csv-stringify/sync";
import { z } from "zod";
import { sha256, stableStringify } from "../legal/cryptoUtils";
import { invalidateJurisdictionRestrictionPolicyCache, parseRestrictedCountriesCsv } from "../legal/regionRules";
import { buildAuditContext } from "../lib/auditContext";
import { recalcAccount } from "../recalcAccount";
import { publishLiveEvent } from "../services/liveBus";
import { invalidateRememberMeConfigCache } from "../services/rememberMe";
import { applyAdminScopeSession } from "../security/adminScopeSession";
import { consumeGlobalSettingsUpdateRateLimit } from "../security/globalSettingsRateLimit";
import {
  buildDefaultGlobalSettingsWrite,
  buildGlobalSettingsPerformanceSnapshot,
  buildGlobalSettingsRiskSnapshot,
  parseGlobalSettingsUpdateInput,
  resolveGlobalSettingsWrite,
} from "../services/globalSettingsAdmin";
import {
  LEGACY_TRADE_PROFIT_NUMERIC_SQL,
} from "../services/traderScoutQuery";

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
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

export function registerAdminRoutes(app: Express) {
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
        applyAdminScopeSession(req.session, { isAdmin: true });
      }

      res.json({ success: true, message: "User is now an admin" });
    } catch (error) {
      console.error("Error promoting user to admin:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/global-settings", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const settings = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1),
      });

      // If no settings exist, insert a default row and return it
      if (!settings) {
        const defaults = buildDefaultGlobalSettingsWrite(Math.floor(Date.now() / 1000));
        await db.insert(globalSettings).values({
          id: 1,
          ...defaults,
        });

        const newSettings = await db.query.globalSettings.findFirst({
          where: eq(globalSettings.id, 1),
        });
        return res.json(newSettings);
      }

      res.json(settings);
    } catch (error) {
      console.error("Error fetching global settings:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Update global settings
  app.put("/api/admin/global-settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsedInput = parseGlobalSettingsUpdateInput(req.body ?? {});
      if (!parsedInput.ok) {
        return res.status(400).json({ message: parsedInput.message });
      }
      const { expectedUpdatedAt, next } = parsedInput;

      const actorAdminId = Number((req.session as any)?.userId ?? 0);
      if (Number.isFinite(actorAdminId) && actorAdminId > 0) {
        const rate = await consumeGlobalSettingsUpdateRateLimit(actorAdminId);
        if (!rate.allowed) {
          const auditCtx = buildAuditContext(req);
          res.setHeader("Retry-After", String(rate.retryAfterSec));
          appendIdentityAudit({
            userId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            category: "admin",
            type: "GLOBAL_SETTINGS_UPDATE_RATE_LIMITED",
            title: "Global settings update blocked by rate limit",
            description: "Admin attempted to update global settings too frequently.",
            ip: auditCtx.ip,
            userAgent: auditCtx.userAgent,
            actorAdminId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            actorType: "ADMIN",
            actorUserId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            sessionId: auditCtx.sessionId,
            correlationId: auditCtx.correlationId,
            data: {
              retryAfterSec: rate.retryAfterSec,
            },
          });
          return res.status(429).json({
            message: "Too many global settings updates. Please retry shortly.",
            retryAfterSec: rate.retryAfterSec,
          });
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const existing = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1),
      });
      if (existing) {
        const currentUpdatedAt = typeof existing.updatedAt === "number" ? Math.trunc(existing.updatedAt) : null;
        if (expectedUpdatedAt === undefined) {
          return res.status(409).json({
            message: "Global settings are stale. Refresh before saving.",
            currentUpdatedAt,
          });
        }
        if (currentUpdatedAt !== expectedUpdatedAt) {
          return res.status(409).json({
            message: "Global settings changed by another admin. Refresh and retry.",
            currentUpdatedAt,
          });
        }
      }

      const prevRisk = buildGlobalSettingsRiskSnapshot(existing);
      const prevPerformance = buildGlobalSettingsPerformanceSnapshot(existing);

      let resolvedWrite: ReturnType<typeof resolveGlobalSettingsWrite>;
      try {
        resolvedWrite = resolveGlobalSettingsWrite({
          existing,
          patch: next,
          nowSec,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid global settings payload";
        return res.status(400).json({ message });
      }

      if (existing) {
        await db.update(globalSettings).set(resolvedWrite.write).where(eq(globalSettings.id, 1));
      } else {
        await db.insert(globalSettings).values({
          id: 1,
          ...resolvedWrite.write,
        });
      }

      const updated = await db.query.globalSettings.findFirst({
        where: eq(globalSettings.id, 1),
      });
      if (!updated) {
        return res.status(500).json({ message: "Failed to load updated global settings." });
      }

      const nextRisk = resolvedWrite.riskSnapshot;
      const nextPerformance = resolvedWrite.performanceSnapshot;
      const riskChanged = stableStringify(prevRisk) !== stableStringify(nextRisk);
      const performanceChanged = stableStringify(prevPerformance) !== stableStringify(nextPerformance);
      if (riskChanged || performanceChanged) {
        const auditCtx = buildAuditContext(req);
        if (riskChanged) {
          appendIdentityAudit({
            userId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            category: "admin",
            type: "GLOBAL_SETTINGS_RISK_UPDATED",
            title: "Global risk settings updated",
            description: "Updated default capital, risk guardrails, lot settings, and trading session controls.",
            ip: auditCtx.ip,
            userAgent: auditCtx.userAgent,
            actorAdminId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            actorType: "ADMIN",
            actorUserId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            sessionId: auditCtx.sessionId,
            correlationId: auditCtx.correlationId,
            data: {
              previous: prevRisk,
              next: nextRisk,
            },
          });
        }
        if (performanceChanged) {
          appendIdentityAudit({
            userId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            category: "admin",
            type: "GLOBAL_SETTINGS_PERFORMANCE_UPDATED",
            title: "Global performance settings updated",
            description: "Updated global performance defaults, prefetch tier controls, and tier-level poll/flush settings.",
            ip: auditCtx.ip,
            userAgent: auditCtx.userAgent,
            actorAdminId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            actorType: "ADMIN",
            actorUserId: typeof auditCtx.actorUserId === "number" ? auditCtx.actorUserId : null,
            sessionId: auditCtx.sessionId,
            correlationId: auditCtx.correlationId,
            data: {
              previous: prevPerformance,
              next: nextPerformance,
            },
          });
        }
      }

      // Propagate changes (multi-role deployments) + reschedule if scheduler is running locally.
      try {
        publishLiveEvent({
          type: "global-settings:updated",
          payload: {
            updatedAt: typeof updated.updatedAt === "number" ? updated.updatedAt : nowSec,
            wsPushFrequencyMs: nextPerformance.wsPushFrequencyMs,
            performanceSettings: nextPerformance,
          },
        });
        publishLiveEvent({
          type: "autoclose:reschedule",
          payload: { updatedAt: typeof updated.updatedAt === "number" ? updated.updatedAt : nowSec },
        });
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
          rememberMeEnabled: true,
          rememberMeMaxAgeDays: 30,
          rememberMeMaxDevicesPerUser: 10,
          rememberMeReauthAfterAbsenceDays: 7,
          rememberMeTokenRotationEnabled: true,
          rememberMeTheftAutoRevokeAll: true,
          sessionCookieMaxAgeHours: 24,
          sessionIdleTimeoutMinutes: 0,
          logoutClearAllDeviceTokens: false,
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
        signupPhoneEnforce: Boolean((config as any).signupPhoneEnforce ?? true),
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
        rememberMeEnabled: Boolean((config as any).rememberMeEnabled ?? true),
        rememberMeMaxAgeDays: Number((config as any).rememberMeMaxAgeDays ?? 30),
        rememberMeMaxDevicesPerUser: Number((config as any).rememberMeMaxDevicesPerUser ?? 10),
        rememberMeReauthAfterAbsenceDays: Number((config as any).rememberMeReauthAfterAbsenceDays ?? 7),
        rememberMeTokenRotationEnabled: Boolean((config as any).rememberMeTokenRotationEnabled ?? true),
        rememberMeTheftAutoRevokeAll: Boolean((config as any).rememberMeTheftAutoRevokeAll ?? true),
        sessionCookieMaxAgeHours: Number((config as any).sessionCookieMaxAgeHours ?? 24),
        sessionIdleTimeoutMinutes: Number((config as any).sessionIdleTimeoutMinutes ?? 0),
        logoutClearAllDeviceTokens: Boolean((config as any).logoutClearAllDeviceTokens ?? false),
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
        signupPhoneEnforce: body.signupPhoneEnforce !== undefined ? Boolean(body.signupPhoneEnforce) : undefined,
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
        rememberMeEnabled:
          body.rememberMeEnabled !== undefined ? Boolean(body.rememberMeEnabled) : undefined,
        rememberMeMaxAgeDays:
          body.rememberMeMaxAgeDays !== undefined ? Number(body.rememberMeMaxAgeDays) : undefined,
        rememberMeMaxDevicesPerUser:
          body.rememberMeMaxDevicesPerUser !== undefined ? Number(body.rememberMeMaxDevicesPerUser) : undefined,
        rememberMeReauthAfterAbsenceDays:
          body.rememberMeReauthAfterAbsenceDays !== undefined
            ? Number(body.rememberMeReauthAfterAbsenceDays)
            : undefined,
        rememberMeTokenRotationEnabled:
          body.rememberMeTokenRotationEnabled !== undefined
            ? Boolean(body.rememberMeTokenRotationEnabled)
            : undefined,
        rememberMeTheftAutoRevokeAll:
          body.rememberMeTheftAutoRevokeAll !== undefined
            ? Boolean(body.rememberMeTheftAutoRevokeAll)
            : undefined,
        sessionCookieMaxAgeHours:
          body.sessionCookieMaxAgeHours !== undefined ? Number(body.sessionCookieMaxAgeHours) : undefined,
        sessionIdleTimeoutMinutes:
          body.sessionIdleTimeoutMinutes !== undefined ? Number(body.sessionIdleTimeoutMinutes) : undefined,
        logoutClearAllDeviceTokens:
          body.logoutClearAllDeviceTokens !== undefined
            ? Boolean(body.logoutClearAllDeviceTokens)
            : undefined,
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

      if ((next as any).rememberMeMaxAgeDays !== undefined) {
        const days = Number((next as any).rememberMeMaxAgeDays);
        if (!Number.isFinite(days) || days < 1 || days > 90) {
          return res.status(400).json({ message: "rememberMeMaxAgeDays must be between 1 and 90" });
        }
        (next as any).rememberMeMaxAgeDays = Math.floor(days);
      }

      if ((next as any).rememberMeMaxDevicesPerUser !== undefined) {
        const devices = Number((next as any).rememberMeMaxDevicesPerUser);
        if (!Number.isFinite(devices) || devices < 1 || devices > 25) {
          return res.status(400).json({ message: "rememberMeMaxDevicesPerUser must be between 1 and 25" });
        }
        (next as any).rememberMeMaxDevicesPerUser = Math.floor(devices);
      }

      if ((next as any).rememberMeReauthAfterAbsenceDays !== undefined) {
        const days = Number((next as any).rememberMeReauthAfterAbsenceDays);
        if (!Number.isFinite(days) || days < 0 || days > 90) {
          return res
            .status(400)
            .json({ message: "rememberMeReauthAfterAbsenceDays must be between 0 and 90" });
        }
        (next as any).rememberMeReauthAfterAbsenceDays = Math.floor(days);
      }

      if ((next as any).sessionCookieMaxAgeHours !== undefined) {
        const hours = Number((next as any).sessionCookieMaxAgeHours);
        if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 14) {
          return res.status(400).json({ message: "sessionCookieMaxAgeHours must be between 1 and 336" });
        }
        (next as any).sessionCookieMaxAgeHours = Math.floor(hours);
      }

      if ((next as any).sessionIdleTimeoutMinutes !== undefined) {
        const minutes = Number((next as any).sessionIdleTimeoutMinutes);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60) {
          return res
            .status(400)
            .json({ message: "sessionIdleTimeoutMinutes must be between 0 and 1440" });
        }
        (next as any).sessionIdleTimeoutMinutes = Math.floor(minutes);
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
            signupPhoneEnforce: next.signupPhoneEnforce ?? (existing as any).signupPhoneEnforce ?? true,
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
            rememberMeEnabled: (next as any).rememberMeEnabled ?? (existing as any).rememberMeEnabled ?? true,
            rememberMeMaxAgeDays: Number(
              (next as any).rememberMeMaxAgeDays ?? (existing as any).rememberMeMaxAgeDays ?? 30,
            ),
            rememberMeMaxDevicesPerUser: Number(
              (next as any).rememberMeMaxDevicesPerUser ?? (existing as any).rememberMeMaxDevicesPerUser ?? 10,
            ),
            rememberMeReauthAfterAbsenceDays: Number(
              (next as any).rememberMeReauthAfterAbsenceDays ??
                (existing as any).rememberMeReauthAfterAbsenceDays ??
                7,
            ),
            rememberMeTokenRotationEnabled:
              (next as any).rememberMeTokenRotationEnabled ??
              (existing as any).rememberMeTokenRotationEnabled ??
              true,
            rememberMeTheftAutoRevokeAll:
              (next as any).rememberMeTheftAutoRevokeAll ??
              (existing as any).rememberMeTheftAutoRevokeAll ??
              true,
            sessionCookieMaxAgeHours: Number(
              (next as any).sessionCookieMaxAgeHours ?? (existing as any).sessionCookieMaxAgeHours ?? 24,
            ),
            sessionIdleTimeoutMinutes: Number(
              (next as any).sessionIdleTimeoutMinutes ?? (existing as any).sessionIdleTimeoutMinutes ?? 0,
            ),
            logoutClearAllDeviceTokens:
              (next as any).logoutClearAllDeviceTokens ??
              (existing as any).logoutClearAllDeviceTokens ??
              false,
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
          marketDataActiveProviderKey: (next as any).marketDataActiveProviderKey ?? "twelvedata",
          marketDataFallbackProviderKeysCsv: (next as any).marketDataFallbackProviderKeysCsv ?? "",
          fxRolloverTz: next.fxRolloverTz ?? "America/New_York",
          fxRolloverTime: next.fxRolloverTime ?? "17:00",
          signupCaptchaEnforce: next.signupCaptchaEnforce ?? true,
          captchaProvider: next.captchaProvider ?? "SLIDER",
          signupPhoneEnforce: next.signupPhoneEnforce ?? true,
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
          rememberMeEnabled: (next as any).rememberMeEnabled ?? true,
          rememberMeMaxAgeDays: Number((next as any).rememberMeMaxAgeDays ?? 30),
          rememberMeMaxDevicesPerUser: Number((next as any).rememberMeMaxDevicesPerUser ?? 10),
          rememberMeReauthAfterAbsenceDays: Number((next as any).rememberMeReauthAfterAbsenceDays ?? 7),
          rememberMeTokenRotationEnabled: (next as any).rememberMeTokenRotationEnabled ?? true,
          rememberMeTheftAutoRevokeAll: (next as any).rememberMeTheftAutoRevokeAll ?? true,
          sessionCookieMaxAgeHours: Number((next as any).sessionCookieMaxAgeHours ?? 24),
          sessionIdleTimeoutMinutes: Number((next as any).sessionIdleTimeoutMinutes ?? 0),
          logoutClearAllDeviceTokens: (next as any).logoutClearAllDeviceTokens ?? false,
          migrationChunkingEnabled: (next as any).migrationChunkingEnabled ?? false,
          migrationChunkSizeMb: Number((next as any).migrationChunkSizeMb ?? 51200),
          updatedBy: adminUser
        });
      }

      try {
        invalidateJurisdictionRestrictionPolicyCache();
      } catch { }

      try {
        invalidateRememberMeConfigCache();
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

  // IDENTITY AUDIT ROUTES
  const identityAuditQuerySchema = z.object({
    userId: z.string().regex(/^\\d+$/).optional().transform(v => v ? parseInt(v, 10) : undefined),
    category: z.string().optional(),
    type: z.string().optional(),
    limit: z.string().regex(/^\\d+$/).optional().transform(v => Math.min(Math.max(1, parseInt(v || "100", 10)), 500)),
    offset: z.string().regex(/^\\d+$/).optional().transform(v => Math.max(0, parseInt(v || "0", 10))),
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
