// @ts-nocheck
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { onLiveEvent, publishLiveEvent } from "./services/liveBus";
import { storage } from "./storage";
import { z } from "zod";
import { applyQuoteUpdate, getQuote, getQuoteMeta, getQuoteSnapshot, getValkeyQuoteRows, getValkeySnapshot } from "./services/quoteHub";
import { loginSchema, insertTradeSchema, tradeAudit, trades, globalSettings, userKycProfiles, userPayoutProfiles, emailVerificationTokens, systemConfig, signupFreezeAttempts, signupWaitlist, users, signupFingerprints, userAccountEvents, userSessions, quotes } from "@shared/schema";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { appendIdentityAudit } from "./services/identityAudit";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, dbClient } from "@db";
import { isPostgres } from "@db/config";
import session from "express-session";
import cookie from "cookie";
import signature from "cookie-signature";
import { resolveSessionStore } from "./services/sessionStore";
import { registerAdminRoutes } from "./routes/admin";
import { registerMarketRoutes } from "./routes/market";
import instrumentsRouter from "./routes/instruments";
import { profileMfaRouter } from "./routes/profileMfa";
import { verificationRouter } from "./routes/verification";
import legalRouter from "./routes/legal";
import adminLegalRouter from './routes/adminLegal';
import { adminLegalDocsRouter } from './routes/adminLegalDocs';
import { adminLegalAcceptancesRouter } from './routes/adminLegalAcceptances';
import { adminMarketDataRouter } from "./routes/adminMarketData";
import { adminSystemConfigRouter } from './routes/adminSystemConfig';
import { adminMigrationRouter } from './routes/adminMigration';
import { adminActivityRouter } from "./routes/adminActivity";
import { adminQuoteSubscriptionsRouter } from "./routes/adminQuoteSubscriptions";
import { registerMetaRoutes } from "./routes/meta";
import { registerMeSessionsRoutes } from "./routes/meSessions";
import { registerAdminSecurityRoutes } from "./routes/adminSecurity";
import { registerGriftRoutes } from "./routes/grift";
import { griftPublicRouter } from "./grift/griftPublicRouter";
import { extractGriftContext } from "./grift/griftGeo";
import { onLoginSuccess, onSessionActivity, onTradeSubmit } from "./grift/griftEngine";
import { maybeApplyAutoEnforcement } from "./grift/griftAutoEnforcement";
import { getRecentLoginActivity, getActiveSessions, createUserSession, touchSession, recordLoginAttempt, endSession, revokeSession, revokeAllSessionsForUser, getClientIp, getUserAgent, buildGeoContext, parseDevice, extractClientIdentity, extractGeoHints } from "./security/sessionTrail";
import type { AuditContext as GriftAuditContext } from "./grift/griftTypes";
import { riskMiddleware, getEffectiveMinHoldSec } from "./risk";
import { impersonationGuard } from "./middleware/auth";
import { requirePolicy } from "./middleware/requirePolicy";
import { recalcAccount } from "./recalcAccount";
import { requiredMargin } from "./lib/margin";
import { getExecutionQuote } from "./services/quoteService";
import { applyUserBalanceDelta, releaseUserMargin, reserveUserMargin } from "./services/tradeAtomic";
import { realizedPnlUsd } from "./lib/realizedPnl";
import { computeCloseSettlementCosts, computeOpenSideCosts } from "./services/tradeCosts";
import { clearTradeExcursion, initTradeExcursion, resolveTradeExcursionForClose } from "./trades/excursionTracking";
import { buildAuditContext, type AuditContext } from "./lib/auditContext";
import { writeOrderIntentAudit, writeTradeAudit, generateCorrelationId, generateOrderId, generateExecutionId, generatePositionId, calculateSpreadPips, calculateSlippagePips } from "./lib/auditWriter";
import { decidePolicy, featureGates } from "@shared/policyDecision";
import { buildDecisionContext } from "./policy/buildDecisionContext";
import { userVerification } from "@shared/schema";
import { loadPolicyConfig } from "./policy/getPolicyConfig";
import { promotePerformerIfEligible } from "./policy/performerPromotion";
import { defaultPaymentCurrencyForCountry } from "./utils/paymentCurrency";
import { evaluateLoginJurisdiction, evaluateSignupJurisdiction, recordSignupJurisdictionBlock } from "./policy/jurisdictionControl";
import { resolveCaptchaProvider, verifySignupCaptcha, SLIDER_CAPTCHA_ISSUE_TTL_MS, SLIDER_CAPTCHA_VERIFY_TTL_MS } from "./security/captcha";
import { hmacSign, sha256, stableStringify, verifyDoc1TermsToken } from "./legal/cryptoUtils";
import { LegalAcceptanceError, recordDoc1Acceptance } from "./legal/legalAcceptanceService";
import { computeDoc1ReacceptStatus, getDoc1ReacceptRequirement, upsertDoc1ReacceptRequirement } from "./legal/legalReacceptanceService";
import { captchaSliderRouter } from "./routes/captchaSlider";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { checkCoverage } from "./legal/coverageGate";
import { computeCurrentSessionDay } from "./utils/quoteSession";
import { ensureMarketDailyCloseTable } from "./utils/marketDailyClose";
import { getI18nConfig } from "./i18n/config";
import { i18nRouter } from "./routes/i18n";
import { adminI18nRouter } from "./routes/adminI18n";
import { quoteSubscriptionsRouter } from "./routes/quoteSubscriptions";
import { getGlobalSettingsCached, getMinPriceDistancePips, sanitizeMinPriceDistancePips } from "./services/globalSettings";
import { botGuard, persistBotAssessmentForUser } from "./security/botGuard";
import { getTrustedProxyCountryIso2 } from "./security/proxyHeaders";
import { jurisdictionSessionGuard } from "./middleware/jurisdictionSessionGuard";
import { withGriftClient } from "./grift/griftDb";
import { isMarketOpenForSymbol } from "./services/marketHours";
import { getPipSize, getQuoteDecimals } from "@shared/pips";
import { getProviderRateLimitStats } from "./marketdata/rateLimit";
import { getAllowedSymbolsForUser } from "./services/quoteSubscriptions";
import { mailboxRouter } from "./routes/mailbox";
import { notificationsRouter } from "./routes/notifications";
import { getMessagingMetrics, sendWelcomeMailboxMessage } from "./services/messaging";
import { adminChallengesRouter, adminPartnersRouter, adminScoutRouter } from "./routes/adminScout";
import { partnerAuthRouter, partnerPortalRouter } from "./routes/partnerPortal";
import { traderTalentRouter } from "./routes/traderTalent";

/**
 * Precision-aware price comparison utilities for forex trading.
 * Converts prices to integer ticks to avoid floating-point precision issues.
 * Handles truncated decimals (e.g., 0.67 = 0.6700) correctly.
 */
function getPrecision(symbol: string): number {
  // Deprecated: prefer passing a precision derived from symbol_config.quoteDecimals.
  return symbol.includes("JPY") ? 2 : 4;
}

function toTicks(price: number, precision: number): number {
  // Convert to integer ticks for precise comparison
  // e.g., 0.6700 with precision 4 → 6700, 0.6698 → 6698
  const multiplier = Math.pow(10, precision);
  return Math.round(price * multiplier);
}

function ticksToPrice(ticks: number, precision: number): number {
  return ticks / Math.pow(10, precision);
}

// Precision-aware comparison: returns true if priceA < priceB
function priceLessThan(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) < toTicks(priceB, precision);
}

// Precision-aware comparison: returns true if priceA > priceB
function priceGreaterThan(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) > toTicks(priceB, precision);
}

// Precision-aware comparison: returns true if priceA <= priceB
function priceLessThanOrEqual(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) <= toTicks(priceB, precision);
}

// Precision-aware comparison: returns true if priceA >= priceB
function priceGreaterThanOrEqual(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) >= toTicks(priceB, precision);
}

