import * as cron from "node-cron";
import crypto from "crypto";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { emailVerificationTokens, userEquityDaily, userVerification, users } from "@shared/schema";
import { appendIdentityAudit } from "../services/identityAudit";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { decidePolicy } from "@shared/policyDecision";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { promotePerformerIfEligible } from "../policy/performerPromotion";
import { buildSystemContext } from "../lib/auditContext";

const REMINDER_SCHEDULE = "0 9 * * *"; // 9 AM daily
const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
const MS_DAY = 24 * 60 * 60 * 1000;

function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hmacToken(input: string): string {
  const secret = process.env.EMAIL_VERIFY_TOKEN_SECRET;
  if (!secret) return crypto.createHash("sha256").update(input).digest("hex");
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}

function getDayKey(): string {
  return new Date().toISOString().split("T")[0];
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

    console.log("Resend API success - Email sent:", { id: responseData.id, to: email });
    return true;
  } catch (error) {
    console.error("Error sending verification email:", error);
    return false;
  }
}

async function ensureUserVerificationRow(userId: number, nowSec: number) {
  await db
    .insert(userVerification)
    .values({
      userId,
      contenderTier: "NONE",
      createdAt: nowSec,
      updatedAt: nowSec,
    } as any)
    .onConflictDoNothing();
}

async function upsertDailyEquity(userId: number, equity: number, nowSec: number) {
  const dayKey = getDayKey();
  await db
    .insert(userEquityDaily)
    .values({
      userId,
      dayKey,
      equity: Number.isFinite(equity) ? equity : 0,
      createdAt: nowSec,
    })
    .onConflictDoUpdate({
      target: [userEquityDaily.userId, userEquityDaily.dayKey],
      set: { equity: Number.isFinite(equity) ? equity : 0, createdAt: nowSec },
    });
}

export function startVerificationReminderCron() {
  console.log("[Verification Reminders] Starting cron job");

  cron.schedule(REMINDER_SCHEDULE, async () => {
    console.log("[Verification Reminders] Running daily check at", new Date().toISOString());
    try {
      await sendVerificationReminders();
    } catch (err) {
      console.error("[Verification Reminders] Error:", err);
    }
  });
}

