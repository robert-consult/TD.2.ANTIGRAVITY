import type { Express, Request, Response } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@db";
import { globalSettings, quotes, signupWaitlist, systemConfig } from "@shared/schema";
import { getSignupPublicConfig } from "../services/signupPublicConfig";
import { sanitizeMinPriceDistancePips } from "../services/globalSettings";
import { sha256, hmacSign, stableStringify } from "../legal/cryptoUtils";
import { verifySignupCaptcha } from "../security/captcha";
import {
  getClientIp,
  getUserAgent,
  buildGeoContext,
  extractGeoHints,
} from "../security/sessionTrail";
import { getTrustedProxyCountryIso2 } from "../security/proxyHeaders";
import { evaluateSignupJurisdiction } from "../policy/jurisdictionControl";
import { appendIdentityAudit } from "../services/identityAudit";

export function registerPublicCoreRoutes(app: Express) {
  // API status endpoint - moved from root to not conflict with frontend
  app.get("/api/status", (_req: Request, res: Response) => {
    res.json({ message: "TradeQuip API" });
  });

  // Public global settings endpoint (returns lot settings for order form)
  app.get("/api/global-settings", async (_req: Request, res: Response) => {
    try {
      const ABSOLUTE_MAX_LOTS = 50;

      const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.trunc(n)));
      };

      const parsePresetCards = (raw: string | null | undefined, max: number): number[] => {
        try {
          const parsed = JSON.parse(raw || "[]");
          if (!Array.isArray(parsed)) return [];
          const values = parsed
            .map((v) => (typeof v === "number" ? v : Number(v)))
            .filter((n) => Number.isFinite(n))
            .map((n) => Math.trunc(n))
            .filter((n) => n >= 1 && n <= max);
          const unique = Array.from(new Set(values));
          unique.sort((a, b) => a - b);
          return unique;
        } catch {
          return [];
        }
      };

      const [settings] = await db.select({
        lotPresetCards: globalSettings.lotPresetCards,
        lotDropdownMax: globalSettings.lotDropdownMax,
        minPriceDistancePips: globalSettings.minPriceDistancePips,
        restFallbackPollMs: globalSettings.restFallbackPollMs,
        wsPushFrequencyMs: globalSettings.wsPushFrequencyMs,
        quoteFlushIntervalMs: globalSettings.quoteFlushIntervalMs,
        maxWsReconnectAttempts: globalSettings.maxWsReconnectAttempts,
        wsReconnectBaseDelayMs: globalSettings.wsReconnectBaseDelayMs,
        prefetchStrategy: globalSettings.prefetchStrategy,
        pollInstantMs: globalSettings.pollInstantMs,
        pollFastMs: globalSettings.pollFastMs,
        pollModerateMs: globalSettings.pollModerateMs,
        pollConstrainedMs: globalSettings.pollConstrainedMs,
        pollMinimalMs: globalSettings.pollMinimalMs,
        flushInstantMs: globalSettings.flushInstantMs,
        flushFastMs: globalSettings.flushFastMs,
        flushModerateMs: globalSettings.flushModerateMs,
        flushConstrainedMs: globalSettings.flushConstrainedMs,
        flushMinimalMs: globalSettings.flushMinimalMs,
        updatedAt: globalSettings.updatedAt,
      }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1);

      const lotDropdownMax = clampInt(settings?.lotDropdownMax, 1, ABSOLUTE_MAX_LOTS, ABSOLUTE_MAX_LOTS);
      const minPriceDistancePips = sanitizeMinPriceDistancePips(settings?.minPriceDistancePips);
      const restFallbackPollMs = clampInt(settings?.restFallbackPollMs, 100, 60_000, 500);
      const wsPushFrequencyMs = clampInt(settings?.wsPushFrequencyMs, 0, 1_000, 0);
      const quoteFlushIntervalMs = clampInt(settings?.quoteFlushIntervalMs, 20, 5_000, 50);
      const maxWsReconnectAttempts = clampInt(settings?.maxWsReconnectAttempts, 1, 30, 30);
      const wsReconnectBaseDelayMs = clampInt(settings?.wsReconnectBaseDelayMs, 100, 30_000, 1500);
      const pollInstantMs = clampInt(settings?.pollInstantMs, 100, 60_000, 200);
      const pollFastMs = clampInt(settings?.pollFastMs, 100, 60_000, 500);
      const pollModerateMs = clampInt(settings?.pollModerateMs, 100, 60_000, 1500);
      const pollConstrainedMs = clampInt(settings?.pollConstrainedMs, 100, 60_000, 4000);
      const pollMinimalMs = clampInt(settings?.pollMinimalMs, 100, 60_000, 6000);
      const flushInstantMs = clampInt(settings?.flushInstantMs, 20, 5_000, 50);
      const flushFastMs = clampInt(settings?.flushFastMs, 20, 5_000, 150);
      const flushModerateMs = clampInt(settings?.flushModerateMs, 20, 5_000, 300);
      const flushConstrainedMs = clampInt(settings?.flushConstrainedMs, 20, 5_000, 500);
      const flushMinimalMs = clampInt(settings?.flushMinimalMs, 20, 5_000, 1000);
      const prefetchStrategyRaw = String(settings?.prefetchStrategy ?? "all").trim().toLowerCase();
      const prefetchStrategy =
        prefetchStrategyRaw === "critical" || prefetchStrategyRaw === "none" ? prefetchStrategyRaw : "all";

      const presetsParsed = parsePresetCards(settings?.lotPresetCards, lotDropdownMax);
      const lotPresetCardsArray =
        presetsParsed.length > 0
          ? presetsParsed
          : [1, 5, 10, 25, 50].filter((n) => n <= lotDropdownMax);

      const lotDropdownOptions = Array.from({ length: lotDropdownMax }, (_v, i) => i + 1);

      res.json({
        lotPresetCards: JSON.stringify(lotPresetCardsArray),
        lotPresetCardsArray,
        lotDropdownMax,
        lotDropdownOptions,
        minPriceDistancePips,
        restFallbackPollMs,
        wsPushFrequencyMs,
        quoteFlushIntervalMs,
        maxWsReconnectAttempts,
        wsReconnectBaseDelayMs,
        prefetchStrategy,
        pollInstantMs,
        pollFastMs,
        pollModerateMs,
        pollConstrainedMs,
        pollMinimalMs,
        flushInstantMs,
        flushFastMs,
        flushModerateMs,
        flushConstrainedMs,
        flushMinimalMs,
        absoluteMaxLots: ABSOLUTE_MAX_LOTS,
        updatedAt: typeof settings?.updatedAt === "number" ? settings.updatedAt : null,
      });
    } catch (error: any) {
      console.error("[GlobalSettings] Failed to fetch:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  // Public signup configuration (captcha + phone enforcement)
  app.get("/api/auth/signup-config", async (_req: Request, res: Response) => {
    res.json(await getSignupPublicConfig());
  });

  // Public waitlist policy (communications privacy notice)
  app.get("/api/auth/waitlist-policy", async (_req: Request, res: Response) => {
    const [row] = await db
      .select({
        signupWaitlistPolicyVersion: systemConfig.signupWaitlistPolicyVersion,
        signupWaitlistPolicyContent: systemConfig.signupWaitlistPolicyContent,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const version = String((row as any)?.signupWaitlistPolicyVersion ?? "1");
    const content = String((row as any)?.signupWaitlistPolicyContent ?? "");
    return res.json({ ok: true, version, sha256: sha256(content), content });
  });

  // Public invite waitlist join (when signups are frozen)
  app.post("/api/waitlist", async (req: Request, res: Response) => {
    const [row] = await db
      .select({
        signupFreeze: systemConfig.signupFreeze,
        signupWaitlistEnabled: systemConfig.signupWaitlistEnabled,
        signupCaptchaEnforce: systemConfig.signupCaptchaEnforce,
        captchaProvider: systemConfig.captchaProvider,
        signupWaitlistPolicyVersion: systemConfig.signupWaitlistPolicyVersion,
        signupWaitlistPolicyContent: systemConfig.signupWaitlistPolicyContent,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const signupsFrozen = Boolean((row as any)?.signupFreeze ?? false);
    const waitlistEnabled = Boolean((row as any)?.signupWaitlistEnabled ?? true);

    if (!waitlistEnabled || !signupsFrozen) {
      return res.status(404).json({ ok: false, error: "WAITLIST_UNAVAILABLE" });
    }

    const schema = z.object({
      fullName: z.string().min(2).max(120),
      email: z.string().email().max(254),
      consent: z.literal(true),
      captchaToken: z.string().optional().nullable(),
      policySha256: z.string().optional(),
      policyVersion: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "INVALID_INPUT", details: parsed.error.flatten() });
    }

    const { fullName, email, captchaToken, policySha256, policyVersion } = parsed.data;

    const captchaResult = await verifySignupCaptcha(req, captchaToken);
    if (!captchaResult.ok) return res.status(400).json({ ok: false, error: captchaResult.message });

    const nowSec = Math.floor(Date.now() / 1000);
    const emailTrimmed = email.trim();
    const emailLower = emailTrimmed.toLowerCase();
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const geo = buildGeoContext(ip, extractGeoHints(req));

    const ipCountryIso2 = getTrustedProxyCountryIso2(req) ?? (geo.countryCode ? geo.countryCode.toUpperCase() : undefined);

    const waitlistJ = evaluateSignupJurisdiction({
      ipCountryIso2,
      selectedCountryIso2: null,
    });

    if (!waitlistJ.allowed) {
      return res.status(waitlistJ.httpStatus).json({
        ok: false,
        error: "JURISDICTION_RESTRICTED",
        code: waitlistJ.code,
        message: waitlistJ.message,
        reasonCode: waitlistJ.reasonCode,
        blockedBy: waitlistJ.blockedBy,
        ipCountryIso2: waitlistJ.ipCountryIso2 ?? null,
      });
    }

    const policyContent = String((row as any)?.signupWaitlistPolicyContent ?? "");
    const policyV = String((row as any)?.signupWaitlistPolicyVersion ?? "1");
    const policyHash = sha256(policyContent);

    if (policySha256 && policySha256 !== policyHash) {
      return res.status(409).json({ ok: false, error: "POLICY_CHANGED" });
    }
    if (policyVersion && policyVersion !== policyV) {
      return res.status(409).json({ ok: false, error: "POLICY_CHANGED" });
    }

    const [existing] = await db
      .select({
        id: signupWaitlist.id,
        recordHash: signupWaitlist.recordHash,
      })
      .from(signupWaitlist)
      .where(eq(signupWaitlist.emailLower, emailLower))
      .limit(1);

    const [prevRow] = await db
      .select({ recordHash: signupWaitlist.recordHash })
      .from(signupWaitlist)
      .orderBy(desc(signupWaitlist.id))
      .limit(1);

    const prevHash = existing?.recordHash
      ? String(existing.recordHash)
      : prevRow?.recordHash ?? null;

    const consentPayload = {
      emailLower,
      fullName: fullName.trim(),
      consentedAt: nowSec,
      policyVersion: policyV,
      policySha256: policyHash,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    };

    const consentSignature = hmacSign(stableStringify(consentPayload));
    const recordHash = sha256(
      stableStringify({
        ...consentPayload,
        prevHash: prevHash ?? "GENESIS",
      })
    );

    if (existing?.id) {
      await db.update(signupWaitlist)
        .set({
          fullName: consentPayload.fullName,
          email: emailTrimmed,
          source: "PUBLIC_WAITLIST",
          ip,
          userAgent,
          consentedAt: nowSec,
          consentDocVersion: policyV,
          consentDocSha256: policyHash,
          consentDocContent: policyContent,
          consentSignature,
          prevHash,
          recordHash,
          updatedAt: nowSec,
        })
        .where(eq(signupWaitlist.id, Number(existing.id)));
    } else {
      await db.insert(signupWaitlist)
        .values({
          fullName: consentPayload.fullName,
          email: emailTrimmed,
          emailLower,
          source: "PUBLIC_WAITLIST",
          ip,
          userAgent,
          consentedAt: nowSec,
          consentDocVersion: policyV,
          consentDocSha256: policyHash,
          consentDocContent: policyContent,
          consentSignature,
          prevHash,
          recordHash,
          status: "PENDING",
          inviteSendCount: 0,
          createdAt: nowSec,
          updatedAt: nowSec,
        });
    }

    try {
      appendIdentityAudit({
        userId: null,
        email: emailLower,
        category: "SIGNUP",
        type: "WAITLIST_JOINED",
        title: "Waitlist joined",
        description: "User requested an invite while signups are frozen",
        ip,
        userAgent,
        data: {
          fullName: consentPayload.fullName,
          policyVersion: policyV,
          policySha256: policyHash,
        },
      });
    } catch {
      // do not block waitlist join if audit fails
    }

    return res.json({ ok: true, already: Boolean(existing?.id) });
  });

  // API diagnostic endpoint - check 1Forge API status and cache state
  app.get("/api/diagnostics/price-feed", async (_req: Request, res: Response) => {
    try {
      const forgeKeyPresent = Boolean(process.env.FORGE_KEY);
      const forgeKeyLength = process.env.FORGE_KEY?.length || 0;

      // Try to get cache stats from quote feed module
      let cacheStats = { cacheSize: 0, lastSuccessfulApiCall: 0, consecutiveApiFailures: 0, staleCount: 0 };
      try {
        const { getCacheStats } = await import("../feeds/quoteFeed");
        cacheStats = getCacheStats();
      } catch (e) {
        console.error("Error getting cache stats:", e);
      }

      // Get current quotes from database
      let quotesInfo = { count: 0, latestUpdate: null as number | null, symbols: [] as string[] };

      try {
        const quoteRows = await db
          .select({
            symbol: quotes.symbol,
            updatedAt: quotes.updatedAt,
          })
          .from(quotes)
          .orderBy(desc(quotes.updatedAt));

        quotesInfo = {
          count: quoteRows.length,
          latestUpdate: quoteRows[0]?.updatedAt ?? null,
          symbols: quoteRows.map(q => q.symbol),
        };
      } catch (e) {
        console.error("Error getting quotes info:", e);
      }

      // Calculate time since last API update
      const now = Date.now();
      const timeSinceLastUpdate = cacheStats.lastSuccessfulApiCall > 0
        ? Math.round((now - cacheStats.lastSuccessfulApiCall) / 1000)
        : null;

      res.json({
        status: forgeKeyPresent ? "configured" : "missing_api_key",
        apiKeyPresent: forgeKeyPresent,
        apiKeyLength: forgeKeyLength,
        environment: process.env.NODE_ENV || "development",
        cache: {
          ...cacheStats,
          timeSinceLastUpdateSeconds: timeSinceLastUpdate,
        },
        database: quotesInfo,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
