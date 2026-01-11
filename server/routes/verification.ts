import { Router, Request, Response } from "express";
import crypto from "crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { db } from "../../db";
import { and, desc, eq } from "drizzle-orm";
import { userVerification, emailVerificationTokens, smsOtpTokens, users } from "@shared/schema";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { decidePolicy, featureGates } from "../../shared/policyDecision";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { promotePerformerIfEligible } from "../policy/performerPromotion";
import { buildAuditContext } from "../lib/auditContext";

import { appendIdentityAudit } from "../services/identityAudit";

const router = Router();

const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hmacToken(input: string): string {
  const secret = process.env.EMAIL_VERIFY_TOKEN_SECRET;
  if (!secret) {
    console.warn("EMAIL_VERIFY_TOKEN_SECRET not set, falling back to SHA256");
    return crypto.createHash("sha256").update(input).digest("hex");
  }
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

const OTP_EXPIRY_MINUTES = 10;
const OTP_LENGTH = 6;

function generateOtpCode(): string {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function hashOtp(code: string): string {
  const secret = process.env.SMS_OTP_SECRET || process.env.TWILIO_AUTH_TOKEN;
  if (!secret) {
    return crypto.createHash("sha256").update(code).digest("hex");
  }
  return crypto.createHmac("sha256", secret).update(code).digest("hex");
}

async function sendSmsOtp(phoneE164: string, code: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    throw new Error("Twilio credentials not configured");
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: phoneE164,
    Body: `Your TradeQuip verification code is: ${code}`,
  });
  if (messagingServiceSid) {
    params.append("MessagingServiceSid", messagingServiceSid);
  } else if (fromNumber) {
    params.append("From", fromNumber);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Twilio send failed: ${errText}`);
  }
}

async function sendVerificationEmail(email: string, token: string, kind: "INITIAL" | "REVERIFY"): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not configured");
    return false;
  }

  const verifyUrl = `${process.env.APP_URL || "http://localhost:5000"}/verify-email?token=${token}`;
  const isReverify = kind === "REVERIFY";
  const subject = isReverify ? "Re-verify your TradeQuip email address" : "Verify your TradeQuip email address";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "TradeQuip <noreply@tradequip.com>",
        to: [email],
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">${isReverify ? "Re-verify Your Email" : "Verify Your Email"}</h2>
            <p>${isReverify ? "Click below to complete your monthly re-verification:" : "Click the button below to verify your email address:"}</p>
            <a href="${verifyUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
              ${isReverify ? "Re-verify Email" : "Verify Email"}
            </a>
            <p style="color: #666; font-size: 14px;">This link expires in ${VERIFICATION_TOKEN_EXPIRY_HOURS} hours.</p>
            <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      }),
    });

    const responseData = await response.json();
    
    if (!response.ok) {
      console.error("Resend API error:", responseData);
      return false;
    }

    console.log("Resend API success - Email sent:", { 
      id: responseData.id, 
      to: email 
    });
    return true;
  } catch (error) {
    console.error("Error sending verification email:", error);
    return false;
  }
}

function getDayKey(): string {
  return new Date().toISOString().split("T")[0];
}

// Per-IP rate limiting for email resend (in-memory store with TTL)
const ipEmailRateLimits: Map<string, { count: number; resetAt: number }> = new Map();
const IP_EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour window
const IP_EMAIL_RATE_LIMIT = 10; // 10 emails per hour per IP

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipEmailRateLimits.get(ip);
  
  if (!entry || entry.resetAt < now) {
    ipEmailRateLimits.set(ip, { count: 1, resetAt: now + IP_EMAIL_RATE_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= IP_EMAIL_RATE_LIMIT) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Cleanup old IP rate limit entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(ipEmailRateLimits.entries());
  for (const [ip, entry] of entries) {
    if (entry.resetAt < now) {
      ipEmailRateLimits.delete(ip);
    }
  }
}, 10 * 60 * 1000);

// Send or resend email verification
router.post("/email/send", async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  // Per-IP rate limiting check (before any database/context operations)
  const auditCtx = buildAuditContext(req);
  const ip = auditCtx.ip || "unknown";
  if (!checkIpRateLimit(ip)) {
    appendIdentityAudit({
      userId,
      category: "VERIFICATION",
      type: "ACCOUNT_ACTION_DENIED",
      title: "Email resend blocked by IP rate limit",
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent ?? undefined,
      actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      data: {
        action: "EMAIL_RESEND_VERIFICATION",
        deny: { code: "EMAIL_SEND_RATE_LIMIT" },
        ip,
      },
    });
    return res.status(429).json({
      message: "Too many email requests from this location. Please try again later.",
      deny_code: "EMAIL_SEND_RATE_LIMIT",
      correlationId: auditCtx.correlationId,
    });
  }

  try {
    const now = Date.now();
    const policyConfig = await loadPolicyConfig();
    const ctx = await buildDecisionContext({
      userId,
      nowMs: now,
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
    const decision = decidePolicy("EMAIL_RESEND_VERIFICATION", ctx, policyConfig);

    if (!decision.allowed) {
      appendIdentityAudit({
        userId,
        email: ctx.user.email,
        category: "VERIFICATION",
        type: "ACCOUNT_ACTION_DENIED",
        title: "Email resend blocked",
        description: `Deny code: ${decision.deny?.code ?? decision.deny_code}`,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent ?? undefined,
        actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        correlationId: auditCtx.correlationId,
        data: { action: "EMAIL_RESEND_VERIFICATION", deny: decision.deny ?? null, derived: decision.derived ?? null },
      });

      return res.status(decision.deny?.httpStatus ?? 429).json({
        message: decision.deny?.messageKey || "Email resend blocked.",
        deny_code: decision.deny?.code ?? decision.deny_code,
        deny: decision.deny ?? null,
        correlationId: auditCtx.correlationId,
      });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const token = generateSecureToken();
    const tokenHash = hmacToken(token);
    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(now + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600 * 1000);

    const kind: "INITIAL" | "REVERIFY" = ctx.user.emailVerifiedAt ? "REVERIFY" : "INITIAL";
    await db.insert(emailVerificationTokens).values({
      id: tokenId,
      userId,
      tokenHash,
      purpose: kind,
      expiresAt,
    });

    const emailSent = await sendVerificationEmail(user.email, token, kind);

    appendIdentityAudit({
      userId,
      email: user.email,
      category: "VERIFICATION",
      type: emailSent ? "EMAIL_VERIFICATION_EMAIL_SENT" : "EMAIL_SEND_FAILED",
      title: emailSent ? "Verification email sent" : "Email send failed",
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent ?? undefined,
      actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      data: { kind, expiresAt: expiresAt.toISOString() },
    });

    if (!emailSent) {
      return res.status(500).json({ message: "Failed to send verification email. Please try again." });
    }

    // Update throttle state after successful email send
    const verifyState = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId)
    });
    const dayKey = getDayKey();
    const currentCount = verifyState?.emailResendDayKey === dayKey ? (verifyState?.emailResendCountDay || 0) : 0;
    const newDayStart = verifyState?.emailResendDayKey === dayKey ? verifyState?.emailResendDayStart : new Date(now);
    const emailInitialDueAt = ctx.user.emailInitialDueAt ?? new Date(ctx.user.createdAt.getTime() + policyConfig.emailInitialGraceDays * 86400000);

    if (verifyState) {
      await db.update(userVerification)
        .set({
          emailLastResendAt: new Date(now),
          emailResendCountDay: currentCount + 1,
          emailResendDayKey: dayKey,
          emailResendDayStart: newDayStart || new Date(now),
          emailInitialDueAt,
          updatedAt: new Date(),
        })
        .where(eq(userVerification.userId, userId));
    } else {
      await db.insert(userVerification).values({
        userId,
        emailLastResendAt: new Date(now),
        emailResendCountDay: 1,
        emailResendDayKey: dayKey,
        emailResendDayStart: new Date(now),
        emailInitialDueAt,
        contenderTier: "NONE",
      });
    }

    res.json({ message: "Verification email sent successfully.", correlationId: auditCtx.correlationId, kind });
  } catch (error) {
    console.error("Error sending verification email:", error);
    res.status(500).json({ message: "Failed to send verification email." });
  }
});

// Verify email with token
router.post("/email/verify", async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ message: "Invalid token" });
  }

  try {
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const tokenHash = hmacToken(token);
    const tokenRecord = await db.query.emailVerificationTokens.findFirst({
      where: eq(emailVerificationTokens.tokenHash, tokenHash),
    });

    if (!tokenRecord) {
      return res.status(404).json({ message: "Invalid or expired token" });
    }

    if (tokenRecord.usedAt) {
      return res.status(410).json({ message: "Token has already been used." });
    }

    if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) < new Date()) {
      return res.status(410).json({ message: "Token has expired. Please request a new verification email." });
    }

    const now = new Date();
    const reverifyDueAt = new Date(now.getTime() + policyConfig.emailReverifyPeriodDays * 24 * 3600 * 1000);
    const kind = tokenRecord.purpose === "REVERIFY" ? "REVERIFY" : "INITIAL";

    await db.update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(eq(emailVerificationTokens.id, tokenRecord.id));

    const user = await db.query.users.findFirst({
      where: eq(users.id, tokenRecord.userId),
    });
    const createdAtMs = user?.createdAt ? new Date(user.createdAt as any).getTime() : now.getTime();
    const emailInitialDueAt = new Date(createdAtMs + policyConfig.emailInitialGraceDays * 86400000);

    let verification = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, tokenRecord.userId),
    });

    if (verification) {
      await db.update(userVerification)
        .set({
          emailVerifiedAt: now,
          emailReverifyDueAt: reverifyDueAt,
          emailResendCountDay: 0,
          emailInitialDueAt: verification.emailInitialDueAt ?? emailInitialDueAt,
          contenderTier: verification.contenderTier === "NONE" ? "CANDIDATE_EMAIL_ONLY" : verification.contenderTier,
          lockedAt: null,
          lockReason: null,
          updatedAt: now,
        })
        .where(eq(userVerification.userId, tokenRecord.userId));
    } else {
      await db.insert(userVerification).values({
        userId: tokenRecord.userId,
        emailVerifiedAt: now,
        emailReverifyDueAt: reverifyDueAt,
        emailInitialDueAt,
        contenderTier: "CANDIDATE_EMAIL_ONLY",
      });
    }

    appendIdentityAudit({
      userId: tokenRecord.userId,
      email: user?.email,
      category: "VERIFICATION",
      type: kind === "REVERIFY" ? "EMAIL_REVERIFIED" : "EMAIL_VERIFIED",
      title: kind === "REVERIFY" ? "Email re-verified successfully" : "Email verified successfully",
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent ?? undefined,
      actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      data: { kind },
    });

    res.json({ message: "Email verified successfully!", correlationId: auditCtx.correlationId });
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).json({ message: "Failed to verify email." });
  }
});

// Check verification status
router.get("/status", async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
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
    const gates = featureGates(ctx, policyConfig);

    res.json({
      accountState: gates.accountState,
      emailVerified: !!ctx.user.emailVerifiedAt,
      emailVerifiedAt: ctx.user.emailVerifiedAt?.toISOString() || null,
      emailReverifyDueAt: ctx.user.emailReverifyDueAt?.toISOString() || null,
      gracePeriodEndsAt: ctx.user.emailInitialDueAt?.toISOString() || null,
      phoneVerified: !!ctx.user.phoneVerifiedAt,
      phoneVerifiedAt: ctx.user.phoneVerifiedAt?.toISOString() || null,
      canStartSms: gates.canStartSms,
      contenderEligible: gates.contenderEligible,
      userTier: ctx.user.userTier,
      contenderTier: ctx.user.contenderTier,
      canTradeOpenOrIncrease: gates.canTradeOpenOrIncrease,
      canViewKyc: gates.canViewKyc,
      canSetPreferredPaymentCurrency: gates.canSetPreferredPaymentCurrency,
      canRequestPayout: gates.canRequestPayout,
      correlationId: auditCtx.correlationId,
    });
  } catch (error) {
    console.error("Error getting verification status:", error);
    res.status(500).json({ message: "Failed to get verification status." });
  }
});

// SMS verification - start
router.post("/sms/start", async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const { phone } = req.body;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ message: "Phone number is required" });
  }

  const parsedPhone = parsePhoneNumberFromString(phone);
  if (!parsedPhone || !parsedPhone.isValid()) {
    return res.status(400).json({
      message: "Invalid phone number format. Please enter a valid international phone number (e.g., +1234567890).",
      deny_code: "INVALID_PHONE_FORMAT",
    });
  }

  const phoneE164 = parsedPhone.format("E.164");

  try {
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const nowMs = Date.now();
    const ctx = await buildDecisionContext({
      userId,
      nowMs,
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
    const decision = decidePolicy("PHONE_VERIFY_START", ctx, policyConfig);

    if (!decision.allowed) {
      appendIdentityAudit({
        userId,
        email: ctx.user.email,
        category: "VERIFICATION",
        type: "ACCOUNT_ACTION_DENIED",
        title: "SMS verification start blocked",
        description: `Deny code: ${decision.deny?.code ?? decision.deny_code}`,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent ?? undefined,
        actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        correlationId: auditCtx.correlationId,
        data: { action: "PHONE_VERIFY_START", deny: decision.deny ?? null, derived: decision.derived ?? null },
      });

      return res.status(decision.deny?.httpStatus ?? 403).json({
        message: decision.deny?.messageKey || "Phone verification is not available.",
        deny_code: decision.deny?.code ?? decision.deny_code,
        deny: decision.deny ?? null,
        redirectTo: decision.redirectTo,
        correlationId: auditCtx.correlationId,
      });
    }

    await promotePerformerIfEligible({
      ctx,
      policyConfig,
      correlationId: auditCtx.correlationId,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent,
    });

    const code = generateOtpCode();
    const otpHash = hashOtp(code);
    const expiresAt = new Date(nowMs + OTP_EXPIRY_MINUTES * 60 * 1000);

    await db.insert(smsOtpTokens).values({
      userId,
      phoneE164,
      otpHash,
      expiresAt,
    });

    try {
      await sendSmsOtp(phoneE164, code);
    } catch (sendErr) {
      await db.update(smsOtpTokens)
        .set({ consumedAt: new Date() })
        .where(and(eq(smsOtpTokens.userId, userId), eq(smsOtpTokens.phoneE164, phoneE164), eq(smsOtpTokens.otpHash, otpHash)));
      throw sendErr;
    }

    const verifyState = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId)
    });
    const dayKey = getDayKey();
    const currentCount = verifyState?.smsSendDayKey === dayKey ? (verifyState?.smsSendCountDay || 0) : 0;
    const newDayStart = verifyState?.smsSendDayKey === dayKey ? verifyState?.smsSendDayStart : new Date(nowMs);
    const nowDate = new Date(nowMs);

    if (verifyState) {
      await db.update(userVerification)
        .set({
          phoneE164,
          smsSendDayKey: dayKey,
          smsSendCountDay: currentCount + 1,
          smsLastSentAt: nowDate,
          smsLastSendAt: nowDate,
          smsSendDayStart: newDayStart || nowDate,
          smsVerifyFailCount: 0,
          updatedAt: nowDate,
        })
        .where(eq(userVerification.userId, userId));
    } else {
      await db.insert(userVerification).values({
        userId,
        phoneE164,
        smsSendDayKey: dayKey,
        smsSendCountDay: 1,
        smsLastSentAt: nowDate,
        smsLastSendAt: nowDate,
        smsSendDayStart: nowDate,
        contenderTier: "CANDIDATE_SMS_REQUIRED",
        contenderEligibleAt: nowDate,
      });
    }

    appendIdentityAudit({
      userId,
      email: ctx.user.email,
      category: "VERIFICATION",
      type: "SMS_OTP_SENT",
      title: "SMS verification code sent",
      description: `Phone: ${phoneE164.slice(0, 4)}***${phoneE164.slice(-4)}`,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent ?? undefined,
      actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      data: { expiresAt: expiresAt.toISOString() },
    });

    res.json({ message: "Verification code sent.", correlationId: auditCtx.correlationId, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error("Error starting SMS verification:", error);
    res.status(500).json({ message: "Failed to start phone verification." });
  }
});

// SMS verification - confirm
router.post("/sms/confirm", async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  const { code } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ message: "Verification code is required" });
  }

  try {
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const now = new Date();
    const nowMs = now.getTime();

    const verification = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId),
    });

    if (!verification?.phoneE164) {
      return res.status(400).json({ message: "No phone verification in progress" });
    }
    const ctx = await buildDecisionContext({
      userId,
      nowMs,
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
    const decision = decidePolicy("PHONE_VERIFY_CONFIRM", ctx, policyConfig);

    if (!decision.allowed) {
      appendIdentityAudit({
        userId,
        email: ctx.user.email,
        category: "VERIFICATION",
        type: "ACCOUNT_ACTION_DENIED",
        title: "SMS verification confirm blocked",
        description: `Deny code: ${decision.deny?.code ?? decision.deny_code}`,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent ?? undefined,
        actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        correlationId: auditCtx.correlationId,
        data: { action: "PHONE_VERIFY_CONFIRM", deny: decision.deny ?? null, derived: decision.derived ?? null },
      });

      return res.status(decision.deny?.httpStatus ?? 429).json({
        message: decision.deny?.messageKey || "Too many failed attempts. Please wait before trying again.",
        deny_code: decision.deny?.code ?? decision.deny_code,
        deny: decision.deny ?? null,
        correlationId: auditCtx.correlationId,
      });
    }

    const otpRows = await db
      .select()
      .from(smsOtpTokens)
      .where(and(eq(smsOtpTokens.userId, userId), eq(smsOtpTokens.phoneE164, verification.phoneE164)))
      .orderBy(desc(smsOtpTokens.createdAt))
      .limit(1);
    const otpRow = otpRows[0];

    const handleOtpFailure = async (reason: string) => {
      const newFailCount = (verification.smsVerifyFailCount || 0) + 1;
      let lockedUntil: Date | null = null;
      if (newFailCount >= policyConfig.otpMaxAttempts) {
        lockedUntil = new Date(nowMs + policyConfig.otpLockMinutes * 60 * 1000);
      }

      await db.update(userVerification)
        .set({
          smsVerifyFailCount: newFailCount,
          smsOtpLockedUntil: lockedUntil,
          updatedAt: now,
        })
        .where(eq(userVerification.userId, userId));

      if (lockedUntil) {
        appendIdentityAudit({
          userId,
          email: ctx.user.email,
          category: "VERIFICATION",
          type: "SMS_OTP_LOCKOUT_TRIGGERED",
          title: "SMS OTP lockout triggered",
          description: `Failed ${newFailCount} times, locked until ${lockedUntil.toISOString()}`,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent ?? undefined,
          actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
          actorType: auditCtx.actorType,
          actorUserId: auditCtx.actorUserId,
          sessionId: auditCtx.sessionId,
          correlationId: auditCtx.correlationId,
        });
      }

      appendIdentityAudit({
        userId,
        email: ctx.user.email,
        category: "VERIFICATION",
        type: "SMS_VERIFY_FAILED",
        title: "SMS verification failed",
        description: `Reason=${reason} Fail count: ${newFailCount}/${policyConfig.otpMaxAttempts}`,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent ?? undefined,
        actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        correlationId: auditCtx.correlationId,
      });

      if (lockedUntil) {
        return res.status(429).json({
          message: "Too many failed attempts. Please wait before trying again.",
          deny_code: "SMS_OTP_TOO_MANY_ATTEMPTS",
          lockedUntil: lockedUntil.toISOString(),
          correlationId: auditCtx.correlationId,
        });
      }

      return res.status(400).json({ message: "Invalid verification code.", correlationId: auditCtx.correlationId });
    };

    if (!otpRow) {
      return handleOtpFailure("otp.missing");
    }
    if (otpRow.consumedAt) {
      return handleOtpFailure("otp.consumed");
    }
    if (otpRow.expiresAt && new Date(otpRow.expiresAt) < now) {
      return handleOtpFailure("otp.expired");
    }
    if (hashOtp(code) !== otpRow.otpHash) {
      return handleOtpFailure("otp.invalid");
    }

    // Success - reset fail count and lockout
    await db.update(smsOtpTokens)
      .set({ consumedAt: now })
      .where(eq(smsOtpTokens.id, otpRow.id));

    const currentTier = String(verification.contenderTier || "NONE");
    const nextTier = currentTier === "SELECTED_REAL_CAPITAL" ? "SELECTED_REAL_CAPITAL" : "VERIFIED_SMS";

    await db.update(userVerification)
      .set({
        smsVerifiedAt: now,
        smsVerifyFailCount: 0,
        smsOtpLockedUntil: null,
        smsEnabled: true,
        contenderTier: nextTier,
        updatedAt: now,
      })
      .where(eq(userVerification.userId, userId));

    appendIdentityAudit({
      userId,
      email: ctx.user.email,
      category: "VERIFICATION",
      type: "SMS_VERIFIED",
      title: "Phone number verified successfully",
      description: `Phone: ${verification.phoneE164.slice(0, 4)}***${verification.phoneE164.slice(-4)}`,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent ?? undefined,
      actorAdminId: auditCtx.actorType === "ADMIN" ? auditCtx.actorUserId ?? null : null,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
    });

    res.json({ message: "Phone number verified successfully!", correlationId: auditCtx.correlationId });
  } catch (error) {
    console.error("Error confirming SMS verification:", error);
    res.status(500).json({ message: "Failed to verify phone number." });
  }
});

export const verificationRouter = router;