async function sendVerificationReminders() {
  const policyConfig = await loadPolicyConfig();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowDate = new Date(nowMs);

  const rows = await db.select({
    id: users.id,
    email: users.email,
    createdAt: users.createdAt,
    equity: users.equity,
    isAdmin: users.isAdmin,
  }).from(users);

  let remindersSent = 0;

  for (const user of rows) {
    if (user.isAdmin) continue;
    if (!user.email) continue;

    const systemCtx = buildSystemContext(`job-${nowDate.toISOString()}-${user.id}`);

    await ensureUserVerificationRow(user.id, nowSec);
    await upsertDailyEquity(user.id, Number(user.equity ?? 0), nowSec);

    const ctx = await buildDecisionContext({
      userId: user.id,
      nowMs,
      request: {
        correlationId: systemCtx.correlationId,
        actorType: "SYSTEM",
        actorUserId: null,
      },
      policyConfig,
    });

    await promotePerformerIfEligible({
      ctx,
      policyConfig,
      correlationId: systemCtx.correlationId,
      actorType: "SYSTEM",
      actorUserId: null,
    });

    const createdAtMs =
      ctx.user.createdAt instanceof Date
        ? ctx.user.createdAt.getTime()
        : Number(ctx.user.createdAt) < 1e12
          ? Number(ctx.user.createdAt) * 1000
          : Number(ctx.user.createdAt);
    const existingInitialDueAt = ctx.user.emailInitialDueAt;
    const normalizedInitialDueAt =
      existingInitialDueAt instanceof Date
        ? Math.floor(existingInitialDueAt.getTime() / 1000)
        : typeof existingInitialDueAt === "number"
          ? existingInitialDueAt < 1e12
            ? existingInitialDueAt
            : Math.floor(existingInitialDueAt / 1000)
          : null;
    const emailInitialDueAt =
      normalizedInitialDueAt ?? Math.floor((createdAtMs + policyConfig.emailInitialGraceDays * MS_DAY) / 1000);

    if (!ctx.user.emailInitialDueAt) {
      await db.update(userVerification)
        .set({ emailInitialDueAt, updatedAt: nowSec })
        .where(eq(userVerification.userId, user.id));
    }

    if (!ctx.user.emailVerifiedAt) {
      const daysSinceSignup = Math.floor((nowMs - createdAtMs) / MS_DAY);

      if (policyConfig.initialVerifyReminderDaysAfterSignup.includes(daysSinceSignup)) {
        const decision = decidePolicy("EMAIL_RESEND_VERIFICATION", ctx, policyConfig);
        if (!decision.allowed) {
          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: "ACCOUNT_ACTION_DENIED",
            title: "Email reminder blocked",
            description: `Deny code: ${decision.deny?.code ?? decision.deny_code}`,
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
            data: { action: "EMAIL_RESEND_VERIFICATION", deny: decision.deny ?? null },
          });
        } else {
          const token = generateSecureToken();
          const tokenHash = hmacToken(token);
          const tokenId = crypto.randomUUID();
          const expiresAt = nowSec + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600;

          await db.insert(emailVerificationTokens).values({
            id: tokenId,
            userId: user.id,
            tokenHash,
            purpose: "INITIAL",
            expiresAt,
          });

          const emailSent = await sendVerificationEmail(user.email, token, "INITIAL");
          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: emailSent ? "EMAIL_VERIFICATION_EMAIL_SENT" : "EMAIL_SEND_FAILED",
            title: emailSent ? "Verification reminder sent" : "Verification reminder failed",
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
            data: { kind: "INITIAL", expiresAt: new Date(expiresAt * 1000).toISOString() },
          });

          if (emailSent) {
            const dayKey = getDayKey();
            const verifyState = await db.query.userVerification.findFirst({
              where: eq(userVerification.userId, user.id),
            });
            const currentCount = verifyState?.emailResendDayKey === dayKey
              ? (verifyState?.emailResendCountDay || 0)
              : 0;
            const rawDayStart = verifyState?.emailResendDayStart;
            const parsedDayStart = rawDayStart != null ? Number(rawDayStart) : NaN;
            const newDayStart =
              verifyState?.emailResendDayKey === dayKey && Number.isFinite(parsedDayStart)
                ? parsedDayStart
                : nowSec;

            await db.update(userVerification)
              .set({
                emailLastResendAt: nowSec,
                emailResendCountDay: currentCount + 1,
                emailResendDayKey: dayKey,
                emailResendDayStart: (newDayStart ?? nowSec),
                emailInitialDueAt,
                updatedAt: nowSec,
              })
              .where(eq(userVerification.userId, user.id));

            appendIdentityAudit({
              userId: user.id,
              email: user.email,
              category: "VERIFICATION",
              type: "EMAIL_VERIFY_REMINDER_SENT",
              title: "Initial verify reminder sent",
              description: `Day ${daysSinceSignup} of ${policyConfig.emailInitialGraceDays} day grace period`,
              actorType: "SYSTEM",
              actorUserId: null,
              correlationId: systemCtx.correlationId,
            });

            remindersSent++;
          }
        }
      }

      if (nowSec >= emailInitialDueAt) {
        if (!ctx.user.lockedAt || ctx.user.lockReason !== "EMAIL_UNVERIFIED") {
          await db.update(userVerification)
            .set({
              lockedAt: nowSec,
              lockReason: "EMAIL_UNVERIFIED",
              updatedAt: nowSec,
            })
            .where(eq(userVerification.userId, user.id));

          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: "ACCOUNT_LOCKED_EMAIL_UNVERIFIED",
            title: "Account locked (email unverified)",
            description: `Initial due at ${new Date(emailInitialDueAt * 1000).toISOString()}`,
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
          });
        }
      }
      continue;
    }

    const existingReverifyDueAt = ctx.user.emailReverifyDueAt;
    let reverifyDueAt =
      existingReverifyDueAt instanceof Date
        ? Math.floor(existingReverifyDueAt.getTime() / 1000)
        : typeof existingReverifyDueAt === "number"
          ? existingReverifyDueAt < 1e12
            ? existingReverifyDueAt
            : Math.floor(existingReverifyDueAt / 1000)
          : null;
    if (!reverifyDueAt && ctx.user.emailVerifiedAt) {
      const verifiedAtMs =
        ctx.user.emailVerifiedAt instanceof Date
          ? ctx.user.emailVerifiedAt.getTime()
          : Number(ctx.user.emailVerifiedAt) < 1e12
            ? Number(ctx.user.emailVerifiedAt) * 1000
            : Number(ctx.user.emailVerifiedAt);
      reverifyDueAt = Math.floor((verifiedAtMs + policyConfig.emailReverifyPeriodDays * MS_DAY) / 1000);
      await db.update(userVerification)
        .set({ emailReverifyDueAt: reverifyDueAt, updatedAt: nowSec })
        .where(eq(userVerification.userId, user.id));
    }

    if (reverifyDueAt) {
      const daysToDue = Math.floor((reverifyDueAt * 1000 - nowMs) / MS_DAY);
      if (policyConfig.reverifyReminderOffsetsDays.includes(daysToDue)) {
        const decision = decidePolicy("EMAIL_RESEND_VERIFICATION", ctx, policyConfig);
        if (!decision.allowed) {
          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: "ACCOUNT_ACTION_DENIED",
            title: "Reverify reminder blocked",
            description: `Deny code: ${decision.deny?.code ?? decision.deny_code}`,
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
            data: { action: "EMAIL_RESEND_VERIFICATION", deny: decision.deny ?? null },
          });
        } else {
          const token = generateSecureToken();
          const tokenHash = hmacToken(token);
          const tokenId = crypto.randomUUID();
          const expiresAt = nowSec + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600;

          await db.insert(emailVerificationTokens).values({
            id: tokenId,
            userId: user.id,
            tokenHash,
            purpose: "REVERIFY",
            expiresAt,
          });

          const emailSent = await sendVerificationEmail(user.email, token, "REVERIFY");
          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: emailSent ? "EMAIL_VERIFICATION_EMAIL_SENT" : "EMAIL_SEND_FAILED",
            title: emailSent ? "Reverify reminder sent" : "Reverify reminder failed",
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
            data: { kind: "REVERIFY", expiresAt: new Date(expiresAt * 1000).toISOString() },
          });

          if (emailSent) {
            const dayKey = getDayKey();
            const verifyState = await db.query.userVerification.findFirst({
              where: eq(userVerification.userId, user.id),
            });
            const currentCount = verifyState?.emailResendDayKey === dayKey
              ? (verifyState?.emailResendCountDay || 0)
              : 0;
            const rawDayStart = verifyState?.emailResendDayStart;
            const parsedDayStart = rawDayStart != null ? Number(rawDayStart) : NaN;
            const newDayStart =
              verifyState?.emailResendDayKey === dayKey && Number.isFinite(parsedDayStart)
                ? parsedDayStart
                : nowSec;

            await db.update(userVerification)
              .set({
                emailLastResendAt: nowSec,
                emailResendCountDay: currentCount + 1,
                emailResendDayKey: dayKey,
                emailResendDayStart: (newDayStart ?? nowSec),
                updatedAt: nowSec,
              })
              .where(eq(userVerification.userId, user.id));

            appendIdentityAudit({
              userId: user.id,
              email: user.email,
              category: "VERIFICATION",
              type: "EMAIL_REVERIFY_REMINDER_SENT",
              title: "Reverify reminder sent",
              description: `Due at ${new Date(reverifyDueAt * 1000).toISOString()}, offset ${daysToDue} days`,
              actorType: "SYSTEM",
              actorUserId: null,
              correlationId: systemCtx.correlationId,
            });

            remindersSent++;
          }
        }
      }

      const overdueAt = reverifyDueAt + policyConfig.emailReverifyOverdueGraceDays * 86400;
      if (nowSec >= overdueAt) {
        if (!ctx.user.lockedAt || ctx.user.lockReason !== "EMAIL_REVERIFY_OVERDUE") {
          await db.update(userVerification)
            .set({
              lockedAt: nowSec,
              lockReason: "EMAIL_REVERIFY_OVERDUE",
              updatedAt: nowSec,
            })
            .where(eq(userVerification.userId, user.id));

          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: "ACCOUNT_LOCKED_REVERIFY_OVERDUE",
            title: "Account locked (reverify overdue)",
            description: `Reverify due at ${new Date(reverifyDueAt * 1000).toISOString()}`,
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
          });
        }
      }
    }
  }

  console.log(`[Verification Reminders] Completed. Sent ${remindersSent} reminders.`);
}