function normalizeLanguagePreference(value: string | undefined): { normalized: string; matched: boolean } {
  const cfg = getI18nConfig();
  const defaultLocale = String(cfg.defaultLocale || "en");
  const supported = cfg.supportedLocales?.length ? cfg.supportedLocales : [defaultLocale];
  const raw = String(value || "").trim();

  if (!raw) return { normalized: defaultLocale, matched: false };

  const exact = supported.find((locale) => locale.toLowerCase() === raw.toLowerCase());
  if (exact) return { normalized: exact, matched: true };

  const base = raw.split("-")[0].toLowerCase();
  const baseMatch = supported.find((locale) => locale.toLowerCase() === base);
  if (baseMatch) return { normalized: baseMatch, matched: true };

  return { normalized: defaultLocale, matched: false };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Create session store with Postgres persistence
const SESSION_COOKIE_NAME = "connect.sid";
const SESSION_SECRET = requireEnv("SESSION_SECRET");

// Prometheus counters (process-local; scraped via /metrics).
let metricTradeCloseRejectedQuoteStaleTotal = 0;
let metricTradeTargetsRejectedQuoteStaleTotal = 0;
let metricWsQuotePermissionRefreshTotal = 0;
let metricWsQuotePermissionRefreshErrorsTotal = 0;

declare module "express-session" {
  interface SessionData {
    userId: number;
    email: string;
    isAdmin: boolean;
    userCountryIso2?: string;
    ipCountryIso2?: string;
    // View As impersonation fields
    isImpersonating?: boolean;
    realAdminId?: number;
    realAdminEmail?: string;
    impersonatedUserId?: number;
    impersonationStartedAt?: number; // Unix timestamp for TTL tracking
    captchaSlider?: {
      id: string;
      issuedAtMs: number;
      verifiedAtMs: number | null;
      consumedAtMs: number | null;
      ip?: string | null;
      userAgent?: string | null;
    } | null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const sessionStoreResolved = await resolveSessionStore();
  const sessionStore = sessionStoreResolved.store;
  console.log(`[Session] store=${sessionStoreResolved.kind}`);

  const cookieSecure =
    process.env.COOKIE_SECURE === "true"
      ? true
      : process.env.COOKIE_SECURE === "false"
        ? false
        : process.env.NODE_ENV === "production";

  // Configure session persistence to prevent session loss on server restart
  app.use(
    session({
      store: sessionStore,
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      name: SESSION_COOKIE_NAME,
      cookie: {
        secure: cookieSecure,
        httpOnly: true,
        sameSite: (process.env.COOKIE_SAMESITE as "lax" | "strict" | "none") || "lax",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  );

  // Apply impersonation guard globally immediately after session middleware
  // This ensures write operations are blocked during View As mode for ALL routes
  app.use("/api", impersonationGuard);

  // Apply jurisdiction guard globally so blocked jurisdictions lose access immediately
  app.use("/api", jurisdictionSessionGuard);

  // Slider CAPTCHA endpoints (server-bound session state)
  app.use("/api/captcha", captchaSliderRouter);

  // Authentication middleware helper
  const ensureAuth = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Check if session has been revoked
    const sessionId = req.sessionID;
    if (sessionId) {
      const [sessionRow] = await db
        .select({ revokedAt: userSessions.revokedAt })
        .from(userSessions)
        .where(and(eq(userSessions.sessionId, sessionId), eq(userSessions.userId, req.session.userId)))
        .limit(1);

      if (sessionRow?.revokedAt) {
        // Session has been revoked - destroy it and reject
        req.session.destroy(() => { });
        return res.status(401).json({
          message: "Session has been terminated",
          code: "SESSION_REVOKED"
        });
      }

      // Touch session to update lastActiveAt (only for non-revoked sessions)
      try {
        await touchSession(sessionId);
      } catch {
        // Ignore touch errors
      }
    }

    next();
  };

  // Legal re-acceptance gate (DOC1): blocks trade actions when terms have changed since last acceptance.
  const ensureDoc1TermsAccepted = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    try {
      const status = await computeDoc1ReacceptStatus(userId);

      if (status.blocked) {
        await upsertDoc1ReacceptRequirement({ userId, detectedBy: "TRADE", status });
        (req.session as any).legalReacceptRequired = true;

        const code = status.blockedReason || "LEGAL_COVERAGE_BLOCKED";
        const httpStatus =
          code === "JURISDICTION_RESTRICTED" ? 403 : 409;

        return res.status(httpStatus).json({ message: code, code, blockedReason: status.blockedReason });
      }

      if (status.required) {
        await upsertDoc1ReacceptRequirement({ userId, detectedBy: "TRADE", status });
        (req.session as any).legalReacceptRequired = true;
        return res.status(409).json({
          message: "LEGAL_REACCEPT_REQUIRED",
          code: "LEGAL_REACCEPT_REQUIRED",
          docSet: "DOC1",
          countryIso2: status.countryIso2,
          regionKey: status.regionKey,
          requiredCombinedSha256: status.requiredCombinedSha256,
          lastAcceptedCombinedSha256: status.lastAcceptedCombinedSha256,
        });
      }

      await upsertDoc1ReacceptRequirement({ userId, detectedBy: "TRADE", status });
      (req.session as any).legalReacceptRequired = false;
      return next();
    } catch (e: any) {
      console.error("[Legal] Re-acceptance gate failed:", e);
      return res.status(500).json({ message: "LEGAL_REACCEPT_CHECK_FAILED" });
    }
  };

  const getSignupPublicConfig = async () => {
    const [row] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    const waitlistPolicyContent = String((row as any)?.signupWaitlistPolicyContent ?? "");
    const waitlistPolicyVersion = String((row as any)?.signupWaitlistPolicyVersion ?? "1");
    const waitlistPolicySha256 = sha256(waitlistPolicyContent);

    const enforceSignupCaptcha = Boolean(row?.signupCaptchaEnforce ?? true);
    const selectedCaptchaProvider = String(row?.captchaProvider ?? "SLIDER").toUpperCase() as any;
    const captchaProvider = resolveCaptchaProvider(selectedCaptchaProvider).provider;

    return {
      captcha: {
        enforceSignupCaptcha,
        provider: captchaProvider,
      },
      signupPhoneEnforce: true,
      // Signup freeze + invite waitlist
      signupsFrozen: Boolean((row as any)?.signupFreeze ?? false),
      signupFreezeMessage: String(
        (row as any)?.signupFreezeMessage ??
        "Signups are temporarily paused due to capacity. Existing users can still log in."
      ),
      waitlistEnabled: Boolean((row as any)?.signupWaitlistEnabled ?? true),
      waitlistPolicyVersion,
      waitlistPolicySha256,
    } as const;
  };

  const requireVerifiedSliderCaptcha = (req: Request): { ok: true } | { ok: false; message: string } => {
    const now = Date.now();
    const slider: any = (req.session as any)?.captchaSlider;

    if (!slider?.id || typeof slider.issuedAtMs !== "number") {
      return { ok: false, message: "CAPTCHA_REQUIRED" };
    }

    if (now - slider.issuedAtMs > SLIDER_CAPTCHA_ISSUE_TTL_MS) {
      return { ok: false, message: "CAPTCHA_EXPIRED" };
    }

    if (!slider.verifiedAtMs || typeof slider.verifiedAtMs !== "number") {
      return { ok: false, message: "CAPTCHA_REQUIRED" };
    }

    if (now - slider.verifiedAtMs > SLIDER_CAPTCHA_VERIFY_TTL_MS) {
      return { ok: false, message: "CAPTCHA_EXPIRED" };
    }

    if (slider.consumedAtMs) {
      return { ok: false, message: "CAPTCHA_ALREADY_USED" };
    }

    slider.consumedAtMs = now;
    (req.session as any).captchaSlider = slider;
    return { ok: true };
  };

  const normalizeSignupPhone = (phone: string | undefined | null, countryIso2: string) => {
    if (!phone) return { ok: true, e164: null };
    try {
      const parsed = parsePhoneNumberFromString(phone, countryIso2 as any);
      if (!parsed || !parsed.isValid()) return { ok: false, e164: null };
      return { ok: true, e164: parsed.number.toString() };
    } catch {
      return { ok: false, e164: null };
    }
  };

  // API status endpoint - moved from root to not conflict with frontend
  app.get("/api/status", (req: Request, res: Response) => {
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
        updatedAt: globalSettings.updatedAt,
      }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1);

      const lotDropdownMax = clampInt(settings?.lotDropdownMax, 1, ABSOLUTE_MAX_LOTS, ABSOLUTE_MAX_LOTS);
      const minPriceDistancePips = sanitizeMinPriceDistancePips(settings?.minPriceDistancePips);

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
    const [row] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    const version = String((row as any)?.signupWaitlistPolicyVersion ?? "1");
    const content = String((row as any)?.signupWaitlistPolicyContent ?? "");
    return res.json({ ok: true, version, sha256: sha256(content), content });
  });

  // Public invite waitlist join (when signups are frozen)
  app.post("/api/waitlist", async (req: Request, res: Response) => {
    const [row] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
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

    const enforceCaptcha = Boolean(row?.signupCaptchaEnforce ?? true);
    const selectedCaptchaProvider = String(row?.captchaProvider ?? "SLIDER").toUpperCase() as any;
    const captchaProvider = resolveCaptchaProvider(selectedCaptchaProvider).provider;

    if (enforceCaptcha && captchaProvider === "SLIDER") {
      const sliderResult = requireVerifiedSliderCaptcha(req);
      if (!sliderResult.ok) return res.status(400).json({ ok: false, error: sliderResult.message });
    } else {
      const captchaResult = await verifySignupCaptcha(req, captchaToken);
      if (!captchaResult.ok) return res.status(400).json({ ok: false, error: captchaResult.message });
    }

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
      .select()
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
  app.get("/api/diagnostics/price-feed", async (req: Request, res: Response) => {
    try {
      const forgeKeyPresent = Boolean(process.env.FORGE_KEY);
      const forgeKeyLength = process.env.FORGE_KEY?.length || 0;

      // Try to get cache stats from quote feed module
      let cacheStats = { cacheSize: 0, lastSuccessfulApiCall: 0, consecutiveApiFailures: 0, staleCount: 0 };
      try {
        const { getCacheStats } = await import('./feeds/quoteFeed');
        cacheStats = getCacheStats();
      } catch (e) {
        console.error('Error getting cache stats:', e);
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
        console.error('Error getting quotes info:', e);
      }

      // Calculate time since last API update
      const now = Date.now();
      const timeSinceLastUpdate = cacheStats.lastSuccessfulApiCall > 0
        ? Math.round((now - cacheStats.lastSuccessfulApiCall) / 1000)
        : null;

      res.json({
        status: forgeKeyPresent ? 'configured' : 'missing_api_key',
        apiKeyPresent: forgeKeyPresent,
        apiKeyLength: forgeKeyLength,
        environment: process.env.NODE_ENV || 'development',
        cache: {
          ...cacheStats,
          timeSinceLastUpdateSeconds: timeSinceLastUpdate
        },
        database: quotesInfo,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });


  // Authentication endpoints
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const ip = getClientIp(req);
      const userAgent = getUserAgent(req);
      const clientIdentity = extractClientIdentity(req);
      const geoHints = extractGeoHints(req);
      const geoContext = buildGeoContext(ip, geoHints);

      const bg = await botGuard(req, res, { action: "LOGIN", email });
      if (!bg.allowed) return;

      const user = await storage.verifyUser(email, password);

      if (!user) {
        await recordLoginAttempt({
          email,
          ip,
          userAgent,
          identity: clientIdentity,
          geo: geoContext,
          success: false,
          failureReason: "Invalid credentials",
        });
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if ((user as any).isDeleted) {
        await recordLoginAttempt({
          userId: user.id,
          email,
          ip,
          userAgent,
          identity: clientIdentity,
          geo: geoContext,
          success: false,
          failureReason: "Account deleted",
        });
        return res.status(403).json({ message: "Account has been deleted.", code: "ACCOUNT_DELETED" });
      }

      if (user.isDisabled) {
        await recordLoginAttempt({
          userId: user.id,
          email,
          ip,
          userAgent,
          identity: clientIdentity,
          geo: geoContext,
          success: false,
          failureReason: "Account disabled",
        });
        return res.status(403).json({ message: "Account is disabled. Please contact support." });
      }

      if ((user as any).isFrozen) {
        await recordLoginAttempt({
          userId: user.id,
          email,
          ip,
          userAgent,
          identity: clientIdentity,
          geo: geoContext,
          success: false,
          failureReason: "Account frozen",
        });
        return res.status(403).json({
          message: "Account is frozen. Please contact support.",
          reasonCode: (user as any).freezeReasonCode
        });
      }

      // Jurisdiction control (sanctions / restricted countries)
      const ipCountryIso2 =
        getTrustedProxyCountryIso2(req) ??
        (geoContext.countryCode ? geoContext.countryCode.toUpperCase() : undefined);

      const userCountryIso2 =
        (user as any).countryIso2 && /^[A-Za-z]{2}$/.test(String((user as any).countryIso2).trim())
          ? String((user as any).countryIso2).trim().toUpperCase()
          : (user as any).country && /^[A-Za-z]{2}$/.test(String((user as any).country).trim())
            ? String((user as any).country).trim().toUpperCase()
            : undefined;

      // Enforce only for non-admin logins (admins can still access)
      if (!user.isAdmin) {
        const loginJ = evaluateLoginJurisdiction({
          ipCountryIso2,
          userCountryIso2: userCountryIso2 ?? null,
        });

        if (!loginJ.allowed) {
          await recordLoginAttempt({
            userId: user.id,
            email,
            ip,
            userAgent,
            identity: clientIdentity,
            geo: geoContext,
            success: false,
            failureReason: loginJ.reasonCode,
          });

          return res.status(loginJ.httpStatus).json({
            message: loginJ.message,
            code: loginJ.code,
            reasonCode: loginJ.reasonCode,
            blockedBy: loginJ.blockedBy,
            ipCountryIso2: loginJ.ipCountryIso2 ?? null,
            userCountryIso2: loginJ.selectedCountryIso2 ?? null,
          });
        }
      }

      try {
        await persistBotAssessmentForUser({ userId: user.id, score: bg.score, signals: bg.signals });
      } catch (e) {
        console.error("Failed to persist bot risk assessment:", e);
      }

      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.isAdmin = user.isAdmin;
      req.session.userCountryIso2 = userCountryIso2;
      req.session.ipCountryIso2 = ipCountryIso2;

      const { geo } = await createUserSession({
        sessionId: req.sessionID,
        userId: user.id,
        email: user.email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
      });

      let griftAutoEnforcement: any = null;
      if (isPostgres) {
        try {
          const griftCtx = extractGriftContext(req);
          await withGriftClient(async (griftDb) => {
            const griftAuditCtx: GriftAuditContext = {
              ts: Date.now(),
              userId: user.id,
              sessionId: req.sessionID,
              deviceId: griftCtx.deviceId ?? undefined,
              deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
              deviceFp: griftCtx.deviceFp ?? undefined,
              deviceInstallId: griftCtx.deviceInstallId ?? undefined,
              clientTz: griftCtx.clientTz ?? undefined,
              clientLang: griftCtx.clientLang ?? undefined,
              eventType: "LOGIN_SUCCESS",
              ip: griftCtx.ip ?? undefined,
              userAgent: griftCtx.userAgent ?? undefined,
              geoCountry: griftCtx.geoCountry ?? undefined,
              geoRegion: griftCtx.geoRegion ?? undefined,
              geoCity: griftCtx.geoCity ?? undefined,
              latitude: griftCtx.latitude ?? undefined,
              longitude: griftCtx.longitude ?? undefined,
              asn: griftCtx.asn ?? undefined,
              org: griftCtx.org ?? undefined,
            };

            // Run all detection rules via onLoginSuccess
            await onLoginSuccess(griftDb, griftAuditCtx);

            // Optional auto-enforcement (freeze/disable) based on admin-configured thresholds.
            try {
              griftAutoEnforcement = await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
            } catch (enfErr) {
              console.error("[Grift] Auto-enforcement failed:", enfErr);
            }
          });
        } catch (griftErr) {
          console.error("[Grift] Failed to capture login context:", griftErr);
        }
      }

      if (griftAutoEnforcement?.applied && griftAutoEnforcement?.newStatus && griftAutoEnforcement.newStatus !== "ACTIVE") {
        const statusMsg =
          griftAutoEnforcement.newStatus === "DISABLED"
            ? "Account is disabled due to integrity review. Please contact support."
            : "Account is frozen due to integrity review. Please contact support.";

        return req.session.destroy(() =>
          res.status(403).json({
            message: statusMsg,
            reasonCode: "GRIFT_AUTO_ENFORCEMENT",
            enforcement: griftAutoEnforcement,
          })
        );
      }

      const verificationLogin = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, user.id),
      });

      const emailVerifiedLogin = !!verificationLogin?.emailVerifiedAt;
      const gracePeriodMsLogin = 14 * 24 * 60 * 60 * 1000;
      const createdAtMsLogin = typeof user.createdAt === 'number'
        ? ((user.createdAt as number) < 1e12 ? (user.createdAt as number) * 1000 : user.createdAt)
        : new Date(user.createdAt as any).getTime();
      const gracePeriodEndsAtLogin = createdAtMsLogin + gracePeriodMsLogin;
      const inGracePeriodLogin = !emailVerifiedLogin && Date.now() < gracePeriodEndsAtLogin;

      let legalReacceptRequired = false;
      let legalReacceptBlocked = false;
      let legalReacceptBlockedReason: string | null = null;
      let legalRequiredCombinedSha256: string | null = null;
      let legalLastAcceptedCombinedSha256: string | null = null;
      try {
        const status = await computeDoc1ReacceptStatus(user.id);
        legalReacceptRequired = !!status.required;
        legalReacceptBlocked = !!status.blocked;
        legalReacceptBlockedReason = status.blockedReason ?? null;
        legalRequiredCombinedSha256 = status.requiredCombinedSha256 ?? null;
        legalLastAcceptedCombinedSha256 = status.lastAcceptedCombinedSha256 ?? null;
        await upsertDoc1ReacceptRequirement({ userId: user.id, detectedBy: "LOGIN", status });
        (req.session as any).legalReacceptRequired = legalReacceptRequired || legalReacceptBlocked;
      } catch (e) {
        console.error("[Legal] Failed to compute re-acceptance status on login:", e);
      }

      res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        phone: user.phone || "",
        countryIso2: user.countryIso2 || null,
        language: (user as any).language || "en",
        balance: user.balance,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
        emailVerified: emailVerifiedLogin,
        emailVerifiedAt: verificationLogin?.emailVerifiedAt || null,
        inGracePeriod: inGracePeriodLogin,
        gracePeriodEndsAt: inGracePeriodLogin ? gracePeriodEndsAtLogin : null,
        legalReacceptRequired,
        legalReacceptBlocked,
        legalReacceptBlockedReason,
        legalRequiredCombinedSha256,
        legalLastAcceptedCombinedSha256,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const ip = getClientIp(req);
      const userAgent = getUserAgent(req);

      const signupCfg = await getSignupPublicConfig();

      // Hard stop: when signups are frozen, block registration but still log attempts.
      if (signupCfg.signupsFrozen) {
        const nowSec = Math.floor(Date.now() / 1000);
        const emailRaw = typeof (req.body as any)?.email === "string" ? String((req.body as any).email) : "";
        const usernameRaw = typeof (req.body as any)?.username === "string" ? String((req.body as any).username) : "";
        const emailLower = emailRaw ? emailRaw.trim().toLowerCase() : null;

        try {
          await db.insert(signupFreezeAttempts)
            .values({
              email: emailRaw || null,
              emailLower,
              username: usernameRaw || null,
              ip,
              userAgent,
              createdAt: nowSec,
            });
        } catch (e) {
          console.warn("Failed to record signup freeze attempt:", e);
        }

        return res.status(403).json({
          message: "SIGNUPS_FROZEN",
          error: "SIGNUPS_FROZEN",
          signupFreezeMessage: signupCfg.signupFreezeMessage,
          waitlistEnabled: signupCfg.waitlistEnabled,
        });
      }

      const schema = z.object({
        email: z.string().email(),
        username: z.string().min(3),
        password: z.string().min(8).max(25),
        countryIso2: z.string().length(2).toUpperCase(),
        termsToken: z.string().min(10),
        combinedSha256: z.string().min(10),
        captchaToken: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
      });

      const { email, username, password, countryIso2, termsToken, combinedSha256, captchaToken, phone } = schema.parse(req.body);
      const clientIdentity = extractClientIdentity(req);

      // Jurisdiction control (sanctions / restricted countries)
      const geoHints = extractGeoHints(req);
      const geoContext = buildGeoContext(ip, geoHints);

      const ipCountryIso2 =
        getTrustedProxyCountryIso2(req) ??
        (geoContext.countryCode ? geoContext.countryCode.toUpperCase() : undefined);

      const signupJ = evaluateSignupJurisdiction({
        ipCountryIso2,
        selectedCountryIso2: countryIso2,
      });

      if (!signupJ.allowed) {
        const nowSec = Math.floor(Date.now() / 1000);
        await recordSignupJurisdictionBlock({
          email,
          username,
          ip,
          userAgent,
          ipCountryIso2: signupJ.ipCountryIso2 ?? null,
          selectedCountryIso2: signupJ.selectedCountryIso2 ?? null,
          reasonCode: signupJ.reasonCode,
          policySnapshot: { identity: clientIdentity },
          createdAtSec: nowSec,
        });

        return res.status(signupJ.httpStatus).json({
          message: signupJ.message,
          code: signupJ.code,
          reasonCode: signupJ.reasonCode,
          blockedBy: signupJ.blockedBy,
          ipCountryIso2: signupJ.ipCountryIso2 ?? null,
          selectedCountryIso2: signupJ.selectedCountryIso2 ?? null,
        });
      }

      const bg = await botGuard(req, res, { action: "SIGNUP", email });
      if (!bg.allowed) return;

      const enforceCaptcha = Boolean(signupCfg.captcha.enforceSignupCaptcha);
      const captchaProvider = String(signupCfg.captcha.provider || "TURNSTILE").toUpperCase();

      if (enforceCaptcha && captchaProvider === "SLIDER") {
        const sliderResult = requireVerifiedSliderCaptcha(req);
        if (!sliderResult.ok) {
          return res.status(400).json({ message: sliderResult.message });
        }
      } else {
        const captchaResult = await verifySignupCaptcha(req, captchaToken);
        if (!captchaResult.ok) {
          return res.status(400).json({ message: captchaResult.message });
        }
      }

      const cov = await checkCoverage(countryIso2);
      if (cov.enforced && !cov.allowed) {
        return res.status(409).json({ message: "LEGAL_COVERAGE_MISSING" });
      }

      const tokenCheck = verifyDoc1TermsToken(termsToken, {
        expectedCountryIso2: countryIso2,
        maxAgeMs: 24 * 60 * 60 * 1000,
      });
      if (!tokenCheck.ok) {
        return res.status(400).json({ message: tokenCheck.error });
      }
      if (tokenCheck.payload.combinedSha256 !== combinedSha256) {
        return res.status(400).json({ message: "TERMS_COMBINED_SHA_MISMATCH" });
      }
      const regionKey: string | null = tokenCheck.payload.regionKey ?? null;

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "User already exists" });
      }

      const phoneRequired = true;
      const normalizedPhone = normalizeSignupPhone(phone ?? undefined, countryIso2);
      if (!normalizedPhone.ok) {
        return res.status(400).json({ message: "PHONE_INVALID" });
      }
      if (phoneRequired && !normalizedPhone.e164) {
        return res.status(400).json({ message: "PHONE_REQUIRED" });
      }

      // Build signup fingerprint data for grift detection and audit
      const deviceContext = parseDevice(userAgent);
      const signupFingerprint = {
        requestId: crypto.randomUUID(),
        ip,
        userAgent,
        geo: {
          countryCode: geoContext.countryCode,
          region: geoContext.region,
          city: geoContext.city,
          latitude: geoContext.latitude,
          longitude: geoContext.longitude,
          inferredTz: geoContext.inferredTz,
        },
        device: {
          deviceType: deviceContext.deviceType,
          browser: deviceContext.browser,
          os: deviceContext.os,
        },
        identity: {
          deviceFp: clientIdentity.deviceFp,
          deviceInstallId: clientIdentity.deviceInstallId,
          clientTz: clientIdentity.clientTz,
          clientLang: clientIdentity.clientLang,
        },
        countryIso2Selected: countryIso2,
        regionKeySelected: regionKey ?? undefined,
      };

      const user = await storage.createUser({
        email,
        username,
        password,
        balance: "1000000.00",
        countryIso2: countryIso2 ?? null,
        regionKey: regionKey ?? null,
        phone: normalizedPhone.e164 ?? null,
        fingerprint: signupFingerprint,
      });

      // Record legal acceptance (MANDATORY - already validated above)
      try {
        await recordDoc1Acceptance({
          userId: user.id,
          emailAtAcceptance: email,
          countryIso2,
          ipAddress: ip,
          userAgent,
          sessionId: req.sessionID,
          termsToken,
          combinedSha256,
          verifiedPayload: tokenCheck.payload,
        });
      } catch (acceptErr: any) {
        const code = acceptErr instanceof LegalAcceptanceError ? acceptErr.code : "LEGAL_ACCEPTANCE_RECORD_FAILED";
        console.error("[Legal] Failed to record acceptance. Rolling back signup:", code, acceptErr?.message || acceptErr);
        console.error("[Legal] Full error details:", acceptErr);
        if (acceptErr?.stack) console.error("[Legal] Stack trace:", acceptErr.stack);

        // Fail-closed: do not allow an account to exist without an acceptance row.
        try {
          await db.transaction(async (tx) => {
            try { await tx.delete(signupFingerprints).where(eq(signupFingerprints.userId, user.id)); } catch { }
            try { await tx.delete(userAccountEvents).where(eq(userAccountEvents.userId, user.id)); } catch { }
            try { await tx.delete(userVerification).where(eq(userVerification.userId, user.id)); } catch { }
            try { await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id)); } catch { }
            try { await tx.delete(users).where(eq(users.id, user.id)); } catch { }
          });
        } catch (rollbackErr) {
          console.error("[Legal] Signup rollback failed:", rollbackErr);
        }

        return res.status(500).json({ message: code });
      }

      try {
        await persistBotAssessmentForUser({ userId: user.id, score: bg.score, signals: bg.signals });
      } catch (e) {
        console.error("Failed to persist bot risk assessment:", e);
      }

      // If this email was on the waitlist, mark it as converted (only after successful signup + acceptance).
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const emailLower = String(email).trim().toLowerCase();
        await db.update(signupWaitlist)
          .set({
            status: "CONVERTED",
            convertedAt: nowSec,
            convertedUserId: user.id,
            updatedAt: nowSec,
          })
          .where(eq(signupWaitlist.emailLower, emailLower));
      } catch (e) {
        console.warn("Failed to mark waitlist conversion:", e);
      }

      try {
        await db.insert(userVerification).values({
          userId: user.id,
          phoneE164: normalizedPhone.e164,
          contenderTier: "NONE",
          smsEnabled: false,
          smsVerifiedAt: null,
          smsVerifyFailCount: 0,
        }).onConflictDoUpdate({
          target: userVerification.userId,
          set: {
            phoneE164: normalizedPhone.e164,
            smsVerifiedAt: null,
            smsVerifyFailCount: 0,
            smsEnabled: false,
          },
        });
      } catch (verificationError) {
        console.error("Failed to initialize user_verification:", verificationError);
      }

      // Generate and send verification email automatically on registration
      try {
        const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
        const token = crypto.randomBytes(32).toString("hex");

        // Hash the token (HMAC if secret available, else SHA256)
        const emailSecret = process.env.EMAIL_VERIFY_TOKEN_SECRET;
        const tokenHash = emailSecret
          ? crypto.createHmac("sha256", emailSecret).update(token).digest("hex")
          : crypto.createHash("sha256").update(token).digest("hex");

        const tokenId = crypto.randomUUID();
        const expiresAt = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600;

        // Store token in email_verification_tokens table
        await db.insert(emailVerificationTokens).values({
          id: tokenId,
          userId: user.id,
          tokenHash,
          purpose: "VERIFY",
          expiresAt,
        });

        // Send verification email via Resend API
        const resendApiKey = process.env.RESEND_API_KEY;
        let emailSent = false;

        if (resendApiKey) {
          const verifyUrl = `${process.env.APP_URL || "http://localhost:5000"}/api/verification/email/verify?token=${token}`;

          try {
            const emailResponse = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: process.env.EMAIL_FROM || "TradeQuip <noreply@tradequip.com>",
                to: [email],
                subject: "Verify your TradeQuip email address",
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #1a1a2e;">Welcome to TradeQuip!</h2>
                    <p>Thank you for registering. Please verify your email address to get started:</p>
                    <a href="${verifyUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                      Verify Email
                    </a>
                    <p style="color: #666; font-size: 14px;">This link expires in ${VERIFICATION_TOKEN_EXPIRY_HOURS} hours.</p>
                    <p style="color: #666; font-size: 12px;">If you didn't create this account, please ignore this email.</p>
                  </div>
                `,
              }),
            });

            const emailData = await emailResponse.json();
            if (emailResponse.ok) {
              emailSent = true;
              console.log("Registration verification email sent:", { id: emailData.id, to: email });
            } else {
              console.error("Resend API error during registration:", emailData);
            }
          } catch (emailError) {
            console.error("Error sending registration verification email:", emailError);
          }
        } else {
          console.warn("RESEND_API_KEY not configured, skipping verification email");
        }

        // Log to identity_audit
        appendIdentityAudit({
          userId: user.id,
          email: user.email,
          username: user.username,
          category: "VERIFICATION",
          type: emailSent ? "EMAIL_VERIFICATION_SENT" : "EMAIL_SEND_FAILED",
          title: emailSent ? "Registration verification email sent" : "Registration email send failed",
          description: emailSent ? "Automatic verification email on registration" : "RESEND_API_KEY missing or API error",
          ip,
          userAgent,
        });
      } catch (emailTokenError) {
        console.error("Failed to send registration verification email:", emailTokenError);
        // Don't fail registration if email fails - user can request resend
      }

      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.isAdmin = Boolean(user.isAdmin);
      req.session.userCountryIso2 = user.countryIso2 || undefined;
      req.session.ipCountryIso2 = ipCountryIso2;

      const { geo } = await createUserSession({
        sessionId: req.sessionID,
        userId: user.id,
        email: user.email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
      });

      let griftAutoEnforcement: any = null;
      if (isPostgres) {
        try {
          const griftCtx = extractGriftContext(req);
          await withGriftClient(async (griftDb) => {
            const griftAuditCtx: GriftAuditContext = {
              ts: Date.now(),
              userId: user.id,
              sessionId: req.sessionID,
              deviceId: griftCtx.deviceId ?? undefined,
              deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
              deviceFp: griftCtx.deviceFp ?? undefined,
              deviceInstallId: griftCtx.deviceInstallId ?? undefined,
              clientTz: griftCtx.clientTz ?? undefined,
              clientLang: griftCtx.clientLang ?? undefined,
              eventType: "LOGIN_SUCCESS",
              ip: griftCtx.ip ?? undefined,
              userAgent: griftCtx.userAgent ?? undefined,
              geoCountry: griftCtx.geoCountry ?? undefined,
              geoRegion: griftCtx.geoRegion ?? undefined,
              geoCity: griftCtx.geoCity ?? undefined,
              latitude: griftCtx.latitude ?? undefined,
              longitude: griftCtx.longitude ?? undefined,
              asn: griftCtx.asn ?? undefined,
              org: griftCtx.org ?? undefined,
            };

            await onLoginSuccess(griftDb, griftAuditCtx);

            try {
              griftAutoEnforcement = await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
            } catch (enfErr) {
              console.error("[Grift] Auto-enforcement failed (registration):", enfErr);
            }
          });
        } catch (griftErr) {
          console.error("[Grift] Failed to capture registration context:", griftErr);
        }
      }

      if (griftAutoEnforcement?.applied && griftAutoEnforcement?.newStatus && griftAutoEnforcement.newStatus !== "ACTIVE") {
        const statusMsg =
          griftAutoEnforcement.newStatus === "DISABLED"
            ? "Account is disabled due to integrity review. Please contact support."
            : "Account is frozen due to integrity review. Please contact support.";

        return req.session.destroy(() =>
          res.status(403).json({
            message: statusMsg,
            reasonCode: "GRIFT_AUTO_ENFORCEMENT",
            enforcement: griftAutoEnforcement,
          })
        );
      }

      void sendWelcomeMailboxMessage(user.id).catch((mailErr) => {
        console.error("[mailbox] failed to send signup welcome message:", mailErr);
      });

      const gracePeriodMsReg = 14 * 24 * 60 * 60 * 1000;
      const createdAtMsReg = typeof user.createdAt === 'number'
        ? ((user.createdAt as number) < 1e12 ? (user.createdAt as number) * 1000 : user.createdAt)
        : new Date(user.createdAt as any).getTime();
      const gracePeriodEndsAtReg = createdAtMsReg + gracePeriodMsReg;

      res.status(201).json({
        id: user.id,
        email: user.email,
        username: user.username,
        countryIso2: user.countryIso2,
        language: (user as any).language || "en",
        phone: user.phone || "",
        balance: user.balance,
        createdAt: user.createdAt,
        emailVerified: false,
        emailVerifiedAt: null,
        inGracePeriod: true,
        gracePeriodEndsAt: gracePeriodEndsAtReg,
        legalReacceptRequired: false,
        legalReacceptBlocked: false,
        legalReacceptBlockedReason: null,
        legalRequiredCombinedSha256: null,
        legalLastAcceptedCombinedSha256: combinedSha256,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const userId = req.session.userId;
    const sessionId = req.sessionID;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    if (userId) {
      try {
        await endSession({ userId, sessionId, ip, userAgent, geo: buildGeoContext(ip, extractGeoHints(req)) });
      } catch (err) {
        console.error("Error recording logout:", err);
      }
    }

    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/current-user", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const user = await storage.getUserById(req.session.userId);

      if (!user) {
        req.session.destroy(() => { });
        return res.status(401).json({ message: "User not found" });
      }

      // Recalculate account metrics to ensure fresh data
      try {
        // Import directly here to avoid circular dependencies
        const { recalcAccount } = await import('./recalcAccount');
        await recalcAccount(user.id);

        // Fetch the user again to get updated metrics
        const updatedUser = await storage.getUserById(req.session.userId);

        if (updatedUser) {
          const verification = await db.query.userVerification.findFirst({
            where: eq(userVerification.userId, updatedUser.id),
          });

          const emailVerified = !!verification?.emailVerifiedAt;
          const gracePeriodMs = 14 * 24 * 60 * 60 * 1000;
          const createdAtMs = typeof updatedUser.createdAt === 'number'
            ? (updatedUser.createdAt < 1e12 ? updatedUser.createdAt * 1000 : updatedUser.createdAt)
            : new Date(updatedUser.createdAt as any).getTime();
          const gracePeriodEndsAt = createdAtMs + gracePeriodMs;
          const inGracePeriod = !emailVerified && Date.now() < gracePeriodEndsAt;

          let legalReacceptRequired = false;
          let legalRequiredCombinedSha256: string | null = null;
          let legalLastAcceptedCombinedSha256: string | null = null;
          try {
            const reqRow = await getDoc1ReacceptRequirement(updatedUser.id);
            if (reqRow) {
              legalReacceptRequired = true;
              legalRequiredCombinedSha256 = reqRow.requiredCombinedSha256;
              legalLastAcceptedCombinedSha256 = reqRow.lastAcceptedCombinedSha256;
            }
          } catch (e) {
            console.error("[Legal] Failed to load re-accept requirement:", e);
          }

          res.json({
            id: updatedUser.id,
            email: updatedUser.email,
            username: updatedUser.username,
            name: updatedUser.name || "",
            phone: updatedUser.phone || "",
            countryIso2: updatedUser.countryIso2 || null,
            language: (updatedUser as any).language || "en",
            balance: updatedUser.balance,
            isAdmin: updatedUser.isAdmin,
            equity: updatedUser.equity,
            freeMargin: updatedUser.freeMargin,
            usedMargin: updatedUser.usedMargin,
            leverage: updatedUser.leverage,
            createdAt: updatedUser.createdAt,
            // Tier system
            userTier: (updatedUser as any).userTier || "CANDIDATE",
            contenderTier: (updatedUser as any).contenderTier || null,
            // Verification status for reminder popup
            emailVerified,
            emailVerifiedAt: verification?.emailVerifiedAt || null,
            inGracePeriod,
            gracePeriodEndsAt: inGracePeriod ? gracePeriodEndsAt : null,
            legalReacceptRequired,
            legalReacceptBlocked: false,
            legalReacceptBlockedReason: null,
            legalRequiredCombinedSha256,
            legalLastAcceptedCombinedSha256,
            // View As impersonation status
            isImpersonating: req.session.isImpersonating || false,
            realAdminId: req.session.realAdminId || null,
            realAdminEmail: req.session.realAdminEmail || null,
          });
          return;
        }
      } catch (recalcError) {
        console.error("Error recalculating account metrics:", recalcError);
        // Continue with the original user data if recalc fails
      }

      // Fallback if recalc fails
      const verificationFallback = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, user.id),
      });

      const emailVerifiedFb = !!verificationFallback?.emailVerifiedAt;
      const gracePeriodMsFb = 14 * 24 * 60 * 60 * 1000;
      const createdAtMsFb = typeof user.createdAt === 'number'
        ? (user.createdAt < 1e12 ? user.createdAt * 1000 : user.createdAt)
        : new Date(user.createdAt as any).getTime();
      const gracePeriodEndsAtFb = createdAtMsFb + gracePeriodMsFb;
      const inGracePeriodFb = !emailVerifiedFb && Date.now() < gracePeriodEndsAtFb;

      let legalReacceptRequired = false;
      let legalRequiredCombinedSha256: string | null = null;
      let legalLastAcceptedCombinedSha256: string | null = null;
      try {
        const reqRow = await getDoc1ReacceptRequirement(user.id);
        if (reqRow) {
          legalReacceptRequired = true;
          legalRequiredCombinedSha256 = reqRow.requiredCombinedSha256;
          legalLastAcceptedCombinedSha256 = reqRow.lastAcceptedCombinedSha256;
        }
      } catch (e) {
        console.error("[Legal] Failed to load re-accept requirement:", e);
      }

      res.json({
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name || "",
        phone: user.phone || "",
        countryIso2: user.countryIso2 || null,
        language: (user as any).language || "en",
        balance: user.balance,
        isAdmin: user.isAdmin,
        equity: user.equity,
        freeMargin: user.freeMargin,
        usedMargin: user.usedMargin,
        leverage: user.leverage,
        createdAt: user.createdAt,
        // Tier system
        userTier: (user as any).userTier || "CANDIDATE",
        contenderTier: (user as any).contenderTier || null,
        // Verification status for reminder popup
        emailVerified: emailVerifiedFb,
        emailVerifiedAt: verificationFallback?.emailVerifiedAt || null,
        inGracePeriod: inGracePeriodFb,
        gracePeriodEndsAt: inGracePeriodFb ? gracePeriodEndsAtFb : null,
        legalReacceptRequired,
        legalReacceptBlocked: false,
        legalReacceptBlockedReason: null,
        legalRequiredCombinedSha256,
        legalLastAcceptedCombinedSha256,
        // View As impersonation status
        isImpersonating: req.session.isImpersonating || false,
        realAdminId: req.session.realAdminId || null,
        realAdminEmail: req.session.realAdminEmail || null,
      });
    } catch (error) {
      console.error("Get current user error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Profile update endpoint - with proper auth and validation
  app.post("/api/profile/update", ensureAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const ip = (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined;
      const userAgent = req.headers["user-agent"] ?? undefined;

      // Validate with Zod - only allow whitelisted fields
      const profileUpdateSchema = z.object({
        email: z.string().email("Please enter a valid email").optional(),
        username: z.string().min(3, "Username must be at least 3 characters").max(50).optional(),
        name: z.string().max(100).optional(),
        phone: z.string().max(20).optional(),
        countryIso2: z.string().length(2, "Country code must be 2 letters").optional(),
      });

      const validationResult = profileUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          message: validationResult.error.errors[0]?.message || "Invalid input"
        });
      }

      const { email, username, name, phone, countryIso2 } = validationResult.data;
      const normalizedCountryIso2 = countryIso2?.toUpperCase();

      // Get existing user data to compare
      const existingUser = await storage.getUserById(userId);
      if (!existingUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if username is already taken by another user
      if (username) {
        const existingUsername = await storage.getUserByUsername(username);
        if (existingUsername && existingUsername.id !== userId) {
          return res.status(400).json({ message: "Username is already taken" });
        }
      }

      // Check if email is already taken by another user
      if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
        const existingEmail = await storage.getUserByEmail(email);
        if (existingEmail && existingEmail.id !== userId) {
          return res.status(400).json({ message: "Email is already taken" });
        }
      }

      const phoneRequired = (await getSignupPublicConfig()).signupPhoneEnforce;

      if (phone === undefined && phoneRequired && !existingUser.phone) {
        return res.status(400).json({ message: "PHONE_REQUIRED" });
      }

      let normalizedPhone: string | null = null;
      if (phone !== undefined) {
        if (!phone) {
          return res.status(400).json({ message: "PHONE_REQUIRED" });
        }
        const phoneCountry = normalizedCountryIso2 ?? existingUser.countryIso2;
        const parsed = phoneCountry
          ? parsePhoneNumberFromString(phone, phoneCountry as any)
          : parsePhoneNumberFromString(phone);
        if (!parsed || !parsed.isValid()) {
          return res.status(400).json({ message: "PHONE_INVALID" });
        }
        normalizedPhone = parsed.format("E.164");
      }

      // Only update provided and valid fields - never allow isAdmin or other protected fields
      const updateData: Record<string, string> = {};
      if (email !== undefined) updateData.email = email;
      if (username !== undefined) updateData.username = username;
      if (name !== undefined) updateData.name = name;
      if (normalizedPhone !== null) updateData.phone = normalizedPhone;
      if (normalizedCountryIso2 !== undefined) {
        updateData.countryIso2 = normalizedCountryIso2;
        updateData.country = normalizedCountryIso2;
      }

      await storage.updateUser(userId, updateData);

      if (normalizedPhone !== null && normalizedPhone !== existingUser.phone) {
        try {
          await db.insert(userVerification).values({
            userId,
            phoneE164: normalizedPhone,
            smsVerifiedAt: null,
            smsVerifyFailCount: 0,
            smsEnabled: false,
            smsSendCountDay: 0,
            smsSendDayKey: null,
            smsLastSentAt: null,
            smsLastSendAt: null,
            smsSendDayStart: null,
            smsOtpLockedUntil: null,
          }).onConflictDoUpdate({
            target: userVerification.userId,
            set: {
              phoneE164: normalizedPhone,
              smsVerifiedAt: null,
              smsVerifyFailCount: 0,
              smsEnabled: false,
              smsSendCountDay: 0,
              smsSendDayKey: null,
              smsLastSentAt: null,
              smsLastSendAt: null,
              smsSendDayStart: null,
              smsOtpLockedUntil: null,
            },
          });
        } catch (phoneUpdateError) {
          console.error("Failed to update phone verification state:", phoneUpdateError);
          return res.status(500).json({ message: "PHONE_STATE_UPDATE_FAILED" });
        }

        appendIdentityAudit({
          userId,
          email: existingUser.email,
          category: "VERIFICATION",
          type: "PHONE_UPDATED",
          title: "Phone updated from profile",
          description: `Updated phone to ${normalizedPhone}`,
          ip,
          userAgent,
        });
      }

      // P0: Email change must reset verification state
      if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
        // 1. Reset verification state in user_verification table
        await db.update(userVerification)
          .set({
            emailVerifiedAt: null,
            emailReverifyDueAt: null,
          })
          .where(eq(userVerification.userId, userId));

        // 2. Generate new verification token
        const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
        const token = crypto.randomBytes(32).toString("hex");

        // Hash the token (HMAC if secret available, else SHA256)
        const emailSecret = process.env.EMAIL_VERIFY_TOKEN_SECRET;
        const tokenHash = emailSecret
          ? crypto.createHmac("sha256", emailSecret).update(token).digest("hex")
          : crypto.createHash("sha256").update(token).digest("hex");

        const tokenId = crypto.randomUUID();
        const expiresAt = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600;

        // 3. Store token hash in email_verification_tokens table
        await db.insert(emailVerificationTokens).values({
          id: tokenId,
          userId: userId,
          tokenHash,
          purpose: "VERIFY",
          expiresAt,
        });

        // 4. Send verification email to new address
        const resendApiKey = process.env.RESEND_API_KEY;
        let emailSent = false;

        if (resendApiKey) {
          const verifyUrl = `${process.env.APP_URL || "http://localhost:5000"}/api/verification/email/verify?token=${token}`;

          try {
            const emailResponse = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: process.env.EMAIL_FROM || "TradeQuip <noreply@tradequip.com>",
                to: [email],
                subject: "Verify your new TradeQuip email address",
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #1a1a2e;">Email Address Changed</h2>
                    <p>Your TradeQuip account email has been changed. Please verify your new email address:</p>
                    <a href="${verifyUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                      Verify New Email
                    </a>
                    <p style="color: #666; font-size: 14px;">This link expires in ${VERIFICATION_TOKEN_EXPIRY_HOURS} hours.</p>
                    <p style="color: #666; font-size: 12px;">If you didn't make this change, please contact support immediately.</p>
                  </div>
                `,
              }),
            });

            const emailData = await emailResponse.json();
            if (emailResponse.ok) {
              emailSent = true;
              console.log("Email change verification email sent:", { id: emailData.id, to: email });
            } else {
              console.error("Resend API error during email change:", emailData);
            }
          } catch (emailError) {
            console.error("Error sending email change verification email:", emailError);
          }
        } else {
          console.warn("RESEND_API_KEY not configured, skipping verification email");
        }

        // 5. Emit identity_audit event for EMAIL_CHANGED
        appendIdentityAudit({
          userId: userId,
          email: email,
          category: "VERIFICATION",
          type: "EMAIL_CHANGED",
          title: "Email address changed",
          description: `Old: ${existingUser.email}, New: ${email}`,
          ip,
          userAgent,
        });

        // Also log the verification email send status
        appendIdentityAudit({
          userId: userId,
          email: email,
          category: "VERIFICATION",
          type: emailSent ? "EMAIL_VERIFICATION_SENT" : "EMAIL_SEND_FAILED",
          title: emailSent ? "Email change verification sent" : "Email change verification send failed",
          description: emailSent ? `Verification email sent to ${email}` : "RESEND_API_KEY missing or API error",
          ip,
          userAgent,
        });

        // Update session email
        req.session.email = email;
      }

      res.json({ message: "Profile updated successfully" });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Change password endpoint - with proper auth and validation
  app.post("/api/profile/change-password", ensureAuth, async (req: Request, res: Response) => {
    try {
      const passwordChangeSchema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(8, "New password must be at least 8 characters").max(25, "New password must be at most 25 characters"),
      });

      const validationResult = passwordChangeSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          message: validationResult.error.errors[0]?.message || "Invalid input"
        });
      }

      const { currentPassword, newPassword } = validationResult.data;

      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      // Verify current password using passwordHash field (same as login)
      const bcrypt = await import("bcryptjs");
      const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!validPassword) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      // Hash new password and update using passwordHash field
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(req.session.userId!, { passwordHash: hashedPassword });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.post("/api/profile/account/deactivate", ensureAuth, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        reasonCode: z.string().min(1).max(64),
        reasonText: z.string().max(500).optional().nullable(),
        password: z.string().min(1),
        confirm: z.string().min(1),
      });

      const { reasonCode, reasonText, password, confirm } = schema.parse(req.body);

      if (confirm.trim().toUpperCase() !== "DEACTIVATE") {
        return res.status(400).json({ message: "Type DEACTIVATE to confirm." });
      }

      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        req.session.destroy(() => { });
        return res.status(401).json({ message: "User not found" });
      }

      if ((user as any).isDeleted) {
        return res.status(400).json({ message: "Account is already deleted" });
      }

      if (user.isDisabled) {
        return res.status(400).json({ message: "Account is already deactivated" });
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        return res.status(400).json({ message: "Password is incorrect" });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const normalizedReasonCode = reasonCode.trim() ? reasonCode.trim().toUpperCase() : "OTHER";
      const normalizedReasonText = reasonText && reasonText.trim()
        ? reasonText.trim().slice(0, 500)
        : null;
      const ip = getClientIp(req);
      const userAgent = getUserAgent(req);

      await db.update(users)
        .set({ isDisabled: true, inactivatedAt: nowSec })
        .where(eq(users.id, user.id));

      try {
        await storage.upsertSettings({ userId: user.id, showOnLeaderboard: false } as any);
      } catch (e) {
        console.warn("Failed to update leaderboard visibility:", e);
      }

      await storage.recordAccountEvent({
        userId: user.id,
        eventType: "ACCOUNT_SELF_DEACTIVATED",
        title: "Account deactivated",
        description: "User requested account deactivation",
        reasonCode: normalizedReasonCode,
        reasonText: normalizedReasonText,
        metadata: {
          action: "DEACTIVATE",
          ip,
          userAgent,
          sessionId: req.sessionID,
        },
        provenance: {
          actorType: "USER",
          actorUserId: user.id,
          sessionId: req.sessionID,
          ip,
          userAgent,
        },
      });

      try {
        await revokeAllSessionsForUser({
          actorUserId: user.id,
          targetUserId: user.id,
          reason: "Account deactivated",
        });
      } catch (e) {
        console.error("Failed to revoke sessions after deactivation:", e);
      }

      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      res.clearCookie(SESSION_COOKIE_NAME);
      res.json({ success: true, message: "Account deactivated" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      console.error("Account deactivation error:", error);
      res.status(500).json({ message: "Failed to deactivate account" });
    }
  });

  app.post("/api/profile/account/delete", ensureAuth, async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        reasonCode: z.string().min(1).max(64),
        reasonText: z.string().max(500).optional().nullable(),
        password: z.string().min(1),
        confirm: z.string().min(1),
      });

      const { reasonCode, reasonText, password, confirm } = schema.parse(req.body);

      if (confirm.trim().toUpperCase() !== "DELETE") {
        return res.status(400).json({ message: "Type DELETE to confirm." });
      }

      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        req.session.destroy(() => { });
        return res.status(401).json({ message: "User not found" });
      }

      if ((user as any).isDeleted) {
        return res.status(400).json({ message: "Account is already deleted" });
      }

      const validPassword = await bcrypt.compare(password, user.passwordHash);
      if (!validPassword) {
        return res.status(400).json({ message: "Password is incorrect" });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const normalizedReasonCode = reasonCode.trim() ? reasonCode.trim().toUpperCase() : "OTHER";
      const normalizedReasonText = reasonText && reasonText.trim()
        ? reasonText.trim().slice(0, 500)
        : null;
      const ip = getClientIp(req);
      const userAgent = getUserAgent(req);

      await db.update(users)
        .set({
          isDisabled: true,
          inactivatedAt: nowSec,
          isDeleted: true,
          deletedAt: nowSec,
          deletedMode: "USER",
          deletedReason: normalizedReasonCode,
          deletedByAdminId: null,
        })
        .where(eq(users.id, user.id));

      try {
        await storage.upsertSettings({ userId: user.id, showOnLeaderboard: false } as any);
      } catch (e) {
        console.warn("Failed to update leaderboard visibility:", e);
      }

      await storage.recordAccountEvent({
        userId: user.id,
        eventType: "ACCOUNT_SELF_DELETED",
        title: "Account deleted",
        description: "User requested account deletion",
        reasonCode: normalizedReasonCode,
        reasonText: normalizedReasonText,
        metadata: {
          action: "DELETE",
          ip,
          userAgent,
          sessionId: req.sessionID,
        },
        provenance: {
          actorType: "USER",
          actorUserId: user.id,
          sessionId: req.sessionID,
          ip,
          userAgent,
        },
      });

      try {
        await revokeAllSessionsForUser({
          actorUserId: user.id,
          targetUserId: user.id,
          reason: "Account deleted",
        });
      } catch (e) {
        console.error("Failed to revoke sessions after deletion:", e);
      }

      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      res.clearCookie(SESSION_COOKIE_NAME);
      res.json({ success: true, message: "Account deleted" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      console.error("Account deletion error:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  // Consolidated profile endpoint - /api/profile/me
  app.get("/api/profile/me", ensureAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUserById(userId);

      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, userId),
      });

      const kyc = await db.query.userKycProfiles.findFirst({
        where: eq(userKycProfiles.userId, userId),
      });

      const payout = await db.query.userPayoutProfiles.findFirst({
        where: eq(userPayoutProfiles.userId, userId),
      });

      const settings = await storage.getUserSettingsById(userId);
      const auditCtx = buildAuditContext(req);
      const policyConfig = await loadPolicyConfig();
      const decisionCtx = await buildDecisionContext({
        userId,
        nowMs: Date.now(),
        request: {
          correlationId: auditCtx.correlationId,
          actorType: auditCtx.actorType,
          actorUserId: auditCtx.actorUserId,
          sessionId: auditCtx.sessionId,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent,
        },
        policyConfig,
      });
      const gates = featureGates(decisionCtx, policyConfig);

      const consolidatedProfile = {
        id: user.id,
        email: user.email,
        username: user.username,
        phone: user.phone,
        countryIso2: user.countryIso2,
        userTier: (user as any).userTier || "CANDIDATE",
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,

        verification: {
          emailVerified: !!verification?.emailVerifiedAt,
          emailVerifiedAt: verification?.emailVerifiedAt,
          emailReverifyDueAt: verification?.emailReverifyDueAt,
          gracePeriodEndsAt: verification?.emailInitialDueAt ?? null,
          phoneVerified: !!verification?.smsVerifiedAt,
          phoneVerifiedAt: verification?.smsVerifiedAt,
          contenderTier: verification?.contenderTier || "NONE",
        },

        kyc: {
          status: kyc?.status || "NOT_STARTED",
          invitedAt: kyc?.invitedAt,
          submittedAt: kyc?.submittedAt,
          reviewedAt: kyc?.reviewedAt,
        },

        payout: {
          preferredPaymentCurrency: payout?.preferredPaymentCurrency,
        },

        settings: {
          defaultSymbol: settings?.defaultSymbol,
          defaultLotSize: settings?.defaultLotSize,
          defaultLeverage: settings?.defaultLeverage,
          defaultStopLoss: settings?.defaultStopLoss,
          defaultTakeProfit: settings?.defaultTakeProfit,
        },

        featureGates: {
          accountState: gates.accountState,
          contenderEligible: gates.contenderEligible,
          canTradeOpenOrIncrease: gates.canTradeOpenOrIncrease,
          canTradeCloseOrReduce: gates.canTradeCloseOrReduce,
          canStartSms: gates.canStartSms,
          canViewKyc: gates.canViewKyc,
          canSetPreferredPaymentCurrency: gates.canSetPreferredPaymentCurrency,
          canRequestPayout: gates.canRequestPayout,
        },
      };

      res.json(consolidatedProfile);
    } catch (error) {
      console.error("Get profile error:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  // Policy snapshot endpoint - deterministic UI source of truth
  app.get("/api/policy/snapshot", ensureAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const auditCtx = buildAuditContext(req);
      const policyConfig = await loadPolicyConfig();
      const ctx = await buildDecisionContext({
        userId,
        nowMs: Date.now(),
        request: {
          correlationId: auditCtx.correlationId,
          actorType: auditCtx.actorType,
          actorUserId: auditCtx.actorUserId,
          sessionId: auditCtx.sessionId,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent,
        },
        policyConfig,
      });

      const promotion = await promotePerformerIfEligible({
        ctx,
        policyConfig,
        correlationId: auditCtx.correlationId,
        actorType: auditCtx.actorType,
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

      const baseDecision = decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, policyConfig);
      const derived = baseDecision.derived ?? null;

      res.json({
        derived,
        user: {
          userTier: ctx.user.userTier,
          contenderTier: ctx.user.contenderTier,
          emailVerifiedAt: ctx.user.emailVerifiedAt?.toISOString() ?? null,
          emailReverifyDueAt: ctx.user.emailReverifyDueAt?.toISOString() ?? null,
          emailInitialDueAt: ctx.user.emailInitialDueAt?.toISOString() ?? null,
          phoneVerifiedAt: ctx.user.phoneVerifiedAt?.toISOString() ?? null,
          selectedAt: ctx.user.selectedAt?.toISOString() ?? null,
        },
        features: {
          canSendEmailVerification: decidePolicy("EMAIL_RESEND_VERIFICATION", ctx, policyConfig).allowed,
          canStartSms: decidePolicy("PHONE_VERIFY_START", ctx, policyConfig).allowed,
          canConfirmSms: decidePolicy("PHONE_VERIFY_CONFIRM", ctx, policyConfig).allowed,
          canViewKyc: decidePolicy("KYC_VIEW", ctx, policyConfig).allowed,
          canSubmitKyc: decidePolicy("KYC_SUBMIT", ctx, policyConfig).allowed,
          canSetPreferredPaymentCurrency: decidePolicy("PREFERRED_PAYMENT_CURRENCY_SET", ctx, policyConfig).allowed,
          canRequestPayout: decidePolicy("PAYOUT_REQUEST", ctx, policyConfig).allowed,
          canTradeOpenOrIncrease: decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, policyConfig).allowed,
          canTradeCloseOrReduce: decidePolicy("TRADE_CLOSE_OR_REDUCE", ctx, policyConfig).allowed,
          canTradeCancelPending: decidePolicy("TRADE_CANCEL_PENDING", ctx, policyConfig).allowed,
          canTradeModifySltp: decidePolicy("TRADE_MODIFY_SLTP", ctx, policyConfig).allowed,
        },
        contenderCriteria: {
          path1: {
            minAgeDays: policyConfig.contenderMinAgeDays,
            minBalanceMultiplier: policyConfig.contenderMinBalancePct,
            minTradesLifetime: policyConfig.contenderMinTradesLifetime,
          },
          path2: {
            minAgeDays: policyConfig.contenderPath2MinAgeDays,
            minReturnPct: policyConfig.contenderPath2MinReturnLast90,
            minTradesWindow: policyConfig.contenderPath2MinTradesLast90,
            maxDaysSinceLastTrade: policyConfig.contenderPath2MaxDaysSinceLastTrade,
          },
        },
        correlationId: auditCtx.correlationId,
      });
    } catch (error) {
      console.error("Policy snapshot error:", error);
      res.status(500).json({ message: "Failed to fetch policy snapshot" });
    }
  });

  // Get user's own login history with geo-enrichment
  app.get("/api/profile/login-history", ensureAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
      const logins = await getRecentLoginActivity({ userId: req.session.userId!, limit });
      res.json(logins);
    } catch (error) {
      console.error("Get login history error:", error);
      res.status(500).json({ message: "Failed to fetch login history" });
    }
  });

  // Get user's active sessions with geo-enrichment
  app.get("/api/profile/sessions", ensureAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
      const currentSessionId = req.sessionID;
      const userId = req.session.userId!;
      const ip = getClientIp(req);
      const userAgent = getUserAgent(req);
      const geoContext = buildGeoContext(ip, extractGeoHints(req));

      let sessions = await getActiveSessions({ userId, limit });

      const currentExists = sessions.some(s => s.sessionId === currentSessionId);
      if (!currentExists) {
        const user = await storage.getUserById(userId);
        await createUserSession({
          sessionId: currentSessionId,
          userId,
          email: user?.email || "",
          ip,
          userAgent,
          geo: geoContext,
        });
        sessions = await getActiveSessions({ userId, limit });
      }

      const formattedSessions = sessions.map((s) => ({
        ...s,
        isCurrent: s.sessionId === currentSessionId,
        location: [s.city, s.region, s.countryCode].filter(Boolean).join(", ") || "Unknown",
      }));

      res.json(formattedSessions);
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  // Terminate specific session (revoke with audit trail)
  app.delete("/api/profile/sessions/:sessionId", ensureAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      if (sessionId === req.sessionID) {
        return res.status(400).json({ message: "Cannot terminate current session. Use logout instead." });
      }

      await revokeSession({
        actorUserId: req.session.userId!,
        targetUserId: req.session.userId!,
        sessionId,
        reason: "User terminated session",
      });
      res.json({ message: "Session terminated successfully" });
    } catch (error) {
      console.error("Terminate session error:", error);
      res.status(500).json({ message: "Failed to terminate session" });
    }
  });

  // Terminate all other sessions
  app.delete("/api/profile/sessions", ensureAuth, async (req: Request, res: Response) => {
    try {
      const currentSessionId = req.sessionID;
      const allSessions = await getActiveSessions({ userId: req.session.userId!, limit: 100 });

      for (const session of allSessions) {
        if (session.sessionId !== currentSessionId) {
          await revokeSession({
            actorUserId: req.session.userId!,
            targetUserId: req.session.userId!,
            sessionId: session.sessionId,
            reason: "User terminated all other sessions",
          });
        }
      }
      res.json({ message: "All other sessions terminated successfully" });
    } catch (error) {
      console.error("Terminate all sessions error:", error);
      res.status(500).json({ message: "Failed to terminate sessions" });
    }
  });

  // Update user preferences (timezone, language, country)
  app.put("/api/profile/preferences", ensureAuth, async (req: Request, res: Response) => {
    console.log(`[Preferences] PUT /api/profile/preferences called by user ${req.session.userId}, body:`, JSON.stringify(req.body));
    try {
      const preferencesSchema = z.object({
        timezone: z.string().max(50).optional(),
        language: z.string().max(10).optional(),
        country: z.string().max(50).optional(),
      });

      const validationResult = preferencesSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          message: validationResult.error.errors[0]?.message || "Invalid input"
        });
      }

      const { timezone, language, country } = validationResult.data;

      const user = await storage.getUserById(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Policy: admin controls timezone editability
      const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
      const allowUserTimezoneEdit = cfg ? Boolean((cfg as any).allowUserTimezoneEdit ?? true) : true;

      const updateData: Record<string, string> = {};
      let didUpdate = false;

      // Language always editable
      if (language !== undefined) {
        const normalized = normalizeLanguagePreference(language);
        if (!normalized.matched) {
          return res.status(400).json({ message: "Unsupported language" });
        }
        updateData.language = normalized.normalized;
        didUpdate = true;
        console.log(`[Preferences] User ${req.session.userId} updating language to: ${updateData.language}`);
      }

      // Timezone editable only if policy allows it
      if (timezone !== undefined && allowUserTimezoneEdit) {
        updateData.timezone = timezone;
        didUpdate = true;
      }

      // Country: set-once only (immutable after first set)
      if (country !== undefined) {
        const normalized = String(country).trim().toUpperCase();
        if (normalized) {
          const existingRaw = (user as any).countryIso2 || (user as any).country;
          const existing = existingRaw ? String(existingRaw).trim().toUpperCase() : "";

          // If already set and differs -> reject
          if (existing && normalized !== existing) {
            return res.status(409).json({ message: "Country is locked and cannot be changed." });
          }

          // If not set yet -> allow one-time set (and also set countryIso2)
          if (!existing) {
            if (!/^[A-Z]{2}$/.test(normalized)) {
              return res.status(400).json({ message: "Invalid country code (expected ISO2)." });
            }
            await storage.updateUser(user.id, { countryIso2: normalized, country: normalized });
            didUpdate = true;
          }
        }
      }

      if (Object.keys(updateData).length > 0) {
        console.log(`[Preferences] Saving preferences for user ${req.session.userId}:`, updateData);
        await storage.updateUserPreferences(req.session.userId!, updateData);
        console.log(`[Preferences] Successfully saved preferences for user ${req.session.userId}`);
        didUpdate = true;
      }

      if (!didUpdate) {
        return res.status(400).json({ message: "No preferences to update" });
      }

      res.json({ message: "Preferences updated successfully" });
    } catch (error) {
      console.error("Update preferences error:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // Get user preferences + policy flags
  app.get("/api/profile/preferences", ensureAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const [cfg] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
      const allowUserTimezoneEdit = cfg ? Boolean((cfg as any).allowUserTimezoneEdit ?? true) : true;
      const countryRaw = (user as any).countryIso2 || (user as any).country || null;
      const countryIso2 = countryRaw ? String(countryRaw).trim().toUpperCase() : null;

      res.json({
        timezone: (user as any).timezone || "UTC",
        language: (user as any).language || "en",
        country: countryIso2,
        countryLocked: Boolean(countryIso2),
        timezoneEditable: allowUserTimezoneEdit,
      });
    } catch (error) {
      console.error("Get preferences error:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  // Get KYC profile for current user
  app.get("/api/profile/kyc", ensureAuth, requirePolicy("KYC_VIEW"), async (req: Request, res: Response) => {
    try {
      const kycProfile = await db.query.userKycProfiles.findFirst({
        where: eq(userKycProfiles.userId, req.session.userId!),
      });

      if (!kycProfile) {
        return res.json({
          status: "NOT_STARTED",
          invitedAt: null,
          submittedAt: null,
          reviewedAt: null,
          rejectionReason: null,
        });
      }

      res.json({
        status: kycProfile.status,
        invitedAt: kycProfile.invitedAt?.toISOString() || null,
        submittedAt: kycProfile.submittedAt?.toISOString() || null,
        reviewedAt: kycProfile.reviewedAt?.toISOString() || null,
        rejectionReason: kycProfile.rejectionReason,
      });
    } catch (error) {
      console.error("Get KYC profile error:", error);
      res.status(500).json({ message: "Failed to fetch KYC profile" });
    }
  });

  // Submit KYC documents for current user
  app.post("/api/profile/kyc/submit", ensureAuth, requirePolicy("KYC_SUBMIT"), async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const {
        documentType,
        documentNumber,
        legalFirstName,
        legalLastName,
        dob,
        addressLine1,
        addressLine2,
        city,
        region,
        postalCode,
        country,
        idDocumentRef,
        documentData,
      } = req.body ?? {};

      if (!documentType || typeof documentType !== "string") {
        return res.status(400).json({ message: "Document type is required" });
      }

      const missing: string[] = [];
      if (!legalFirstName) missing.push("legalFirstName");
      if (!legalLastName) missing.push("legalLastName");
      if (!dob) missing.push("dob");
      if (!addressLine1) missing.push("addressLine1");
      if (!city) missing.push("city");
      if (!country) missing.push("country");

      if (missing.length) {
        return res.status(400).json({ message: `Missing required KYC fields: ${missing.join(", ")}` });
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const kycProfile = await db.query.userKycProfiles.findFirst({
        where: eq(userKycProfiles.userId, userId),
      });

      if (!kycProfile) {
        return res.status(400).json({ message: "You must be invited for KYC verification first" });
      }

      if (kycProfile.status !== "INVITED" && kycProfile.status !== "REJECTED") {
        return res.status(400).json({
          message: `Cannot submit KYC with current status: ${kycProfile.status}`
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);

      await db.update(userKycProfiles)
        .set({
          status: "SUBMITTED",
          documentType,
          documentNumber: documentNumber || null,
          legalFirstName: legalFirstName || null,
          legalLastName: legalLastName || null,
          dob: dob || null,
          addressLine1: addressLine1 || null,
          addressLine2: addressLine2 || null,
          city: city || null,
          region: region || null,
          postalCode: postalCode || null,
          country: country || null,
          idDocumentRef: idDocumentRef || documentData || null,
          submittedAt: nowSec,
          updatedAt: nowSec,
        })
        .where(eq(userKycProfiles.userId, userId));

      appendIdentityAudit({
        userId,
        email: user.email,
        category: "KYC",
        type: "KYC_SUBMITTED",
        title: "KYC documents submitted",
        description: `Document type: ${documentType}`,
        ip: req.ip || (req.headers["x-forwarded-for"] as string),
        userAgent: req.headers["user-agent"],
      });

      res.json({ success: true, message: "KYC documents submitted for review" });
    } catch (error) {
      console.error("KYC submit error:", error);
      res.status(500).json({ message: "Failed to submit KYC documents" });
    }
  });

  // Get payout profile for current user
  app.get("/api/profile/payout", ensureAuth, requirePolicy("KYC_VIEW"), async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      const defaultCurrency = defaultPaymentCurrencyForCountry({
        countryIso2: (user as any)?.countryIso2 ?? (user as any)?.country ?? null,
        regionKey: (user as any)?.regionKey ?? null,
      });

      const payoutProfile = await db.query.userPayoutProfiles.findFirst({
        where: eq(userPayoutProfiles.userId, req.session.userId!),
      });

      if (!payoutProfile) {
        return res.json({
          preferredPaymentCurrency: defaultCurrency,
          payoutMethod: null,
          isVerified: false,
        });
      }

      res.json({
        preferredPaymentCurrency: payoutProfile.preferredPaymentCurrency || defaultCurrency,
        payoutMethod: payoutProfile.payoutMethod,
        isVerified: payoutProfile.isVerified,
      });
    } catch (error) {
      console.error("Get payout profile error:", error);
      res.status(500).json({ message: "Failed to fetch payout profile" });
    }
  });

  // Update payout currency preference
  app.put("/api/profile/payout/currency", ensureAuth, requirePolicy("PREFERRED_PAYMENT_CURRENCY_SET"), async (req: Request, res: Response) => {
    try {
      const payoutCurrencySchema = z.object({
        currency: z.enum(["USD", "EUR", "GBP", "CHF", "JPY"], {
          errorMap: () => ({ message: "Invalid currency. Must be USD, EUR, GBP, CHF, or JPY" })
        })
      });

      const validationResult = payoutCurrencySchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ message: validationResult.error.errors[0]?.message || "Invalid input" });
      }

      const { currency } = validationResult.data;

      const existing = await db.query.userPayoutProfiles.findFirst({
        where: eq(userPayoutProfiles.userId, req.session.userId!),
      });

      if (existing) {
        await db.update(userPayoutProfiles)
          .set({
            preferredPaymentCurrency: currency,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(userPayoutProfiles.userId, req.session.userId!));
      } else {
        await db.insert(userPayoutProfiles).values({
          userId: req.session.userId!,
          preferredPaymentCurrency: currency,
        });
      }

      res.json({ message: "Currency preference updated" });
    } catch (error) {
      console.error("Update payout currency error:", error);
      res.status(500).json({ message: "Failed to update currency preference" });
    }
  });

  // Real-time account summary endpoint - returns fresh MT5-style metrics
  app.get("/api/account/summary", ensureAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;

      // Import and run recalcAccount to get fresh metrics with stale detection
      const { recalcAccount } = await import('./recalcAccount');
      const metrics = await recalcAccount(userId);

      if (!metrics) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return MT5-style account summary with stale pricing indicators
      res.json({
        balance: metrics.balance,
        equity: metrics.equity,
        floatingPnl: metrics.floatingPnl,
        usedMargin: metrics.usedMargin,
        freeMargin: metrics.freeMargin,
        marginLevel: metrics.marginLevel, // null when no margin used (not 0)
        openPositions: metrics.openPositions,
        pricingStale: metrics.pricingStale,
        staleSymbols: metrics.staleSymbols,
        asOf: metrics.asOf.toISOString(),
      });
    } catch (error) {
      console.error("Get account summary error:", error);
      res.status(500).json({ message: "Failed to get account summary" });
    }
  });

  // Symbol configuration endpoint
  app.get("/api/config/symbols", async (req: Request, res: Response) => {
    try {
      const symbols = await storage.getSymbolConfigs();
      res.json(symbols);
    } catch (error) {
      console.error("Get symbols error:", error);
      res.status(500).json({ message: "Failed to fetch symbols" });
    }
  });

  // Trades endpoints
  app.post(
    "/api/trades",
    ensureAuth,
    ensureDoc1TermsAccepted,
    requirePolicy((req) => {
      const orderType = String((req.body as any)?.orderType ?? "Market").toLowerCase();
      return orderType.includes("limit") || orderType.includes("stop")
        ? "TRADE_PLACE_PENDING"
        : "TRADE_OPEN_OR_INCREASE";
    }),
    async (req: Request, res: Response, next: NextFunction) => {
      const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
      if (!bg.allowed) return;
      next();
    },
    riskMiddleware,
    async (req: Request, res: Response) => {
      const correlationId = generateCorrelationId();
      const auditCtx = buildAuditContext(req);
      auditCtx.correlationId = correlationId;
      const receivedAtMs = Date.now();

      try {
        // Handle either lots or size parameter from the request
        const { symbol, type, lots, size, orderType, limitPrice, stopPrice } = req.body;
        const orderSize = size ?? lots;

        if (typeof orderSize !== "number") {
          return res.status(400).json({ message: "size (lots) must be numeric" });
        }

        // Validate request data
        const data = insertTradeSchema.parse({
          ...req.body,
          userId: req.session.userId,
          openedAt: Math.floor(Date.now() / 1000),
          lots: orderSize, // Use the unified size parameter
        });

        // Get current symbol price from our memory-based quotes
        // First, get the symbol config to get the symbol string
        const symbolConfig = await storage.getSymbolConfigById(data.symbolId);
        if (!symbolConfig) {
          return res.status(404).json({ message: "Symbol configuration not found" });
        }

        const executionQuote = await getExecutionQuote(symbolConfig.symbol, data.type, "OPEN");
        const quote = {
          symbol: executionQuote.symbol,
          bid: executionQuote.bid,
          ask: executionQuote.ask,
          mid: executionQuote.mid,
          price: executionQuote.mid,
          isStale: executionQuote.isStale,
          lastApiUpdate: executionQuote.quoteTs.getTime(),
          source: executionQuote.source,
        };

        const quoteTs = executionQuote.quoteTs ?? null;
        const quoteSource = executionQuote.source ?? "quote_service";

        // AUDIT: Write ORDER_RECEIVED event immediately after we have quote context
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "ORDER_RECEIVED",
            ctx: auditCtx,
            userId: req.session.userId,
            symbol: symbolConfig.symbol,
            side: data.type,
            orderType: orderType ?? "Market",
            qtyLots: orderSize,
            requestedPrice: parseFloat(String(req.body.limitPrice ?? req.body.stopPrice ?? quote.price)),
            limitPrice: req.body.limitPrice ? parseFloat(String(req.body.limitPrice)) : null,
            stopPrice: req.body.stopPrice ? parseFloat(String(req.body.stopPrice)) : null,
            takeProfit: req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null,
            stopLoss: req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null,
            quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
            quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
            quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
            quoteTs,
            quoteIsStale: quote.isStale ?? false,
            payload: { rawBody: req.body, receivedAtMs, quoteSource },
          });
        } catch (auditErr) {
          console.error("Error writing ORDER_RECEIVED audit:", auditErr);
        }

        // OPTION 1: Block trade open on stale quote
        if (quote.isStale === true) {
          // AUDIT: Write DECISION REJECT for stale quote
          try {
            await writeOrderIntentAudit({
              correlationId,
              eventCode: "DECISION",
              ctx: auditCtx,
              userId: req.session.userId,
              decision: "REJECT",
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: orderType ?? "Market",
              qtyLots: orderSize,
              requestedPrice: parseFloat(String(req.body.limitPrice ?? req.body.stopPrice ?? quote.price)),
              quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
              quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
              quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
              quoteTs,
              quoteIsStale: true,
              riskLimit: {},
              riskObserved: {},
              payload: { rejectReason: "STALE_QUOTE", latencyMs: Date.now() - receivedAtMs, quoteSource },
            });
          } catch (auditErr) {
            console.error("Error writing DECISION REJECT audit:", auditErr);
          }
          return res.status(503).json({
            code: "QUOTE_STALE",
            message: "Quote is stale. Cannot open trade until fresh quotes are available.",
            symbol: symbolConfig.symbol,
            isStale: true
          });
        }

        // Use the appropriate price based on trade type
        // For a realistic trading experience with spreads
        let entryPrice;

        if (data.type === 'BUY') {
          entryPrice = quote.ask !== undefined ?
            parseFloat(String(quote.ask)) :
            parseFloat(String(quote.price));
        } else {
          entryPrice = quote.bid !== undefined ?
            parseFloat(String(quote.bid)) :
            parseFloat(String(quote.price));
        }

        // Handle either lots or size parameter, ensuring numeric type
        let tradeLots = 1; // Default to 1 lot

        if (data.lots !== undefined) {
          // Ensure lots is a number (could be a string from the client)
          tradeLots = typeof data.lots === 'string' ? parseInt(data.lots, 10) : Number(data.lots);
        } else if (data.size) {
          // Calculate lots from size
          tradeLots = Math.floor(Number(data.size) / 100000);
        }

        // Validate lots are within acceptable range (1-50)
        if (isNaN(tradeLots) || tradeLots < 1 || tradeLots > 50) {
          // AUDIT: Write DECISION REJECT for invalid lots
          try {
            await writeOrderIntentAudit({
              correlationId,
              eventCode: "DECISION",
              ctx: auditCtx,
              userId: req.session.userId,
              decision: "REJECT",
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: orderType ?? "Market",
              qtyLots: tradeLots,
              riskLimit: { minLots: 1, maxLots: 50 },
              riskObserved: { requestedLots: tradeLots },
              payload: { rejectReason: "INVALID_LOTS", latencyMs: Date.now() - receivedAtMs },
            });
          } catch (auditErr) {
            console.error("Error writing DECISION REJECT audit:", auditErr);
          }
          return res.status(400).json({
            message: "Invalid input data",
            errors: [
              { code: "custom", message: "Lots must be between 1 and 50", path: ["lots"] },
              { code: "too_big", maximum: 50, type: "number", inclusive: true, message: "Lots must be less than or equal to 50", path: ["lots"] }
            ]
          });
        }

        // Calculate position size from lots (1 lot = $100,000)
        const CONTRACT_SIZE = 100000;
        const positionSize = tradeLots * CONTRACT_SIZE;
        const openCostSummary = computeOpenSideCosts({
          category: (symbolConfig as any).category,
          notionalUsd: positionSize,
          lots: tradeLots,
          size: positionSize,
          positionSide: data.type,
        });

        // Enforce global maxPositionSize limit
        const gs = await getGlobalSettingsCached();
        const maxPositionSize = Number(gs?.maxPositionSize ?? 5000000);
        const minPriceDistancePips = sanitizeMinPriceDistancePips(gs?.minPriceDistancePips);
        if (positionSize > maxPositionSize) {
          // AUDIT: Write DECISION REJECT for position size exceeded
          try {
            await writeOrderIntentAudit({
              correlationId,
              eventCode: "DECISION",
              ctx: auditCtx,
              userId: req.session.userId,
              decision: "REJECT",
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: orderType ?? "Market",
              qtyLots: tradeLots,
              riskLimit: { maxPositionSize },
              riskObserved: { positionSize },
              payload: { rejectReason: "POSITION_SIZE_EXCEEDED", latencyMs: Date.now() - receivedAtMs },
            });
          } catch (auditErr) {
            console.error("Error writing DECISION REJECT audit:", auditErr);
          }
          return res.status(400).json({
            code: "MAX_POSITION_SIZE",
            message: `Position size $${positionSize.toLocaleString()} exceeds maximum allowed ($${maxPositionSize.toLocaleString()}).`,
            positionSize,
            maxPositionSize,
            suggestedMaxLots: Math.floor(maxPositionSize / CONTRACT_SIZE)
          });
        }

        // Ensure the account numbers are fresh
        await recalcAccount(req.session.userId);

        // Pull the updated user
        const updatedUser = await storage.getUserById(req.session.userId);
        if (!updatedUser) return res.status(404).json({ message: "User not found" });

        // Determine order type and status (handle both "LIMIT" and "limit" formats)
        const normalizedOrderType = String(orderType ?? "Market").toUpperCase();
        const isLimitOrder = normalizedOrderType === "LIMIT" || normalizedOrderType === "BUY_LIMIT" || normalizedOrderType === "SELL_LIMIT";
        const isStopOrder = (normalizedOrderType === "STOP" || normalizedOrderType === "BUY_STOP" || normalizedOrderType === "SELL_STOP") && normalizedOrderType !== "STOPLOSS";
        const isPendingOrder = isLimitOrder || isStopOrder;

        const orderId = generateOrderId();
        const positionId = generatePositionId();
        const openExecutionId = isPendingOrder ? null : generateExecutionId();

        // Helper for writing DECISION REJECT audit
        const writeDecisionReject = async (rejectReason: string, riskLimit: any = {}, riskObserved: any = {}) => {
          try {
            await writeOrderIntentAudit({
              correlationId,
              eventCode: "DECISION",
              ctx: auditCtx,
              userId: req.session.userId,
              decision: "REJECT",
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: orderType ?? "Market",
              qtyLots: tradeLots,
              riskLimit,
              riskObserved,
              payload: { rejectReason, latencyMs: Date.now() - receivedAtMs },
            });
          } catch (auditErr) {
            console.error("Error writing DECISION REJECT audit:", auditErr);
          }
        };

        // Validate Limit/Stop orders have required prices
        if (isLimitOrder && (limitPrice === undefined || limitPrice === null)) {
          await writeDecisionReject("LIMIT_PRICE_MISSING");
          return res.status(400).json({ message: "Limit orders require a limitPrice" });
        }
        if (isStopOrder && (stopPrice === undefined || stopPrice === null)) {
          await writeDecisionReject("STOP_PRICE_MISSING");
          return res.status(400).json({ message: "Stop orders require a stopPrice" });
        }

        // MT5-style placement validation for Limit/Stop orders
        if (isPendingOrder) {
          const pipSize = getPipSize({
            symbol: symbolConfig.symbol,
            category: (symbolConfig as any).category,
            quoteCurrency: (symbolConfig as any).quoteCurrency,
            pipDecimals: (symbolConfig as any).pipDecimals,
            quoteDecimals: (symbolConfig as any).quoteDecimals,
          });
          const priceDecimals = getQuoteDecimals({
            symbol: symbolConfig.symbol,
            category: (symbolConfig as any).category,
            quoteCurrency: (symbolConfig as any).quoteCurrency,
            pipDecimals: (symbolConfig as any).pipDecimals,
            quoteDecimals: (symbolConfig as any).quoteDecimals,
          });
          const minDist = minPriceDistancePips * pipSize;
          const bid = quote.bid !== undefined ? parseFloat(String(quote.bid)) : entryPrice;
          const ask = quote.ask !== undefined ? parseFloat(String(quote.ask)) : entryPrice;

          if (isLimitOrder) {
            const reqPrice = parseFloat(String(limitPrice));
            const maxBuyLimit = ask - minDist;
            const minSellLimit = bid + minDist;
            // Use precision-aware comparison for limit orders
            if (data.type === "BUY" && priceGreaterThan(reqPrice, maxBuyLimit, priceDecimals)) {
              await writeDecisionReject("BUY_LIMIT_TOO_CLOSE", { minDistPips: minPriceDistancePips, ask }, { requestedPrice: reqPrice });
              return res.status(400).json({
                message: `BUY LIMIT must be at least ${minPriceDistancePips} pips below current ask (${ask.toFixed(priceDecimals)}). Maximum: ${maxBuyLimit.toFixed(priceDecimals)}`
              });
            }
            if (data.type === "SELL" && priceLessThan(reqPrice, minSellLimit, priceDecimals)) {
              await writeDecisionReject("SELL_LIMIT_TOO_CLOSE", { minDistPips: minPriceDistancePips, bid }, { requestedPrice: reqPrice });
              return res.status(400).json({
                message: `SELL LIMIT must be at least ${minPriceDistancePips} pips above current bid (${bid.toFixed(priceDecimals)}). Minimum: ${minSellLimit.toFixed(priceDecimals)}`
              });
            }
          }

          if (isStopOrder) {
            const reqPrice = parseFloat(String(stopPrice));
            const minBuyStop = ask + minDist;
            const maxSellStop = bid - minDist;
            // Use precision-aware comparison for stop orders
            if (data.type === "BUY" && priceLessThan(reqPrice, minBuyStop, priceDecimals)) {
              await writeDecisionReject("BUY_STOP_TOO_CLOSE", { minDistPips: minPriceDistancePips, ask }, { requestedPrice: reqPrice });
              return res.status(400).json({
                message: `BUY STOP must be at least ${minPriceDistancePips} pips above current ask (${ask.toFixed(priceDecimals)}). Minimum: ${minBuyStop.toFixed(priceDecimals)}`
              });
            }
            if (data.type === "SELL" && priceGreaterThan(reqPrice, maxSellStop, priceDecimals)) {
              await writeDecisionReject("SELL_STOP_TOO_CLOSE", { minDistPips: minPriceDistancePips, bid }, { requestedPrice: reqPrice });
              return res.status(400).json({
                message: `SELL STOP must be at least ${minPriceDistancePips} pips below current bid (${bid.toFixed(priceDecimals)}). Maximum: ${maxSellStop.toFixed(priceDecimals)}`
              });
            }
          }

          // TP/SL validation for pending orders using precision-aware comparison
          // This handles truncated decimals correctly (e.g., 0.67 = 0.6700 > 0.6698)
          const intendedEntry = isLimitOrder ? parseFloat(String(limitPrice)) : parseFloat(String(stopPrice));
          const tp = req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null;
          const sl = req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null;
          const minTpSl = intendedEntry + minDist; // Minimum distance for TP (BUY) or SL (SELL)
          const maxTpSl = intendedEntry - minDist; // Maximum for SL (BUY) or TP (SELL)

          if (data.type === "BUY") {
            // BUY TP must be >= entry + minPriceDistancePips
            if (tp !== null && priceLessThan(tp, minTpSl, priceDecimals)) {
              await writeDecisionReject("BUY_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { tp });
              return res.status(400).json({ message: `BUY TP must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
            }
            // BUY SL must be <= entry - minPriceDistancePips
            if (sl !== null && priceGreaterThan(sl, maxTpSl, priceDecimals)) {
              await writeDecisionReject("BUY_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { sl });
              return res.status(400).json({ message: `BUY SL must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
            }
          } else {
            // SELL TP must be <= entry - minPriceDistancePips
            if (tp !== null && priceGreaterThan(tp, maxTpSl, priceDecimals)) {
              await writeDecisionReject("SELL_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { tp });
              return res.status(400).json({ message: `SELL TP must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
            }
            // SELL SL must be >= entry + minPriceDistancePips
            if (sl !== null && priceLessThan(sl, minTpSl, priceDecimals)) {
              await writeDecisionReject("SELL_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { sl });
              return res.status(400).json({ message: `SELL SL must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
            }
          }
        }
        // TP/SL validation for market orders using the same minimum distance rule.
        // This prevents "instant-hit" targets and keeps behavior consistent with pending orders and edits.
        if (!isPendingOrder) {
          const pipSize = getPipSize({
            symbol: symbolConfig.symbol,
            category: (symbolConfig as any).category,
            quoteCurrency: (symbolConfig as any).quoteCurrency,
            pipDecimals: (symbolConfig as any).pipDecimals,
            quoteDecimals: (symbolConfig as any).quoteDecimals,
          });
          const priceDecimals = getQuoteDecimals({
            symbol: symbolConfig.symbol,
            category: (symbolConfig as any).category,
            quoteCurrency: (symbolConfig as any).quoteCurrency,
            pipDecimals: (symbolConfig as any).pipDecimals,
            quoteDecimals: (symbolConfig as any).quoteDecimals,
          });
          const minDist = minPriceDistancePips * pipSize;
          const tp = req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null;
          const sl = req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null;
          const minTpSl = entryPrice + minDist;
          const maxTpSl = entryPrice - minDist;

          if (data.type === "BUY") {
            if (tp !== null && priceLessThan(tp, minTpSl, priceDecimals)) {
              await writeDecisionReject("BUY_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { tp });
              return res.status(400).json({ message: `BUY TP must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
            }
            if (sl !== null && priceGreaterThan(sl, maxTpSl, priceDecimals)) {
              await writeDecisionReject("BUY_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { sl });
              return res.status(400).json({ message: `BUY SL must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
            }
          } else {
            if (tp !== null && priceGreaterThan(tp, maxTpSl, priceDecimals)) {
              await writeDecisionReject("SELL_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { tp });
              return res.status(400).json({ message: `SELL TP must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
            }
            if (sl !== null && priceLessThan(sl, minTpSl, priceDecimals)) {
              await writeDecisionReject("SELL_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { sl });
              return res.status(400).json({ message: `SELL SL must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
            }
          }
        }

        // For pending orders, use the requested price for margin calculation
        const priceForMargin = isPendingOrder
          ? parseFloat(String(limitPrice ?? stopPrice ?? entryPrice))
          : entryPrice;

        // Get global settings for leverage cascade
        const globalDefaultLeverage = Number(gs?.defaultLeverage ?? 50);

        // Effective leverage: user override takes precedence over global
        const effectiveLeverage = Number(updatedUser.leverage ?? globalDefaultLeverage);

        // How much margin will this order need?
        const neededMargin = requiredMargin(
          symbolConfig.symbol,
          tradeLots,
          priceForMargin,
          effectiveLeverage,
        );

        // Stop the order if free margin isn't enough
        if (Number(updatedUser.freeMargin) < neededMargin) {
          // AUDIT: Write DECISION REJECT for margin denial
          try {
            await writeOrderIntentAudit({
              correlationId,
              eventCode: "DECISION",
              ctx: auditCtx,
              userId: req.session.userId,
              decision: "REJECT",
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: orderType ?? "Market",
              qtyLots: tradeLots,
              riskLimit: { marginRequired: neededMargin },
              riskObserved: { freeMargin: Number(updatedUser.freeMargin) },
              payload: { rejectReason: "INSUFFICIENT_MARGIN", latencyMs: Date.now() - receivedAtMs },
            });
          } catch (auditErr) {
            console.error("Error writing DECISION REJECT audit:", auditErr);
          }
          return res.status(400).json({ message: "Not enough margin available" });
        }

        // Check max concurrent lots limit (includes both OPEN and PENDING orders)
        const userSettingsData = await storage.getUserSettingsById(req.session.userId);
        const globalMaxConcurrentLots = Number(gs?.maxConcurrentLots ?? 50);
        // Effective max lots: user override takes precedence over global (can exceed)
        const effectiveMaxConcurrentLots = Number(userSettingsData?.maxConcurrentLots ?? globalMaxConcurrentLots);

        // Create trade with appropriate price and status based on order type
        // Market orders: OPEN immediately at current price
        // Limit/Stop orders: PENDING, waiting for price trigger
        const nowSec = Math.floor(Date.now() / 1000);
        const tradeResult = await db.transaction(async (tx) => {
          // Serialize trade placement per user to avoid TOC/TOU races on maxConcurrentLots.
          // (Only supported on Postgres; other dialects rely on their transaction semantics.)
          if (isPostgres) {
            await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${req.session.userId} FOR UPDATE`);
          }

          const [openRow] = await tx
            .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
            .from(trades)
            .where(and(eq(trades.userId, req.session.userId), eq(trades.status, "OPEN")))
            .limit(1);
          const [pendingRow] = await tx
            .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
            .from(trades)
            .where(and(eq(trades.userId, req.session.userId), eq(trades.status, "PENDING")))
            .limit(1);

          const openLots = Number((openRow as any)?.lots ?? 0);
          const pendingLots = Number((pendingRow as any)?.lots ?? 0);
          const currentTotalLots = openLots + pendingLots;

          if (currentTotalLots + tradeLots > effectiveMaxConcurrentLots) {
            return { trade: null, rejectReason: "MAX_CONCURRENT_LOTS" as const, openLots, pendingLots, currentTotalLots };
          }

          if (!isPendingOrder) {
            const reserve = await reserveUserMargin(tx, { userId: req.session.userId, marginUsd: neededMargin });
            if (!reserve.reserved) {
              return { trade: null, rejectReason: "INSUFFICIENT_MARGIN_AT_COMMIT" as const, openLots, pendingLots, currentTotalLots };
            }
            await applyUserBalanceDelta(tx, {
              userId: req.session.userId,
              deltaUsd: -openCostSummary.totalUsd,
            });
          }

          const [createdTrade] = await tx
            .insert(trades)
            .values({
              ...data,
              openPrice: isPendingOrder ? priceForMargin : entryPrice, // Pending orders use limit/stop price as intended entry
              lots: tradeLots,
              size: positionSize,
              orderType: orderType ?? "Market",
              limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
              stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
              status: isPendingOrder ? "PENDING" : "OPEN",
              executedAt: isPendingOrder ? undefined : nowSec,
              intradayHigh: isPendingOrder ? null : entryPrice,
              intradayLow: isPendingOrder ? null : entryPrice,
              mae: null,
              mfe: null,
              correlationId: correlationId,
              orderId,
              positionId,
              notionalUsd: openCostSummary.notionalUsd,
              categorySnapshot: openCostSummary.categorySnapshot,
              costModelVersion: openCostSummary.costModelVersion,
              openCommissionUsd: isPendingOrder ? 0 : openCostSummary.commissionUsd,
              openOtherFeesUsd: isPendingOrder ? 0 : openCostSummary.otherFeesUsd,
              totalCostsUsd: isPendingOrder ? 0 : openCostSummary.totalUsd,
              lastExecutionId: openExecutionId,
              lastActorUserId: req.session.userId,
              lastActorSessionId: auditCtx.sessionId,
              lastActorIp: auditCtx.ip,
              lastActorUserAgent: auditCtx.userAgent,
              lastActorType: auditCtx.actorType,
            })
            .returning();

          if (!createdTrade) throw new Error("Failed to create trade");
          return { trade: createdTrade, rejectReason: null as const, openLots, pendingLots, currentTotalLots };
        });

        const openLots = tradeResult.openLots;
        const pendingLots = tradeResult.pendingLots;
        const currentTotalLots = tradeResult.currentTotalLots;

        if (tradeResult.rejectReason === "MAX_CONCURRENT_LOTS") {
          // AUDIT: Write DECISION REJECT for max concurrent lots exceeded
          try {
            await writeOrderIntentAudit({
              correlationId,
              eventCode: "DECISION",
              ctx: auditCtx,
              userId: req.session.userId,
              decision: "REJECT",
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: orderType ?? "Market",
              qtyLots: tradeLots,
              riskLimit: { maxConcurrentLots: effectiveMaxConcurrentLots },
              riskObserved: { currentLots: currentTotalLots, requestedLots: tradeLots },
              payload: { rejectReason: "MAX_CONCURRENT_LOTS_EXCEEDED", openLots, pendingLots, latencyMs: Date.now() - receivedAtMs },
            });
          } catch (auditErr) {
            console.error("Error writing DECISION REJECT audit:", auditErr);
          }
          return res.status(409).json({
            code: "MAX_CONCURRENT_LOTS",
            message: `Maximum concurrent lots exceeded. Open: ${openLots}, Pending: ${pendingLots}, Requested: ${tradeLots}, Limit: ${effectiveMaxConcurrentLots}`,
            openLots,
            pendingLots,
            currentLots: currentTotalLots,
            requestedLots: tradeLots,
            maxLots: effectiveMaxConcurrentLots,
            limit: effectiveMaxConcurrentLots
          });
        }

        const trade = tradeResult.trade;
        if (!trade) {
          await writeDecisionReject("INSUFFICIENT_MARGIN_AT_COMMIT", { marginRequired: neededMargin }, {});
          return res.status(400).json({ message: "Not enough margin available" });
        }

        if (!isPendingOrder) {
          initTradeExcursion(Number(trade.id), entryPrice);
        }

        // AUDIT: Write DECISION event (PASS) after successful trade creation
        const latencyMs = Date.now() - receivedAtMs;
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: req.session.userId,
            decision: "PASS",
            symbol: symbolConfig.symbol,
            side: data.type,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            requestedPrice: isPendingOrder ? priceForMargin : entryPrice,
            limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
            stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
            takeProfit: req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null,
            stopLoss: req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null,
            quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
            quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
            quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
            quoteTs,
            quoteIsStale: quote.isStale ?? false,
            riskLimit: { maxConcurrentLots: effectiveMaxConcurrentLots, marginRequired: neededMargin },
            riskObserved: { currentLots: currentTotalLots, freeMargin: Number(updatedUser.freeMargin) },
            payload: {
              tradeId: trade.id,
              latencyMs,
              status: trade.status,
              quoteSource,
              costModelVersion: openCostSummary.costModelVersion,
              categorySnapshot: openCostSummary.categorySnapshot,
              notionalUsd: openCostSummary.notionalUsd,
              openCostEstimatedUsd: openCostSummary.totalUsd,
              openCommissionEstimatedUsd: openCostSummary.commissionUsd,
              openOtherFeesEstimatedUsd: openCostSummary.otherFeesUsd,
              openCostChargedNowUsd: isPendingOrder ? 0 : openCostSummary.totalUsd,
            },
          });

          await writeTradeAudit({
            tradeId: trade.id,
            eventType: "ORDER_PLACED",
            eventCategory: "ORDER",
            ctx: auditCtx,
            orderId,
            positionId,
            symbol: symbolConfig.symbol,
            side: data.type,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            requestedPrice: isPendingOrder ? priceForMargin : entryPrice,
            limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
            stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
            quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
            quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
            quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
            quoteTs,
            quoteSource,
            riskResult: "PASS",
            note: isPendingOrder ? `Pending ${normalizedOrderType}` : "Market order placed",
            payload: {
              normalizedOrderType,
              limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
              stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
              takeProfit: req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null,
              stopLoss: req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null,
              status: trade.status,
              costModelVersion: openCostSummary.costModelVersion,
              categorySnapshot: openCostSummary.categorySnapshot,
              notionalUsd: openCostSummary.notionalUsd,
              openCostEstimatedUsd: openCostSummary.totalUsd,
              openCommissionEstimatedUsd: openCostSummary.commissionUsd,
              openOtherFeesEstimatedUsd: openCostSummary.otherFeesUsd,
              openCostChargedNowUsd: isPendingOrder ? 0 : openCostSummary.totalUsd,
            },
          });

          // For market orders, also write ORDER_FILLED to trade_audit
          if (!isPendingOrder) {
            const spread = quote.ask && quote.bid ? parseFloat(String(quote.ask)) - parseFloat(String(quote.bid)) : 0;
            const requestedPrice = data.type === "BUY"
              ? (quote.ask ? parseFloat(String(quote.ask)) : entryPrice)
              : (quote.bid ? parseFloat(String(quote.bid)) : entryPrice);
            const slippagePoints = Math.abs(entryPrice - requestedPrice);

            await writeTradeAudit({
              tradeId: trade.id,
              eventType: "ORDER_FILLED",
              eventCategory: "TRADE",
              ctx: auditCtx,
              orderId,
              positionId,
              executionId: openExecutionId ?? undefined,
              symbol: symbolConfig.symbol,
              side: data.type,
              orderType: "Market",
              qtyLots: tradeLots,
              requestedPrice,
              fillPrice: entryPrice,
              avgFillPrice: entryPrice,
              quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
              quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
              quoteMid: quote.mid ? parseFloat(String(quote.mid)) : null,
              quoteSpread: spread,
              spreadPips: calculateSpreadPips(symbolConfig.symbol, spread, symbolConfig.pipDecimals),
              quoteTs,
              quoteSource,
              slippage: slippagePoints,
              slippagePips: calculateSlippagePips(symbolConfig.symbol, slippagePoints, symbolConfig.pipDecimals),
              slippageReference: "market",
              latencyMs,
              riskResult: "PASS",
              note: `Market order filled at ${entryPrice}, openCost=${openCostSummary.totalUsd.toFixed(2)}`,
              payload: {
                costModelVersion: openCostSummary.costModelVersion,
                categorySnapshot: openCostSummary.categorySnapshot,
                notionalUsd: openCostSummary.notionalUsd,
                openCommissionUsd: openCostSummary.commissionUsd,
                openOtherFeesUsd: openCostSummary.otherFeesUsd,
                openCostChargedUsd: openCostSummary.totalUsd,
              },
            });
          }
        } catch (auditErr) {
          console.error("Error writing DECISION/ORDER_FILLED audit:", auditErr);
        }

        // Recalculate margin metrics after order placement (market orders affect margin immediately)
        try {
          await recalcAccount(req.session.userId, {
            emit: true,
            reason: isPendingOrder ? "PENDING_ORDER_PLACED" : "MARKET_ORDER_PLACED",
          });
        } catch (accountError) {
          console.error("Failed to update account after trade placement:", accountError);
        }

        // Notify ALL browser sessions for this user that trades changed (multi-device sync)
        // Include userId in payload so clients can filter, but also send to unauth'd clients
        const targetUserId = req.session.userId;
        broadcast(
          { type: "trades:updated", userId: targetUserId },
          (client) => client.userId === targetUserId || client.userId === undefined
        );

        // Grift detection: Record trade observation and check for coordinated hedging
        if (isPostgres) {
          try {
            const griftCtx = extractGriftContext(req);
            await withGriftClient(async (griftDb) => {
              const griftAuditCtx: GriftAuditContext = {
                ts: Date.now(),
                userId: req.session.userId,
                sessionId: req.sessionID,
                deviceId: griftCtx.deviceId ?? undefined,
                deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
                deviceFp: griftCtx.deviceFp ?? undefined,
                deviceInstallId: griftCtx.deviceInstallId ?? undefined,
                clientTz: griftCtx.clientTz ?? undefined,
                clientLang: griftCtx.clientLang ?? undefined,
                eventType: "TRADE_SUBMIT",
                ip: griftCtx.ip ?? undefined,
                userAgent: griftCtx.userAgent ?? undefined,
                geoCountry: griftCtx.geoCountry ?? undefined,
                geoRegion: griftCtx.geoRegion ?? undefined,
                geoCity: griftCtx.geoCity ?? undefined,
                latitude: griftCtx.latitude ?? undefined,
                longitude: griftCtx.longitude ?? undefined,
                asn: griftCtx.asn ?? undefined,
                org: griftCtx.org ?? undefined,
              };

              await onTradeSubmit(
                griftDb,
                trade.id,
                symbolConfig.symbol,
                data.type,
                tradeLots,
                griftAuditCtx
              );

              try {
                await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
              } catch (enfErr) {
                console.error("[Grift] Auto-enforcement failed (trade submit):", enfErr);
              }
            });
          } catch (griftErr) {
            console.error("Error in grift detection onTradeSubmit:", griftErr);
          }
        }

        res.status(201).json(trade);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid input data", errors: error.errors });
        }
        console.error("Create trade error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

  app.get("/api/trades", ensureAuth, async (req: Request, res: Response) => {

    try {
      const trades = await storage.getTradesByUserId(req.session.userId);
      res.json(trades);
    } catch (error) {
      console.error("Get trades error:", error);
      res.status(500).json({ message: "Failed to fetch trades" });
    }
  });

  app.get("/api/trades/history", ensureAuth, async (req: Request, res: Response) => {

    try {
      const trades = await storage.getTradeHistoryByUserId(req.session.userId);
      res.json(trades);
    } catch (error) {
      console.error("Get trade history error:", error);
      res.status(500).json({ message: "Failed to fetch trade history" });
    }
  });

  app.get("/api/trades/open", ensureAuth, async (req: Request, res: Response) => {

    try {
      const trades = await storage.getOpenTradesByUserId(req.session.userId);
      res.json(trades);
    } catch (error) {
      console.error("Get open trades error:", error);
      res.status(500).json({ message: "Failed to fetch open trades" });
    }
  });

  app.post(
    "/api/trades/:id/close",
    ensureAuth,
    ensureDoc1TermsAccepted,
    requirePolicy("TRADE_CLOSE_OR_REDUCE"),
    async (req: Request, res: Response, next: NextFunction) => {
      const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
      if (!bg.allowed) return;
      next();
    },
    async (req: Request, res: Response) => {
      const tradeId = parseInt(req.params.id);
      if (isNaN(tradeId)) {
        return res.status(400).json({ message: "Invalid trade ID" });
      }

      try {
        // Get the trade
        const trade = await storage.getTradeById(tradeId);

        if (!trade) {
          return res.status(404).json({ message: "Trade not found" });
        }

        if (trade.userId !== req.session.userId) {
          return res.status(403).json({ message: "Not authorized to close this trade" });
        }

        if (trade.status === "CLOSED") {
          return res.status(400).json({ message: "Trade is already closed" });
        }

        // Check minimum hold time enforcement
        const minHoldSec = await getEffectiveMinHoldSec(req.session.userId);
        if (minHoldSec > 0 && trade.openedAt) {
          let openedAtMs: number;
          if (typeof trade.openedAt === 'number') {
            openedAtMs = trade.openedAt < 1e12 ? trade.openedAt * 1000 : trade.openedAt;
          } else {
            // Handle various string formats - add 'Z' if no timezone to ensure UTC parsing
            const dateStr = String(trade.openedAt);
            const normalizedStr = dateStr.includes('Z') || dateStr.includes('+') || dateStr.includes('-', 10)
              ? dateStr
              : dateStr.replace(' ', 'T') + 'Z';
            openedAtMs = new Date(normalizedStr).getTime();
          }

          // Guard against invalid dates
          if (!isNaN(openedAtMs)) {
            const holdDurationSec = (Date.now() - openedAtMs) / 1000;

            if (holdDurationSec < minHoldSec) {
              const remainingSec = Math.ceil(minHoldSec - holdDurationSec);
              return res.status(403).json({
                code: "MIN_HOLD_TIME",
                message: `Trade must be held for at least ${minHoldSec} seconds. ${remainingSec} seconds remaining.`,
                minHoldSec,
                holdDurationSec: Math.floor(holdDurationSec),
                remainingSec,
              });
            }
          }
        }

        // Get symbol config for the trade
        const symbolConfig = await storage.getSymbolConfigById(trade.symbolId);
        if (!symbolConfig) {
          return res.status(404).json({ message: "Symbol configuration not found" });
        }

        // Use server-authoritative quote service - NEVER accept client-supplied closePrice
        let q;
        try {
          q = await getExecutionQuote(symbolConfig.symbol, trade.type as "BUY" | "SELL", "CLOSE");
        } catch (quoteError) {
          return res.status(503).json({ message: "Live price unavailable. Try again shortly." });
        }

        // Reject if market is closed
        if (!q.marketOpen) {
          return res.status(409).json({ message: "Market is closed. Try again when market re-opens." });
        }

        // Institutional: Never execute manual closes on stale quotes. Require a fresh server-authoritative quote.
        if (q.isStale) {
          const quoteAgeMs = Math.max(0, Date.now() - q.quoteTs.getTime());
          const closeAuditCtx = buildAuditContext(req);
          const correlationId = (trade as any).correlationId || generateCorrelationId();
          const orderId = (trade as any).orderId || generateOrderId();
          const positionId = (trade as any).positionId || generatePositionId();

          closeAuditCtx.correlationId = correlationId;

          metricTradeCloseRejectedQuoteStaleTotal += 1;

          try {
            await db.update(trades)
              .set({
                correlationId,
                orderId,
                positionId,
                lastActorUserId: req.session.userId,
                lastActorSessionId: closeAuditCtx.sessionId,
                lastActorIp: closeAuditCtx.ip,
                lastActorUserAgent: closeAuditCtx.userAgent,
                lastActorType: closeAuditCtx.actorType,
              })
              .where(eq(trades.id, tradeId));

            await writeTradeAudit({
              tradeId,
              eventType: "POSITION_CLOSE_REJECTED",
              eventCategory: "TRADE",
              ctx: closeAuditCtx,
              orderId,
              positionId,
              symbol: q.symbol,
              side: trade.type as string,
              requestedPrice: q.execPrice,
              quoteBid: q.bid,
              quoteAsk: q.ask,
              quoteMid: q.mid,
              quoteSpread: q.spread,
              quoteTs: q.quoteTs,
              quoteSource: `stale:${q.source}`,
              riskResult: "REJECT",
              reasonCode: "QUOTE_STALE",
              note: `Rejected manual close due to stale quote (ageMs=${quoteAgeMs})`,
              payload: { quoteAgeMs },
            });
          } catch (auditErr) {
            console.error("Error writing POSITION_CLOSE_REJECTED audit:", auditErr);
          }

          res.setHeader("Retry-After", "1");
          return res.status(409).json({
            code: "QUOTE_STALE_CLOSE",
            message: `Cannot close trade: quote data for ${q.symbol} is stale. Please wait for fresh market data.`,
            symbol: q.symbol,
            quoteTs: Math.floor(q.quoteTs.getTime() / 1000),
            quoteAgeMs,
          });
        }

        const closePrice = q.execPrice;
        const openPrice = parseFloat(String(trade.openPrice));
        const lots = typeof trade.lots === "string" ? Number(trade.lots) : Number(trade.lots ?? 1);
        const excursion = resolveTradeExcursionForClose({
          tradeId,
          side: trade.type as "BUY" | "SELL",
          openPrice,
          closePrice,
          intradayHigh: (trade as any).intradayHigh,
          intradayLow: (trade as any).intradayLow,
        });

        // Use proper P/L calculation that handles JPY and cross pairs correctly
        const pnlUsd = await realizedPnlUsd({
          symbol: q.symbol,
          side: trade.type as "BUY" | "SELL",
          lots,
          openPrice,
          closePrice,
        });
        const closeCostSummary = await computeCloseSettlementCosts({
          category: (trade as any).categorySnapshot ?? (trade as any).symbol?.category ?? (symbolConfig as any).category,
          positionSide: trade.type as "BUY" | "SELL",
          notionalUsd: (trade as any).notionalUsd,
          size: Number((trade as any).size ?? lots * 100000),
          lots,
          openedAt: trade.openedAt,
          executedAt: (trade as any).executedAt,
          closedAtMs: q.quoteTs.getTime(),
          openCommissionUsd: (trade as any).openCommissionUsd,
          openOtherFeesUsd: (trade as any).openOtherFeesUsd,
        });
        const grossProfitUsd = pnlUsd;
        const netProfitUsd = grossProfitUsd - closeCostSummary.totalCostsUsd;
        const closeSettlementUsd = grossProfitUsd - closeCostSummary.closingChargesUsd;

        // Build audit context for this close request
        const closeAuditCtx = buildAuditContext(req);
        const correlationId = (trade as any).correlationId || generateCorrelationId();
        const orderId = (trade as any).orderId || generateOrderId();
        const positionId = (trade as any).positionId || generatePositionId();
        const executionId = generateExecutionId();

        closeAuditCtx.correlationId = correlationId;

        const closeSource = q.isStale ? `stale:${q.source}` : q.source;
        const closeResult = await db.transaction(async (tx) => {
          const tradeLock = await tx.execute(sql`
            select id
            from trades
            where id = ${tradeId} and user_id = ${req.session.userId} and status = 'OPEN'
            for update
          `);
          if (!tradeLock.rows.length) return null;

          const userRowRes = await tx.execute(sql`
            select id, leverage
            from users
            where id = ${req.session.userId}
            for update
          `);
          const leverageNow = Number((userRowRes.rows[0] as any)?.leverage ?? 5);
          const marginToRelease = requiredMargin(q.symbol, lots, closePrice, leverageNow);

          const closedRows = await tx.update(trades)
            .set({
              status: "CLOSED",
              closePrice,
              profit: netProfitUsd.toFixed(2),
              grossProfitUsd,
              netProfitUsd,
              intradayHigh: excursion.intradayHigh,
              intradayLow: excursion.intradayLow,
              mae: excursion.mae,
              mfe: excursion.mfe,
              notionalUsd: closeCostSummary.notionalUsd,
              totalCostsUsd: closeCostSummary.totalCostsUsd,
              closeCommissionUsd: closeCostSummary.closeCommissionUsd,
              closeOtherFeesUsd: closeCostSummary.closeOtherFeesUsd,
              financingAccruedUsd: closeCostSummary.financingAccruedUsd,
              swapAccruedUsd: closeCostSummary.swapAccruedUsd,
              overnightDays: closeCostSummary.overnightDays,
              categorySnapshot: closeCostSummary.categorySnapshot,
              costModelVersion: closeCostSummary.costModelVersion,
              closeReason: "MANUAL",
              closedAt: Math.floor(Date.now() / 1000),
              closeQuoteTs: Math.floor(q.quoteTs.getTime() / 1000),
              closeSource,
              closeBid: q.bid,
              closeAsk: q.ask,
              closeMid: q.mid,
              closeSpread: q.spread,
              correlationId,
              orderId,
              positionId,
              lastExecutionId: executionId,
              lastActorUserId: req.session.userId,
              lastActorSessionId: closeAuditCtx.sessionId,
              lastActorIp: closeAuditCtx.ip,
              lastActorUserAgent: closeAuditCtx.userAgent,
              lastActorType: closeAuditCtx.actorType,
            })
            .where(and(eq(trades.id, tradeId), eq(trades.userId, req.session.userId), eq(trades.status, "OPEN")))
            .returning();

          const closedTrade = closedRows[0];
          if (!closedTrade) return null;

          await applyUserBalanceDelta(tx, { userId: req.session.userId, deltaUsd: closeSettlementUsd });
          await releaseUserMargin(tx, { userId: req.session.userId, marginUsd: marginToRelease });

          const slippagePoints = 0; // No slippage on manual close
          await writeTradeAudit({
            tradeId,
            eventType: "POSITION_CLOSED",
            eventCategory: "TRADE",
            ctx: closeAuditCtx,
            orderId,
            positionId,
            executionId,
            symbol: q.symbol,
            side: trade.type as string,
            qtyLots: lots,
            requestedPrice: closePrice,
            fillPrice: closePrice,
            avgFillPrice: closePrice,
            quoteBid: q.bid,
            quoteAsk: q.ask,
            quoteMid: q.mid,
            quoteSpread: q.spread,
            quoteTs: q.quoteTs,
            quoteSource: closeSource,
            spreadPips: calculateSpreadPips(q.symbol, q.spread, (trade as any).symbol?.pipDecimals),
            slippage: slippagePoints,
            slippagePips: 0,
            slippageReference: "manual_close",
            riskResult: "PASS",
            reasonCode: "MANUAL",
            note: `Manual close at ${closePrice}, gross=${grossProfitUsd.toFixed(2)}, net=${netProfitUsd.toFixed(2)}`,
            payload: {
              closeReason: "MANUAL",
              openPrice,
              grossProfitUsd: grossProfitUsd.toFixed(2),
              netProfitUsd: netProfitUsd.toFixed(2),
              balanceDeltaUsd: closeSettlementUsd.toFixed(2),
              costModelVersion: closeCostSummary.costModelVersion,
              categorySnapshot: closeCostSummary.categorySnapshot,
              notionalUsd: closeCostSummary.notionalUsd,
              openCommissionUsd: closeCostSummary.openCommissionUsd,
              openOtherFeesUsd: closeCostSummary.openOtherFeesUsd,
              closeCommissionUsd: closeCostSummary.closeCommissionUsd,
              closeOtherFeesUsd: closeCostSummary.closeOtherFeesUsd,
              financingAccruedUsd: closeCostSummary.financingAccruedUsd,
              swapAccruedUsd: closeCostSummary.swapAccruedUsd,
              overnightDays: closeCostSummary.overnightDays,
              holdDays: closeCostSummary.holdDays,
              totalCostsUsd: closeCostSummary.totalCostsUsd,
            },
          }, { db: tx });

          return closedTrade;
        });

        if (!closeResult) {
          return res.status(409).json({ message: "Trade is already closed" });
        }

        clearTradeExcursion(tradeId);

        try {
          await recalcAccount(req.session.userId, { emit: true, reason: "TRADE_CLOSED" });
        } catch (accountError) {
          console.error("Failed to update account after closing trade:", accountError);
        }

        // Notify ALL browser sessions for this user that trades changed (multi-device sync)
        // Include userId in payload so clients can filter, but also send to unauth'd clients
        const targetUserId = req.session.userId;
        broadcast(
          { type: "trades:updated", userId: targetUserId },
          (client) => client.userId === targetUserId || client.userId === undefined
        );

        // Grift detection: record close activity (supports churn/concurrency + identity linking)
        if (isPostgres) {
          try {
            const griftCtx = extractGriftContext(req);
            await withGriftClient(async (griftDb) => {
              const griftAuditCtx: GriftAuditContext = {
                ts: Date.now(),
                userId: req.session.userId,
                sessionId: req.sessionID,
                deviceId: griftCtx.deviceId ?? undefined,
                deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
                deviceFp: griftCtx.deviceFp ?? undefined,
                deviceInstallId: griftCtx.deviceInstallId ?? undefined,
                clientTz: griftCtx.clientTz ?? undefined,
                clientLang: griftCtx.clientLang ?? undefined,
                eventType: "TRADE_CLOSE",
                ip: griftCtx.ip ?? undefined,
                userAgent: griftCtx.userAgent ?? undefined,
                geoCountry: griftCtx.geoCountry ?? undefined,
                geoRegion: griftCtx.geoRegion ?? undefined,
                geoCity: griftCtx.geoCity ?? undefined,
                latitude: griftCtx.latitude ?? undefined,
                longitude: griftCtx.longitude ?? undefined,
                asn: griftCtx.asn ?? undefined,
                org: griftCtx.org ?? undefined,
              };

              await onSessionActivity(griftDb, griftAuditCtx);

              try {
                await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
              } catch (enfErr) {
                console.error("[Grift] Auto-enforcement failed (trade close):", enfErr);
              }
            });
          } catch (griftErr) {
            console.error("Error in grift detection on trade close:", griftErr);
          }
        }

        res.json(closeResult);
      } catch (error) {
        console.error("Close trade error:", error);
        res.status(500).json({ message: "Failed to close trade" });
      }
    });

  // Update take profit and stop loss for an open trade
  app.patch(
    "/api/trades/:id/targets",
    ensureAuth,
    ensureDoc1TermsAccepted,
    requirePolicy("TRADE_MODIFY_SLTP"),
    async (req: Request, res: Response, next: NextFunction) => {
      const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
      if (!bg.allowed) return;
      next();
    },
    async (req: Request, res: Response) => {
      try {
        const session = req.session as SessionData;

        const tradeId = parseInt(req.params.id);
        const { takeProfit, stopLoss } = req.body;
        const tpNext =
          takeProfit === null || takeProfit === undefined || takeProfit === ""
            ? null
            : Number(takeProfit);
        const slNext =
          stopLoss === null || stopLoss === undefined || stopLoss === ""
            ? null
            : Number(stopLoss);

        if (tpNext !== null && !Number.isFinite(tpNext)) {
          return res.status(400).json({ code: "TAKE_PROFIT_INVALID", message: "Invalid takeProfit value" });
        }
        if (slNext !== null && !Number.isFinite(slNext)) {
          return res.status(400).json({ code: "STOP_LOSS_INVALID", message: "Invalid stopLoss value" });
        }

        const trade = await storage.getTradeById(tradeId);
        if (!trade) {
          return res.status(404).json({ message: "Trade not found" });
        }

        if (trade.userId !== session.userId) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (trade.status !== "OPEN" && trade.status !== "PENDING") {
          return res.status(400).json({ message: "Trade is not open or pending" });
        }

        // Store previous values for audit
        const prevTp = trade.takeProfit ? parseFloat(String(trade.takeProfit)) : null;
        const prevSl = trade.stopLoss ? parseFloat(String(trade.stopLoss)) : null;

        // Server-side TP/SL validation using authoritative prices.
        // For PENDING orders, validate relative to intended entry; for OPEN positions, validate relative to the current close-side price (BUY=bid, SELL=ask).
        let symbolConfig = (trade as any).symbol ? (trade as any).symbol : null;
        if (!symbolConfig) symbolConfig = await storage.getSymbolConfigById(trade.symbolId);
        const symbol = symbolConfig?.symbol ? String(symbolConfig.symbol) : null;

        if (!symbol) {
          return res.status(404).json({ message: "Symbol configuration not found" });
        }

        const side = String(trade.type ?? "").toUpperCase() as "BUY" | "SELL";
        const pipSize = getPipSize({
          symbol,
          category: symbolConfig?.category,
          quoteCurrency: symbolConfig?.quoteCurrency,
          pipDecimals: symbolConfig?.pipDecimals,
          quoteDecimals: symbolConfig?.quoteDecimals,
        });
        const priceDecimals = getQuoteDecimals({
          symbol,
          category: symbolConfig?.category,
          quoteCurrency: symbolConfig?.quoteCurrency,
          pipDecimals: symbolConfig?.pipDecimals,
          quoteDecimals: symbolConfig?.quoteDecimals,
        });
        const minPips = await getMinPriceDistancePips();
        const minDist = minPips * pipSize;

        let refPrice: number | null = null;
        let q: any | null = null;

        if (trade.status === "PENDING") {
          const ot = String((trade as any).orderType ?? "").trim().toUpperCase();
          const intendedEntryRaw =
            ot === "LIMIT"
              ? (trade as any).limitPrice
              : ot === "STOP"
                ? (trade as any).stopPrice
                : (trade as any).limitPrice ?? (trade as any).stopPrice ?? (trade as any).openPrice;
          const intendedEntry = intendedEntryRaw == null ? null : Number(intendedEntryRaw);
          if (intendedEntry !== null && Number.isFinite(intendedEntry)) {
            refPrice = intendedEntry;
          }
          if (refPrice === null) {
            return res.status(400).json({
              code: "ORDER_PRICE_MISSING",
              message: "Cannot update targets: pending order has no valid reference price.",
              symbol,
            });
          }
        } else if (trade.status === "OPEN") {
          try {
            q = await getExecutionQuote(symbol, side, "CLOSE");
          } catch {
            return res.status(503).json({
              code: "QUOTE_UNAVAILABLE",
              message: "Live price unavailable. Try again shortly.",
              symbol,
            });
          }

          // Only enforce stale-quote blocking while the market is open.
          if (q.marketOpen && q.isStale) {
            const quoteAgeMs = Math.max(0, Date.now() - q.quoteTs.getTime());
            const targetsAuditCtx = buildAuditContext(req);
            const correlationId = (trade as any).correlationId || generateCorrelationId();
            const orderId = (trade as any).orderId || generateOrderId();
            const positionId = (trade as any).positionId || generatePositionId();

            targetsAuditCtx.correlationId = correlationId;

            metricTradeTargetsRejectedQuoteStaleTotal += 1;

            try {
              await db.update(trades)
                .set({
                  correlationId,
                  orderId,
                  positionId,
                  lastActorUserId: session.userId,
                  lastActorSessionId: targetsAuditCtx.sessionId,
                  lastActorIp: targetsAuditCtx.ip,
                  lastActorUserAgent: targetsAuditCtx.userAgent,
                  lastActorType: targetsAuditCtx.actorType,
                })
                .where(eq(trades.id, tradeId));

              await writeTradeAudit({
                tradeId,
                eventType: "TARGETS_UPDATE_REJECTED",
                eventCategory: "MODIFICATION",
                ctx: targetsAuditCtx,
                orderId,
                positionId,
                symbol,
                side: trade.type as string,
                stopPrice: slNext,
                limitPrice: tpNext,
                quoteBid: q.bid,
                quoteAsk: q.ask,
                quoteMid: q.mid,
                quoteSpread: q.spread,
                spreadPips: calculateSpreadPips(symbol, q.spread, symbolConfig?.pipDecimals),
                quoteTs: q.quoteTs,
                quoteSource: `stale:${q.source}`,
                riskResult: "REJECT",
                reasonCode: "QUOTE_STALE",
                note: `Rejected targets update due to stale quote (ageMs=${quoteAgeMs})`,
                payload: { quoteAgeMs, previousTakeProfit: prevTp, previousStopLoss: prevSl, newTakeProfit: tpNext, newStopLoss: slNext },
              });
            } catch (auditErr) {
              console.error("Error writing TARGETS_UPDATE_REJECTED audit:", auditErr);
            }

            res.setHeader("Retry-After", "1");
            return res.status(409).json({
              code: "QUOTE_STALE_MODIFY",
              message: `Cannot update targets: quote data for ${symbol} is stale. Please wait for fresh market data.`,
              symbol,
              quoteTs: Math.floor(q.quoteTs.getTime() / 1000),
              quoteAgeMs,
            });
          }

          refPrice = q.execPrice;
        }

        if (refPrice !== null && Number.isFinite(refPrice)) {
          if (side === "BUY") {
            if (slNext !== null && priceGreaterThan(slNext, refPrice - minDist, priceDecimals)) {
              return res.status(400).json({
                code: "STOP_LOSS_TOO_CLOSE",
                message: `BUY SL must be at least ${minPips} pips below reference price. Maximum: ${(refPrice - minDist).toFixed(priceDecimals)}`,
                symbol,
                minPips,
                minPoints: minPips,
              });
            }
            if (tpNext !== null && priceLessThan(tpNext, refPrice + minDist, priceDecimals)) {
              return res.status(400).json({
                code: "TAKE_PROFIT_TOO_CLOSE",
                message: `BUY TP must be at least ${minPips} pips above reference price. Minimum: ${(refPrice + minDist).toFixed(priceDecimals)}`,
                symbol,
                minPips,
                minPoints: minPips,
              });
            }
          } else if (side === "SELL") {
            if (slNext !== null && priceLessThan(slNext, refPrice + minDist, priceDecimals)) {
              return res.status(400).json({
                code: "STOP_LOSS_TOO_CLOSE",
                message: `SELL SL must be at least ${minPips} pips above reference price. Minimum: ${(refPrice + minDist).toFixed(priceDecimals)}`,
                symbol,
                minPips,
                minPoints: minPips,
              });
            }
            if (tpNext !== null && priceGreaterThan(tpNext, refPrice - minDist, priceDecimals)) {
              return res.status(400).json({
                code: "TAKE_PROFIT_TOO_CLOSE",
                message: `SELL TP must be at least ${minPips} pips below reference price. Maximum: ${(refPrice - minDist).toFixed(priceDecimals)}`,
                symbol,
                minPips,
                minPoints: minPips,
              });
            }
          }
        }

        const updatedTrade = await storage.updateTradeTargets(tradeId, tpNext, slNext);
        if (!updatedTrade) {
          return res.status(409).json({ message: "Trade is no longer open or pending" });
        }

        // AUDIT: Write TARGETS_UPDATED event
        try {
          const targetsAuditCtx = buildAuditContext(req);
          const correlationId = (trade as any).correlationId || generateCorrelationId();
          const orderId = (trade as any).orderId || generateOrderId();
          const positionId = (trade as any).positionId || generatePositionId();

          await db.update(trades)
            .set({
              correlationId,
              orderId,
              positionId,
              lastActorUserId: session.userId,
              lastActorSessionId: targetsAuditCtx.sessionId,
              lastActorIp: targetsAuditCtx.ip,
              lastActorUserAgent: targetsAuditCtx.userAgent,
              lastActorType: targetsAuditCtx.actorType,
            })
            .where(eq(trades.id, tradeId));

          targetsAuditCtx.correlationId = correlationId;

          const symbolForAudit = symbol;
          let q = null;
          if (symbolForAudit) {
            try {
              q = await getExecutionQuote(symbolForAudit, trade.type as "BUY" | "SELL", "CLOSE");
            } catch { }
          }

          await writeTradeAudit({
            tradeId,
            eventType: "TARGETS_UPDATED",
            eventCategory: "MODIFICATION",
            ctx: targetsAuditCtx,
            orderId,
            positionId,
            symbol: symbolForAudit,
            side: trade.type as string,
            stopPrice: slNext,
            quoteBid: q?.bid ?? null,
            quoteAsk: q?.ask ?? null,
            quoteMid: q?.mid ?? null,
            quoteSpread: q?.spread ?? null,
            spreadPips: q ? calculateSpreadPips(symbolForAudit || "", q.spread, symbolConfig?.pipDecimals) : null,
            quoteTs: q?.quoteTs ?? null,
            quoteSource: q?.source ?? null,
            note: `TP: ${prevTp ?? 'none'} → ${tpNext ?? 'none'}, SL: ${prevSl ?? 'none'} → ${slNext ?? 'none'}`,
            payload: {
              previousTakeProfit: prevTp,
              previousStopLoss: prevSl,
              newTakeProfit: tpNext,
              newStopLoss: slNext,
            },
          });
        } catch (auditErr) {
          console.error("Error writing TARGETS_UPDATED audit:", auditErr);
        }

        // Notify ALL browser sessions for this user that trades changed (multi-device sync)
        const targetUserId = session.userId;
        broadcast(
          { type: "trades:updated", userId: targetUserId },
          (client) => client.userId === targetUserId || client.userId === undefined
        );

        // Grift detection: record modification activity (supports churn/concurrency + identity linking)
        if (isPostgres) {
          try {
            const griftCtx = extractGriftContext(req);
            await withGriftClient(async (griftDb) => {
              const griftAuditCtx: GriftAuditContext = {
                ts: Date.now(),
                userId: session.userId,
                sessionId: req.sessionID,
                deviceId: griftCtx.deviceId ?? undefined,
                deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
                deviceFp: griftCtx.deviceFp ?? undefined,
                deviceInstallId: griftCtx.deviceInstallId ?? undefined,
                clientTz: griftCtx.clientTz ?? undefined,
                clientLang: griftCtx.clientLang ?? undefined,
                eventType: "TRADE_TARGETS_UPDATE",
                ip: griftCtx.ip ?? undefined,
                userAgent: griftCtx.userAgent ?? undefined,
                geoCountry: griftCtx.geoCountry ?? undefined,
                geoRegion: griftCtx.geoRegion ?? undefined,
                geoCity: griftCtx.geoCity ?? undefined,
                latitude: griftCtx.latitude ?? undefined,
                longitude: griftCtx.longitude ?? undefined,
                asn: griftCtx.asn ?? undefined,
                org: griftCtx.org ?? undefined,
              };

              await onSessionActivity(griftDb, griftAuditCtx);

              try {
                await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
              } catch (enfErr) {
                console.error("[Grift] Auto-enforcement failed (trade targets update):", enfErr);
              }
            });
          } catch (griftErr) {
            console.error("Error in grift detection on trade targets update:", griftErr);
          }
        }

        res.json(updatedTrade);
      } catch (error) {
        console.error("Error updating trade targets:", error);
        res.status(500).json({ message: "Failed to update trade targets" });
      }
    });

  // Cancel a pending trade
  app.patch(
    "/api/trades/:id/cancel",
    ensureAuth,
    ensureDoc1TermsAccepted,
    requirePolicy("TRADE_CANCEL_PENDING"),
    async (req: Request, res: Response, next: NextFunction) => {
      const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
      if (!bg.allowed) return;
      next();
    },
    async (req: Request, res: Response) => {
      try {
        const session = req.session as SessionData;

        const tradeId = parseInt(req.params.id);
        const trade = await storage.getTradeById(tradeId);

        if (!trade) {
          return res.status(404).json({ message: "Trade not found" });
        }

        if (trade.userId !== session.userId) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (trade.status !== "PENDING") {
          return res.status(400).json({ message: "Trade is not pending" });
        }

        // Build audit context
        const cancelAuditCtx = buildAuditContext(req);
        const correlationId = (trade as any).correlationId || generateCorrelationId();
        const orderId = (trade as any).orderId || generateOrderId();
        const positionId = (trade as any).positionId || generatePositionId();

        await db.update(trades)
          .set({
            correlationId,
            orderId,
            positionId,
            lastActorUserId: session.userId,
            lastActorSessionId: cancelAuditCtx.sessionId,
            lastActorIp: cancelAuditCtx.ip,
            lastActorUserAgent: cancelAuditCtx.userAgent,
            lastActorType: cancelAuditCtx.actorType,
          })
          .where(eq(trades.id, tradeId));

        cancelAuditCtx.correlationId = correlationId;

        const symbol = (trade as any).symbol?.symbol ?? null;
        let q = null;
        if (symbol) {
          try {
            q = await getExecutionQuote(symbol, trade.type as "BUY" | "SELL", "OPEN");
          } catch { }
        }

        const canceledTrade = await storage.cancelTrade(tradeId);

        // AUDIT: Write ORDER_CANCELED with full provenance
        if (canceledTrade) {
          try {
            await writeTradeAudit({
              tradeId,
              eventType: "ORDER_CANCELED",
              eventCategory: "TRADE",
              ctx: cancelAuditCtx,
              orderId,
              positionId,
              symbol,
              side: trade.type as string,
              orderType: trade.orderType as string,
              qtyLots: typeof trade.lots === "string" ? Number(trade.lots) : Number(trade.lots ?? 1),
              limitPrice: trade.limitPrice ? parseFloat(String(trade.limitPrice)) : null,
              stopPrice: trade.stopPrice ? parseFloat(String(trade.stopPrice)) : null,
              quoteBid: q?.bid ?? null,
              quoteAsk: q?.ask ?? null,
              quoteMid: q?.mid ?? null,
              quoteSpread: q?.spread ?? null,
              spreadPips: q ? calculateSpreadPips(symbol || "", q.spread, (trade as any).symbol?.pipDecimals) : null,
              quoteTs: q?.quoteTs ?? null,
              quoteSource: q?.source ?? null,
              reasonCode: "CANCELED_BY_USER",
              note: `User canceled pending ${trade.orderType} order`,
              payload: { originalOrderType: trade.orderType },
            });
          } catch (auditErr) {
            console.error("Error writing ORDER_CANCELED audit:", auditErr);
          }
        }

        // Notify ALL browser sessions for this user that trades changed (multi-device sync)
        const targetUserId = session.userId;
        broadcast(
          { type: "trades:updated", userId: targetUserId },
          (client) => client.userId === targetUserId || client.userId === undefined
        );

        // Grift detection: record cancel activity (supports churn/concurrency + identity linking)
        if (isPostgres) {
          try {
            const griftCtx = extractGriftContext(req);
            await withGriftClient(async (griftDb) => {
              const griftAuditCtx: GriftAuditContext = {
                ts: Date.now(),
                userId: session.userId,
                sessionId: req.sessionID,
                deviceId: griftCtx.deviceId ?? undefined,
                deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
                deviceFp: griftCtx.deviceFp ?? undefined,
                deviceInstallId: griftCtx.deviceInstallId ?? undefined,
                clientTz: griftCtx.clientTz ?? undefined,
                clientLang: griftCtx.clientLang ?? undefined,
                eventType: "TRADE_CANCEL_PENDING",
                ip: griftCtx.ip ?? undefined,
                userAgent: griftCtx.userAgent ?? undefined,
                geoCountry: griftCtx.geoCountry ?? undefined,
                geoRegion: griftCtx.geoRegion ?? undefined,
                geoCity: griftCtx.geoCity ?? undefined,
                latitude: griftCtx.latitude ?? undefined,
                longitude: griftCtx.longitude ?? undefined,
                asn: griftCtx.asn ?? undefined,
                org: griftCtx.org ?? undefined,
              };

              await onSessionActivity(griftDb, griftAuditCtx);

              try {
                await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
              } catch (enfErr) {
                console.error("[Grift] Auto-enforcement failed (trade cancel):", enfErr);
              }
            });
          } catch (griftErr) {
            console.error("Error in grift detection on trade cancel:", griftErr);
          }
        }

        res.json(canceledTrade);
      } catch (error) {
        console.error("Error canceling trade:", error);
        res.status(500).json({ message: "Failed to cancel trade" });
      }
    });

  // Get pending trades for current user
  app.get("/api/trades/pending", async (req: Request, res: Response) => {
    try {
      const session = req.session as SessionData;
      if (!session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const pendingTrades = await storage.getPendingTradesByUserId(session.userId);
      res.json(pendingTrades);
    } catch (error) {
      console.error("Error fetching pending trades:", error);
      res.status(500).json({ message: "Failed to fetch pending trades" });
    }
  });

  app.get("/api/leaderboard", async (req: Request, res: Response) => {
    try {
      const [cfg] = await db
        .select({ leaderboardMode: systemConfig.leaderboardMode })
        .from(systemConfig)
        .where(eq(systemConfig.id, 1))
        .limit(1);

      const modeRaw = String(cfg?.leaderboardMode || "PUBLIC").toUpperCase();
      const mode = modeRaw === "TOP_10" || modeRaw === "DISABLED" ? modeRaw : "PUBLIC";

      if (mode === "DISABLED") {
        return res.json([]);
      }

      const limit = mode === "TOP_10" ? 10 : 100;
      const leaderboard = await storage.getLeaderboard(limit);
      res.json(leaderboard);
    } catch (error) {
      console.error("Get leaderboard error:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  // ====== TRADER JOURNAL API ======

  const VALID_MOODS = ["confident", "calm", "anxious", "frustrated", "fearful", "greedy", "neutral"];

  // Get journal entries for current user
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

  // Create a new journal entry
  app.post("/api/journal", ensureAuth, async (req: Request, res: Response) => {
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
          const tradeIdNum = parseInt(tid);
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
  app.put("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
    try {
      const entryId = parseInt(req.params.id);
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
          const parsedTradeId = parseInt(tradeId);
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
  app.delete("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
    try {
      const entryId = parseInt(req.params.id);
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

  async function loadQuoteSnapshotConfig() {
    let staleThresholdMs = 30000;
    let fxRolloverTz = "America/New_York";
    let fxRolloverTime = "17:00";
    try {
      const cfg = await db.query.systemConfig.findFirst({
        where: eq(systemConfig.id, 1),
      });
      if ((cfg as any)?.staleThresholdMs) staleThresholdMs = Number((cfg as any).staleThresholdMs);
      if ((cfg as any)?.fxRolloverTz) fxRolloverTz = String((cfg as any).fxRolloverTz);
      if ((cfg as any)?.fxRolloverTime) fxRolloverTime = String((cfg as any).fxRolloverTime);
    } catch { }
    return { staleThresholdMs, fxRolloverTz, fxRolloverTime };
  }

  async function loadPrevCloseMap(symbols: string[], currentSessionDay: string) {
    const map = new Map<string, number>();
    if (!symbols.length) return map;
    const prevRows = await dbClient.query(
      `
      SELECT DISTINCT ON (symbol) symbol, close
      FROM market_daily_close
      WHERE symbol = ANY($1::text[]) AND session_day < $2
      ORDER BY symbol, session_day DESC
      `,
      [symbols, currentSessionDay],
    );
    for (const row of prevRows.rows) {
      if (!row?.symbol) continue;
      const close = Number(row.close);
      if (Number.isFinite(close)) map.set(String(row.symbol), close);
    }
    const missing = symbols.filter((sym) => !map.has(sym));
    if (!missing.length) return map;
    const fallbackRows = await dbClient.query(
      `
      SELECT DISTINCT ON (symbol) symbol, close
      FROM market_daily_close
      WHERE symbol = ANY($1::text[])
      ORDER BY symbol, session_day DESC
      `,
      [missing],
    );
    for (const row of fallbackRows.rows) {
      if (!row?.symbol) continue;
      const close = Number(row.close);
      if (Number.isFinite(close)) map.set(String(row.symbol), close);
    }
    return map;
  }

  function buildQuoteView(quote: any, prevCloseMap: Map<string, number>, nowMs: number, staleThresholdMs: number) {
    const bid = typeof quote.bid === "number" ? quote.bid : null;
    const ask = typeof quote.ask === "number" ? quote.ask : null;
    const lastPrice = typeof quote.price === "number" ? quote.price : typeof quote.lastPrice === "number" ? quote.lastPrice : null;
    const midPrice = bid != null && ask != null ? (bid + ask) / 2 : lastPrice;
    const spread = bid != null && ask != null ? Math.abs(ask - bid) : null;
    const prevClose = prevCloseMap.get(String(quote.symbol)) ?? (typeof quote.prevClose === "number" ? quote.prevClose : null);

    let pctChange = 0;
    if (prevClose != null && prevClose > 0 && Number.isFinite(midPrice)) {
      pctChange = ((midPrice - prevClose) / prevClose) * 100;
      pctChange = Math.round(pctChange * 100) / 100;
    }

    const change = Number.isFinite(midPrice) && prevClose != null ? midPrice - prevClose : 0;
    const rawLastUpdate = Number(
      quote.lastApiUpdate ??
      quote.last_api_update ??
      quote.lastUpdated ??
      quote.updatedAt ??
      quote.updated_at ??
      nowMs,
    );
    const lastUpdate = rawLastUpdate < 1e12 ? rawLastUpdate * 1000 : rawLastUpdate;
    const ageMs = nowMs - lastUpdate;
    const dbIsStale = quote.isStale === 1 || quote.isStale === true;
    const marketOpen = isMarketOpenForSymbol(String(quote.symbol), new Date(nowMs));
    const isStale = dbIsStale || (marketOpen && ageMs > staleThresholdMs);

    return {
      symbol: quote.symbol,
      bid,
      ask,
      price: midPrice,
      spread,
      prevClose: prevClose ?? midPrice,
      change,
      pctChange,
      marketOpen,
      isStale,
      lastApiUpdate: lastUpdate,
      dataAge: ageMs,
    };
  }

  async function buildQuoteSnapshotResponse(symbols?: string[]) {
    await ensureMarketDailyCloseTable();
    const { staleThresholdMs, fxRolloverTz, fxRolloverTime } = await loadQuoteSnapshotConfig();
    const currentSessionDay = computeCurrentSessionDay({
      tz: fxRolloverTz,
      time: fxRolloverTime,
    });
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    const hubMeta = getQuoteMeta();
    if (hubMeta.size > 0) {
      const hubSnapshot = getQuoteSnapshot(symbols);
      const symbolList = hubSnapshot.rows.map((row) => String(row.symbol));
      const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
      const enhancedQuotes = hubSnapshot.rows.map((quote) => ({
        ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
        timestamp: nowSec,
      }));
      return { rows: enhancedQuotes, seq: hubSnapshot.seq, asOf: hubSnapshot.asOf };
    }

    const valkeySnapshot = await getValkeySnapshot(symbols);
    if (valkeySnapshot?.rows?.length) {
      const symbolList = valkeySnapshot.rows.map((row) => String(row.symbol));
      const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
      const enhancedQuotes = valkeySnapshot.rows.map((quote) => ({
        ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
        timestamp: nowSec,
      }));
      return { rows: enhancedQuotes, seq: valkeySnapshot.seq ?? 0, asOf: valkeySnapshot.asOf ?? nowMs };
    }

    // If the snapshot key expired, fall back to per-symbol Valkey keys (q:v1:*) before hitting Postgres.
    if (symbols?.length) {
      const valkeyRows = await getValkeyQuoteRows(symbols);
      if (valkeyRows.length) {
        const symbolList = valkeyRows.map((row) => String(row.symbol));
        const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
        const enhancedQuotes = valkeyRows.map((quote) => ({
          ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
          timestamp: nowSec,
        }));
        return { rows: enhancedQuotes, seq: 0, asOf: nowMs };
      }
    }

    const quotesTable = await dbClient.query("SELECT to_regclass('public.quotes') as table_name");
    if (!quotesTable.rows?.[0]?.table_name) {
      return { rows: [], seq: 0, asOf: nowMs };
    }

    const params: any[] = [nowMs, currentSessionDay];
    const filterClause = symbols?.length ? "WHERE q.symbol = ANY($3::text[])" : "";
    if (symbols?.length) params.push(symbols);

    const quotesResult = await dbClient.query(
      `
      SELECT
        q.symbol,
        q.bid,
        q.ask,
        q.price AS "lastPrice",
        COALESCE(q.is_stale, false) AS "isStale",
        COALESCE(q.last_api_update, q.updated_at, $1) AS "lastApiUpdate",
        COALESCE(
          (
            SELECT dc.close
            FROM market_daily_close dc
            WHERE dc.symbol = q.symbol AND dc.session_day < $2
            ORDER BY dc.session_day DESC
            LIMIT 1
          ),
          (
            SELECT dc2.close
            FROM market_daily_close dc2
            WHERE dc2.symbol = q.symbol
            ORDER BY dc2.session_day DESC
            LIMIT 1
          )
        ) AS "prevClose"
      FROM quotes q
      ${filterClause}
      `,
      params,
    );
    const quotes = quotesResult.rows;
    const symbolList = quotes.map((row: any) => String(row.symbol));
    const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
    const enhancedQuotes = quotes.map((quote: any) => ({
      ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
      timestamp: nowSec,
    }));

    return { rows: enhancedQuotes, seq: 0, asOf: nowMs };
  }

  // Quotes endpoint for getting real-time price data
  // Add endpoint for getting all latest quotes (for REST polling)
  function normalizeSymbolsInputRaw(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  async function getAllowedQuoteSymbolsForRequest(req: Request): Promise<Set<string>> {
    const sessionUserId = Number(req.session?.userId ?? 0);
    const userId = Number.isInteger(sessionUserId) && sessionUserId > 0 ? sessionUserId : null;
    return getAllowedSymbolsForUser(userId);
  }

  app.get("/api/quotes/latest", async (req: Request, res: Response) => {
    try {
      const rawSymbols = String(req.query.symbols ?? "").trim();
      const requestedSymbols = rawSymbols ? normalizeSymbolsInputRaw(rawSymbols) : null;
      const allowedSymbols = await getAllowedQuoteSymbolsForRequest(req);

      const snapshotSymbols = requestedSymbols
        ? requestedSymbols.filter((symbol) => allowedSymbols.has(symbol))
        : Array.from(allowedSymbols.values());

      if (!snapshotSymbols.length) {
        return res.json([]);
      }

      const snapshot = await buildQuoteSnapshotResponse(snapshotSymbols);
      const requestedSet = new Set(snapshotSymbols);
      const rows = snapshot.rows.filter((row: any) => {
        const symbol = String(row?.symbol ?? "").toUpperCase();
        if (!symbol) return false;
        return allowedSymbols.has(symbol) && requestedSet.has(symbol);
      });

      return res.json(rows);
    } catch (error) {
      console.error("Error fetching latest quotes:", error);
      return res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  // Get individual quote by symbol
  app.get("/api/quotes/:symbol", async (req: Request, res: Response) => {
    const symbol = req.params.symbol.toUpperCase();

    try {
      const allowedSymbols = await getAllowedQuoteSymbolsForRequest(req);
      if (!allowedSymbols.has(symbol)) {
        return res.status(403).json({ message: `Quote access denied for ${symbol}` });
      }

      let quote: any | null = getQuote(symbol);

      if (!quote) {
        const valkeyRows = await getValkeyQuoteRows([symbol]);
        if (valkeyRows.length) quote = valkeyRows[0];
      }

      if (!quote) {
        quote = await db.query.quotes.findFirst({
          where: eq(quotes.symbol, symbol),
        });
      }

      if (quote) {
        // Calculate spread from bid and ask prices
        const bid = typeof quote.bid === "number" ? quote.bid : null;
        const ask = typeof quote.ask === "number" ? quote.ask : null;
        const spread = bid != null && ask != null ? Math.abs(ask - bid) : null;

        res.json({ ...quote, spread });
      } else {
        res.status(404).json({ message: `No price data available for ${symbol}` });
      }
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      res.status(500).json({ message: 'Failed to fetch quote data' });
    }
  });

  // Register additional routes
  registerAdminRoutes(app);
  registerMarketRoutes(app);
  registerMetaRoutes(app);
  registerMeSessionsRoutes(app);
  registerAdminSecurityRoutes(app);
  app.use("/api/i18n", i18nRouter); // UI translations
  app.use("/api/instruments", instrumentsRouter);
  app.use(profileMfaRouter); // 2FA MFA routes
  app.use("/api/verification", verificationRouter); // Email & SMS verification routes
  app.use("/api/legal", legalRouter); // Legal terms resolution routes
  app.use('/api/admin/legal-docs-v2', adminLegalDocsRouter); // DB-first admin legal docs (new)
  app.use('/api/admin/legal-acceptances', adminLegalAcceptancesRouter); // Legal acceptances management
  app.use("/api/admin/market-data", adminMarketDataRouter); // Market data providers + instrument ingestion
  app.use("/api/admin/quote-subscriptions", adminQuoteSubscriptionsRouter); // Admin quote subscription controls
  app.use('/api/admin/system-config', adminSystemConfigRouter); // System config (coverage gate toggle)
  app.use("/api/admin/activity", adminActivityRouter); // Inactive users + bot management

  app.use("/api/admin/i18n", adminI18nRouter); // Admin controls for i18n
  app.use("/api/quote-subscriptions", quoteSubscriptionsRouter); // Trader quote subscription controls
  app.use("/api/mailbox", mailboxRouter); // Internal mailbox + admin communications
  app.use("/api/notifications", notificationsRouter); // User notifications center
  app.use("/api/admin/scout", adminScoutRouter); // Recruitment scout endpoints
  app.use("/api/admin/challenges", adminChallengesRouter); // Challenge admin endpoints
  app.use("/api/admin/partners", adminPartnersRouter); // Partner admin management
  app.use("/api/partner", partnerAuthRouter); // Public partner auth (invite redemption)
  app.use("/api/partner", partnerPortalRouter); // Partner portal data room + allocations + inquiries
  app.use("/api/trader", traderTalentRouter); // Trader talent profile + challenges
  registerGriftRoutes(app);
  app.use("/api/grift", griftPublicRouter);
  app.use('/api/admin/migration', adminMigrationRouter); // Migration export/import (backup)
  app.use('/api/admin/legal-docs', adminLegalRouter); // Admin legal management routes (legacy)

  // Create HTTP server
  const httpServer = createServer(app);

  // --- Internal WebSocket server for live updates (quotes + trades) ---
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
  });

  app.get("/metrics", (_req, res) => {
    const quoteMeta = getQuoteMeta();
    const wsCount = wss.clients ? wss.clients.size : 0;
    const providerRateStats = getProviderRateLimitStats();
    const messagingMetrics = getMessagingMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(
      [
        "# HELP ws_active_connections Number of active websocket connections",
        "# TYPE ws_active_connections gauge",
        `ws_active_connections ${wsCount}`,
        "# HELP quotehub_size Number of quotes held in memory",
        "# TYPE quotehub_size gauge",
        `quotehub_size ${quoteMeta.size}`,
        "# HELP quotehub_seq Latest quote sequence number",
        "# TYPE quotehub_seq gauge",
        `quotehub_seq ${quoteMeta.seq}`,
        "# HELP quotehub_asof Latest quote snapshot timestamp (ms)",
        "# TYPE quotehub_asof gauge",
        `quotehub_asof ${quoteMeta.asOf}`,
        "# HELP marketdata_provider_ratelimit_queue_length Queued provider HTTP requests (rate limiter)",
        "# TYPE marketdata_provider_ratelimit_queue_length gauge",
        ...providerRateStats.map(
          (s) => `marketdata_provider_ratelimit_queue_length{provider_key="${s.providerKey}"} ${s.queueLength}`,
        ),
        "# HELP marketdata_provider_ratelimit_active In-flight provider HTTP requests (rate limiter)",
        "# TYPE marketdata_provider_ratelimit_active gauge",
        ...providerRateStats.map(
          (s) => `marketdata_provider_ratelimit_active{provider_key="${s.providerKey}"} ${s.active}`,
        ),
        "# HELP marketdata_provider_ratelimit_rejected_total Provider requests rejected due to full queue",
        "# TYPE marketdata_provider_ratelimit_rejected_total counter",
        ...providerRateStats.map(
          (s) => `marketdata_provider_ratelimit_rejected_total{provider_key="${s.providerKey}"} ${s.rejectedQueueFullTotal}`,
        ),
        "# HELP marketdata_provider_ratelimit_started_total Provider requests started (rate limiter)",
        "# TYPE marketdata_provider_ratelimit_started_total counter",
        ...providerRateStats.map(
          (s) => `marketdata_provider_ratelimit_started_total{provider_key="${s.providerKey}"} ${s.startedTotal}`,
        ),
        "# HELP trade_close_rejected_quote_stale_total Manual close requests rejected due to stale quotes",
        "# TYPE trade_close_rejected_quote_stale_total counter",
        `trade_close_rejected_quote_stale_total ${metricTradeCloseRejectedQuoteStaleTotal}`,
        "# HELP trade_targets_rejected_quote_stale_total Target update requests rejected due to stale quotes (market open)",
        "# TYPE trade_targets_rejected_quote_stale_total counter",
        `trade_targets_rejected_quote_stale_total ${metricTradeTargetsRejectedQuoteStaleTotal}`,
        "# HELP ws_quote_permission_refresh_total WebSocket clients whose quote permissions were recalculated",
        "# TYPE ws_quote_permission_refresh_total counter",
        `ws_quote_permission_refresh_total ${metricWsQuotePermissionRefreshTotal}`,
        "# HELP ws_quote_permission_refresh_errors_total WebSocket quote-permission refresh failures",
        "# TYPE ws_quote_permission_refresh_errors_total counter",
        `ws_quote_permission_refresh_errors_total ${metricWsQuotePermissionRefreshErrorsTotal}`,
        "# HELP mailbox_fanout_queue_depth Pending mailbox fanout jobs",
        "# TYPE mailbox_fanout_queue_depth gauge",
        `mailbox_fanout_queue_depth ${messagingMetrics.mailboxFanoutQueueDepth}`,
        "# HELP mailbox_fanout_running Whether mailbox fanout worker is currently running",
        "# TYPE mailbox_fanout_running gauge",
        `mailbox_fanout_running ${messagingMetrics.mailboxFanoutRunning}`,
        "# HELP mailbox_fanout_enqueued_total Total mailbox recipients enqueued for async fanout",
        "# TYPE mailbox_fanout_enqueued_total counter",
        `mailbox_fanout_enqueued_total ${messagingMetrics.mailboxFanoutEnqueuedTotal}`,
        "# HELP mailbox_fanout_processed_total Total mailbox recipients processed by async fanout",
        "# TYPE mailbox_fanout_processed_total counter",
        `mailbox_fanout_processed_total ${messagingMetrics.mailboxFanoutProcessedTotal}`,
        "# HELP mailbox_fanout_failed_total Total mailbox recipients that failed async fanout processing",
        "# TYPE mailbox_fanout_failed_total counter",
        `mailbox_fanout_failed_total ${messagingMetrics.mailboxFanoutFailedTotal}`,
        "",
      ].join("\n"),
    );
  });

  const WS_PROTOCOL_VERSION = 1;
  const wsTransportTlsRequired =
    process.env.NODE_ENV === "production" &&
    process.env.COOKIE_SECURE !== "false" &&
    !["0", "false", "off", "no"].includes(
      String(process.env.WS_TRANSPORT_REQUIRE_TLS ?? "1").trim().toLowerCase(),
    );

  // Helper type for WebSocket clients
  type LiveClient = WebSocket & {
    userId?: number;
    sessionId?: string;
    isAdmin?: boolean;
    isImpersonating?: boolean;
    ipCountryIso2?: string;
    userCountryIso2?: string;
    allowedQuoteSymbols?: Set<string>;
    quoteSymbols?: Set<string>;
    wantsQuotesAll?: boolean;
    quoteKey?: string;
    wantsTrades?: boolean;
    wantsAccount?: boolean;
  };

  function computeQuoteKey(symbols: Set<string> | undefined): string {
    if (!symbols || symbols.size === 0) return "";
    return Array.from(symbols)
      .map((s) => String(s).toUpperCase())
      .filter(Boolean)
      .sort()
      .join(",");
  }

  function syncClientQuoteKey(client: LiveClient) {
    client.quoteKey = computeQuoteKey(client.quoteSymbols);
  }

  function normIso2(v: any): string | undefined {
    const s = String(v ?? "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(s) ? s : undefined;
  }

  function readWsHeaderIso2(req: any): string | undefined {
    return getTrustedProxyCountryIso2(req as Request);
  }

  function isWsRequestTransportSecure(req: any): boolean {
    if (Boolean(req?.socket?.encrypted)) return true;
    const protoHeaderRaw = req?.headers?.["x-forwarded-proto"];
    const protoHeader = Array.isArray(protoHeaderRaw) ? protoHeaderRaw[0] : String(protoHeaderRaw ?? "");
    const proto = protoHeader.split(",")[0]?.trim().toLowerCase();
    return proto === "https" || proto === "wss";
  }

  function getWsSessionIdFromCookies(req: any): string | undefined {
    const rawCookieHeader = req?.headers?.cookie;
    if (!rawCookieHeader) return undefined;

    try {
      const cookies = cookie.parse(String(rawCookieHeader));
      const cookieVal = cookies?.[SESSION_COOKIE_NAME];
      if (!cookieVal) return undefined;

      const decoded = decodeURIComponent(String(cookieVal));
      if (decoded.startsWith("s:")) {
        const unsigned = signature.unsign(decoded.slice(2), SESSION_SECRET);
        return unsigned === false ? undefined : String(unsigned);
      }
      return decoded;
    } catch {
      return undefined;
    }
  }

  async function getWsSession(req: any): Promise<{ sid: string; sess: any } | null> {
    const sid = getWsSessionIdFromCookies(req);
    if (!sid) return null;

    try {
      const sess = await new Promise<any | null>((resolve) => {
        if (typeof sessionStore.get !== "function") return resolve(null);
        sessionStore.get(sid, (err: any, sessionValue: any) => {
          if (err || !sessionValue) return resolve(null);
          resolve(sessionValue);
        });
      });

      if (!sess) return null;
      const resolved = typeof sess === "string" ? JSON.parse(sess) : sess;
      return { sid, sess: resolved };
    } catch {
      return null;
    }
  }

  async function destroyCookieSession(sid: string) {
    try {
      await new Promise<void>((resolve) => {
        if (typeof sessionStore.destroy !== "function") return resolve();
        sessionStore.destroy(sid, () => resolve());
      });
    } catch {
      // ignore
    }
  }

  function wsSendJson(socket: WebSocket, payload: any) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  async function wsCloseWithPolicy(socket: WebSocket, client: LiveClient, decision: any) {
    wsSendJson(socket, {
      type: "ws:error",
      code: decision?.code ?? "JURISDICTION_RESTRICTED",
      reasonCode: decision?.reasonCode ?? null,
      message: decision?.message ?? "Access restricted.",
      blockedBy: decision?.blockedBy ?? null,
    });

    // Best-effort revoke+destroy so the user is kicked immediately across HTTP + WS
    if (client.sessionId && client.userId) {
      try {
        await revokeSession({
          actorUserId: 0,
          targetUserId: Number(client.userId),
          sessionId: String(client.sessionId),
          reason: String(decision?.reasonCode ?? decision?.code ?? "JURISDICTION_RESTRICTED"),
        });
      } catch { }

      await destroyCookieSession(String(client.sessionId));
    }

    try {
      socket.close(4403, "JURISDICTION_BLOCKED");
    } catch {
      // ignore
    }
  }

  function wsCloseUnauthorized(socket: WebSocket, reason: string) {
    wsSendJson(socket, { type: "ws:error", code: "WS_UNAUTHORIZED", message: "Unauthorized", reason });
    try {
      socket.close(4401, "UNAUTHORIZED");
    } catch { }
  }

  function broadcast(event: any, filter?: (client: LiveClient) => boolean) {
    const payload = JSON.stringify(event);
    for (const client of wss.clients as Set<LiveClient>) {
      if (client.readyState === WebSocket.OPEN && (!filter || filter(client))) {
        client.send(payload);
      }
    }
  }

  function normalizeSymbolsInput(raw: any): string[] {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : String(raw).split(",");
    return list
      .map((s) => String(s).trim().toUpperCase())
      .filter(Boolean);
  }

  function maskUserId(userId?: number): string | null {
    if (!userId || !Number.isFinite(userId)) return null;
    const raw = String(userId);
    if (raw.length <= 2) return `**`;
    return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  }

  async function sendQuoteSnapshot(socket: WebSocket, symbols?: string[]) {
    if (Array.isArray(symbols) && symbols.length === 0) {
      wsSendJson(socket, {
        type: "quotes:snapshot",
        protocolVersion: WS_PROTOCOL_VERSION,
        seq: 0,
        asOf: Date.now(),
        rows: [],
      });
      return;
    }

    const snapshot = await buildQuoteSnapshotResponse(symbols);
    wsSendJson(socket, {
      type: "quotes:snapshot",
      protocolVersion: WS_PROTOCOL_VERSION,
      seq: snapshot.seq,
      asOf: snapshot.asOf,
      rows: snapshot.rows,
    });
  }

  function filterQuoteRowsForClient(rows: any[], client: LiveClient) {
    const symbols = client.quoteSymbols;
    if (!symbols || symbols.size === 0) return [];
    return rows.filter((row) => row?.symbol && symbols.has(String(row.symbol).toUpperCase()));
  }

  async function refreshClientAllowedQuoteSymbols(client: LiveClient) {
    const userId = typeof client.userId === "number" && Number.isFinite(client.userId) ? client.userId : null;
    const allowedSymbols = await getAllowedSymbolsForUser(userId);
    client.allowedQuoteSymbols = allowedSymbols;

    if (client.wantsQuotesAll) {
      client.quoteSymbols = new Set(allowedSymbols);
      syncClientQuoteKey(client);
      return;
    }

    const current = client.quoteSymbols ?? new Set<string>();
    const filtered = new Set<string>();
    for (const symbol of current) {
      if (allowedSymbols.has(symbol)) filtered.add(symbol);
    }
    client.quoteSymbols = filtered;
    syncClientQuoteKey(client);
  }

  async function refreshWsQuotePermissions(targetUserIds?: Set<number>) {
    const tasks: Array<Promise<void>> = [];

    for (const ws of wss.clients as Set<LiveClient>) {
      const client = ws as LiveClient;
      if (client.readyState !== WebSocket.OPEN) continue;

      const userId = typeof client.userId === "number" ? client.userId : null;
      if (targetUserIds) {
        if (!userId || !targetUserIds.has(userId)) continue;
      }

      tasks.push(
        (async () => {
          await refreshClientAllowedQuoteSymbols(client);
          const snapshotSymbols = Array.from(client.quoteSymbols ?? []);
          await sendQuoteSnapshot(client, snapshotSymbols);
        })(),
      );
    }

    if (tasks.length) {
      const settled = await Promise.allSettled(tasks);
      metricWsQuotePermissionRefreshTotal += tasks.length;
      metricWsQuotePermissionRefreshErrorsTotal += settled.filter((entry) => entry.status === "rejected").length;
    }
  }

  wss.on("connection", async (socket, req) => {
    const client = socket as LiveClient;
    const pendingMessages: any[] = [];
    let wsReady = false;

    if (wsTransportTlsRequired && !isWsRequestTransportSecure(req)) {
      wsSendJson(socket, {
        type: "ws:error",
        code: "TRANSPORT_TLS_REQUIRED",
        message: "Secure transport required",
      });
      try {
        socket.close(4401, "TLS_REQUIRED");
      } catch {
        // ignore close race
      }
      return;
    }

    const handleMessage = async (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== "object") return;
        const type = String((msg as any).type ?? "");

        if (type === "auth" && typeof (msg as any).userId === "number") {
          const requested = Number((msg as any).userId);

          // If we have a session-bound userId, require it to match.
          if (client.userId && requested === client.userId) {
            return;
          }

          // Otherwise, do not allow client-controlled user binding.
          return wsCloseUnauthorized(socket, "AUTH_MISMATCH");
        }

        if (type === "auth:hello") {
          const scopes = [
            "quotes",
            client.userId ? "trades" : null,
            client.userId ? "account" : null,
            client.isAdmin ? "admin" : null,
          ].filter(Boolean);
          return wsSendJson(socket, {
            type: "auth:ok",
            userIdMasked: maskUserId(client.userId),
            isAdmin: client.isAdmin,
            scopes,
            protocolVersion: WS_PROTOCOL_VERSION,
          });
        }

        if (type === "quotes:subscribe") {
          const symbols = normalizeSymbolsInput((msg as any).symbols);
          const allowedSymbols = client.allowedQuoteSymbols ?? new Set<string>();
          if (!symbols.length) {
            client.wantsQuotesAll = true;
            client.quoteSymbols = new Set(allowedSymbols);
          } else {
            client.wantsQuotesAll = false;
            for (const symbol of symbols) {
              if (allowedSymbols.has(symbol)) {
                client.quoteSymbols?.add(symbol);
              }
            }
          }
          syncClientQuoteKey(client);
          const snapshotSymbols = Array.from(client.quoteSymbols ?? []);
          await sendQuoteSnapshot(socket, snapshotSymbols);
          return;
        }

        if (type === "quotes:unsubscribe") {
          const symbols = normalizeSymbolsInput((msg as any).symbols);
          if (!symbols.length) {
            client.wantsQuotesAll = false;
            client.quoteSymbols?.clear();
            syncClientQuoteKey(client);
            return;
          }
          for (const symbol of symbols) {
            client.quoteSymbols?.delete(symbol);
          }
          if ((client.quoteSymbols?.size ?? 0) === 0) {
            client.wantsQuotesAll = false;
          }
          syncClientQuoteKey(client);
          return;
        }

        if (type === "trades:subscribe") {
          if (!client.userId) return wsCloseUnauthorized(socket, "AUTH_REQUIRED");
          client.wantsTrades = true;
          return;
        }

        if (type === "trades:unsubscribe") {
          client.wantsTrades = false;
          return;
        }

        if (type === "account:subscribe") {
          if (!client.userId) return wsCloseUnauthorized(socket, "AUTH_REQUIRED");
          client.wantsAccount = true;
          try {
            const { recalcAccount } = await import("./recalcAccount");
            const metrics = await recalcAccount(client.userId);
            if (metrics) {
              wsSendJson(socket, {
                type: "account:snapshot",
                protocolVersion: WS_PROTOCOL_VERSION,
                userId: client.userId,
                payload: {
                  summary: {
                    balance: metrics.balance,
                    equity: metrics.equity,
                    floatingPnl: metrics.floatingPnl,
                    usedMargin: metrics.usedMargin,
                    freeMargin: metrics.freeMargin,
                    marginLevel: metrics.marginLevel,
                    openPositions: metrics.openPositions,
                    pricingStale: metrics.pricingStale,
                    staleSymbols: metrics.staleSymbols,
                    asOf: metrics.asOf.toISOString(),
                  },
                },
              });
            }
          } catch (e) {
            console.warn("[WS] Failed to send account snapshot:", e);
          }
          return;
        }

        if (type === "account:unsubscribe") {
          client.wantsAccount = false;
          return;
        }

        if (type === "ping") {
          return wsSendJson(socket, { type: "pong" });
        }
      } catch (err) {
        console.error("Invalid WS message:", err);
      }
    };

    // Attach immediately so we don't drop messages sent right after the handshake.
    socket.on("message", (raw) => {
      if (!wsReady) {
        if (pendingMessages.length < 50) pendingMessages.push(raw);
        else wsCloseUnauthorized(socket, "WS_BACKPRESSURE");
        return;
      }
      void handleMessage(raw);
    });
    client.userId = undefined;
    client.sessionId = undefined;
    client.isAdmin = false;
    client.isImpersonating = false;
    client.ipCountryIso2 = undefined;
    client.userCountryIso2 = undefined;
    client.allowedQuoteSymbols = new Set();
    client.quoteSymbols = new Set();
    client.wantsQuotesAll = false;
    client.quoteKey = "";
    client.wantsTrades = false;
    client.wantsAccount = false;

    // Resolve IP country once at connect time (proxy headers preferred).
    try {
      const ip = getClientIp(req as any);
      const geo = buildGeoContext(ip, extractGeoHints(req as any));
      client.ipCountryIso2 = readWsHeaderIso2(req) ?? (geo?.countryCode ? normIso2(geo.countryCode) : undefined);
    } catch {
      client.ipCountryIso2 = readWsHeaderIso2(req);
    }

    // Bind WS auth to the cookie session (do not trust client-provided userId).
    try {
      const wsSess = await getWsSession(req);
      if (wsSess?.sid && wsSess?.sess) {
        const sess = wsSess.sess as any;
        const sessionUserId = Number(sess?.userId);
        if (Number.isFinite(sessionUserId) && sessionUserId > 0) {
          client.sessionId = String(wsSess.sid);
          client.isAdmin = Boolean(sess?.isAdmin);
          client.isImpersonating = Boolean(sess?.isImpersonating);

          const [userRow] = await db
            .select({ countryIso2: users.countryIso2, countryLegacy: users.country })
            .from(users)
            .where(eq(users.id, sessionUserId))
            .limit(1);

          if (!userRow) {
            await destroyCookieSession(String(client.sessionId));
            wsCloseUnauthorized(socket, "USER_NOT_FOUND");
            return;
          }

          const userCountryIso2 =
            normIso2(userRow?.countryIso2) ??
            (typeof userRow?.countryLegacy === "string" && userRow.countryLegacy.trim().length === 2
              ? normIso2(userRow.countryLegacy)
              : undefined);

          client.userCountryIso2 = userCountryIso2;

          // Enforce jurisdiction login policy for WS connections (admins cannot be locked out).
          if (!(client.isAdmin && !client.isImpersonating)) {
            const decision = evaluateLoginJurisdiction({
              ipCountryIso2: client.ipCountryIso2 ?? null,
              userCountryIso2: userCountryIso2 ?? null,
            });

            if (!decision.allowed) {
              await wsCloseWithPolicy(socket, client, decision);
              return;
            }
          }

          client.userId = sessionUserId;
        }
      }
    } catch (e) {
      console.warn("[WS] Failed to bind session to websocket:", e);
    }

    try {
      await refreshClientAllowedQuoteSymbols(client);
    } catch (e) {
      console.warn("[WS] Failed to resolve allowed quote symbols:", e);
      client.allowedQuoteSymbols = new Set();
      client.quoteSymbols = new Set();
      client.wantsQuotesAll = false;
      syncClientQuoteKey(client);
    }

    wsReady = true;
    if (pendingMessages.length) {
      const queued = pendingMessages.splice(0);
      for (const raw of queued) {
        if (socket.readyState !== WebSocket.OPEN) break;
        await handleMessage(raw);
      }
    }
  });

  // Periodically re-check the login jurisdiction policy for connected clients.
  // This ensures users are disconnected if an admin enables blocking after they are already connected.
  const wsPolicyRecheckMs = Number(process.env.WS_JURISDICTION_RECHECK_MS ?? 30_000);
  setInterval(() => {
    for (const ws of wss.clients as Set<LiveClient>) {
      const client = ws as LiveClient;
      if (client.readyState !== WebSocket.OPEN) continue;
      if (!client.userId || !client.sessionId) continue;
      if (client.isAdmin && !client.isImpersonating) continue;

      const decision = evaluateLoginJurisdiction({
        ipCountryIso2: client.ipCountryIso2 ?? null,
        userCountryIso2: client.userCountryIso2 ?? null,
      });

      if (!decision.allowed) {
        wsCloseWithPolicy(client as any, client, decision);
      }
    }
  }, wsPolicyRecheckMs);

  // Bridge internal live events to WebSocket clients (user-scoped when userId is present)
  onLiveEvent((event) => {
    const ev = event as any;
    if (ev?.type === "quote-subscriptions:updated") {
      const userIds = Array.isArray(ev?.payload?.userIds)
        ? new Set(
          (ev.payload.userIds as any[])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0),
        )
        : undefined;

      const targetUserIds = userIds && userIds.size > 0 ? userIds : undefined;
      const eventPayload = {
        type: "quote-subscriptions:updated",
        payload: ev?.payload ?? null,
      };

      void (async () => {
        await refreshWsQuotePermissions(targetUserIds);
        // Broadcast config-change signal to all connected clients so query caches
        // refresh even for sockets that have not yet bound a userId.
        broadcast(eventPayload);
      })();
      return;
    }

    if (ev?.type === "quotes:update" && Array.isArray(ev?.payload?.rows)) {
      const seq = Number(ev.payload?.seq ?? 0);
      const asOf = Number(ev.payload?.asOf ?? Date.now());
      applyQuoteUpdate(ev.payload.rows, { seq, asOf });

      // Pre-serialize per subscription key to avoid per-socket JSON.stringify work.
      const groups = new Map<string, LiveClient[]>();
      for (const ws of wss.clients as Set<LiveClient>) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const client = ws as LiveClient;
        const key = client.quoteKey ?? computeQuoteKey(client.quoteSymbols);
        if (!key) continue;
        const list = groups.get(key);
        if (list) list.push(client);
        else groups.set(key, [client]);
      }

      if (groups.size === 0) return;

      const rowsWithSymbols = ev.payload.rows
        .map((row: any) => {
          if (!row?.symbol) return null;
          return { row, symbol: String(row.symbol).toUpperCase() };
        })
        .filter(Boolean) as Array<{ row: any; symbol: string }>;

      for (const [key, clients] of groups.entries()) {
        let rowsForGroup: any[] = [];
        if (key === "*") {
          rowsForGroup = ev.payload.rows;
        } else {
          const symbols = clients[0]?.quoteSymbols;
          if (!symbols || symbols.size === 0) continue;
          for (const item of rowsWithSymbols) {
            if (symbols.has(item.symbol)) rowsForGroup.push(item.row);
          }
          if (rowsForGroup.length === 0) continue;
        }

        let serialized = "";
        try {
          serialized = JSON.stringify({
            type: "quotes:update",
            protocolVersion: WS_PROTOCOL_VERSION,
            seq,
            asOf,
            rows: rowsForGroup,
          });
        } catch {
          continue;
        }

        for (const client of clients) {
          if (client.readyState !== WebSocket.OPEN) continue;
          try {
            client.send(serialized);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    const userId = ev?.userId;
    if (ev?.type === "trades:updated" || ev?.type === "trades:update") {
      if (typeof userId === "number") {
        broadcast(ev, (client) => client.userId === userId && client.wantsTrades);
      } else {
        broadcast(ev, (client) => client.wantsTrades);
      }
      return;
    }

    if (ev?.type === "account:updated" || ev?.type === "account:update") {
      if (typeof userId === "number") {
        broadcast(ev, (client) => client.userId === userId && client.wantsAccount);
      } else {
        broadcast(ev, (client) => client.wantsAccount);
      }
      return;
    }

    if (typeof userId === "number") {
      broadcast(ev, (client) => client.userId === userId);
      return;
    }
    broadcast(ev);
  });

  // Quote ingestion/simulation is handled by the ingestor role (quoteFeed.ts).
  return httpServer;
}
