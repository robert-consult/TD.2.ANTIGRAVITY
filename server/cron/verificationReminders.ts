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
  if (!secret) {
    console.warn("EMAIL_VERIFY_TOKEN_SECRET not set, falling back to SHA256");
    return crypto.createHash("sha256").update(input).digest("hex");
  }
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

async function ensureUserVerificationRow(userId: number, now: Date) {
  await db
    .insert(userVerification)
    .values({
      userId,
      contenderTier: "NONE",
      createdAt: now,
      updatedAt: now,
    } as any)
    .onConflictDoNothing();
}

async function upsertDailyEquity(userId: number, equity: number, now: Date) {
  const dayKey = getDayKey();
  await db
    .insert(userEquityDaily)
    .values({
      userId,
      dayKey,
      equity: Number.isFinite(equity) ? equity : 0,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [userEquityDaily.userId, userEquityDaily.dayKey],
      set: { equity: Number.isFinite(equity) ? equity : 0, createdAt: now },
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
  const now = new Date();
  const nowMs = now.getTime();

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

    const systemCtx = buildSystemContext(`job-${now.toISOString()}-${user.id}`);

    await ensureUserVerificationRow(user.id, now);
    await upsertDailyEquity(user.id, Number(user.equity ?? 0), now);

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

    const emailInitialDueAt =
      ctx.user.emailInitialDueAt ?? new Date(ctx.user.createdAt.getTime() + policyConfig.emailInitialGraceDays * MS_DAY);

    if (!ctx.user.emailInitialDueAt) {
      await db.update(userVerification)
        .set({ emailInitialDueAt, updatedAt: now })
        .where(eq(userVerification.userId, user.id));
    }

    if (!ctx.user.emailVerifiedAt) {
      const daysSinceSignup = Math.floor((nowMs - ctx.user.createdAt.getTime()) / MS_DAY);

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
          const expiresAt = new Date(nowMs + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600 * 1000);

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
            data: { kind: "INITIAL", expiresAt: expiresAt.toISOString() },
          });

          if (emailSent) {
            const dayKey = getDayKey();
            const verifyState = await db.query.userVerification.findFirst({
              where: eq(userVerification.userId, user.id),
            });
            const currentCount = verifyState?.emailResendDayKey === dayKey
              ? (verifyState?.emailResendCountDay || 0)
              : 0;
            const newDayStart = verifyState?.emailResendDayKey === dayKey
              ? verifyState?.emailResendDayStart
              : now;

            await db.update(userVerification)
              .set({
                emailLastResendAt: now,
                emailResendCountDay: currentCount + 1,
                emailResendDayKey: dayKey,
                emailResendDayStart: newDayStart || now,
                emailInitialDueAt,
                updatedAt: now,
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

      if (now >= emailInitialDueAt) {
        if (!ctx.user.lockedAt || ctx.user.lockReason !== "EMAIL_UNVERIFIED") {
          await db.update(userVerification)
            .set({
              lockedAt: now,
              lockReason: "EMAIL_UNVERIFIED",
              updatedAt: now,
            })
            .where(eq(userVerification.userId, user.id));

          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: "ACCOUNT_LOCKED_EMAIL_UNVERIFIED",
            title: "Account locked (email unverified)",
            description: `Initial due at ${emailInitialDueAt.toISOString()}`,
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId: systemCtx.correlationId,
          });
        }
      }
      continue;
    }

    let reverifyDueAt = ctx.user.emailReverifyDueAt ?? null;
    if (!reverifyDueAt && ctx.user.emailVerifiedAt) {
      reverifyDueAt = new Date(ctx.user.emailVerifiedAt.getTime() + policyConfig.emailReverifyPeriodDays * MS_DAY);
      await db.update(userVerification)
        .set({ emailReverifyDueAt: reverifyDueAt, updatedAt: now })
        .where(eq(userVerification.userId, user.id));
    }

    if (reverifyDueAt) {
      const daysToDue = Math.floor((reverifyDueAt.getTime() - nowMs) / MS_DAY);
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
          const expiresAt = new Date(nowMs + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600 * 1000);

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
            data: { kind: "REVERIFY", expiresAt: expiresAt.toISOString() },
          });

          if (emailSent) {
            const dayKey = getDayKey();
            const verifyState = await db.query.userVerification.findFirst({
              where: eq(userVerification.userId, user.id),
            });
            const currentCount = verifyState?.emailResendDayKey === dayKey
              ? (verifyState?.emailResendCountDay || 0)
              : 0;
            const newDayStart = verifyState?.emailResendDayKey === dayKey
              ? verifyState?.emailResendDayStart
              : now;

            await db.update(userVerification)
              .set({
                emailLastResendAt: now,
                emailResendCountDay: currentCount + 1,
                emailResendDayKey: dayKey,
                emailResendDayStart: newDayStart || now,
                updatedAt: now,
              })
              .where(eq(userVerification.userId, user.id));

            appendIdentityAudit({
              userId: user.id,
              email: user.email,
              category: "VERIFICATION",
              type: "EMAIL_REVERIFY_REMINDER_SENT",
              title: "Reverify reminder sent",
              description: `Due at ${reverifyDueAt.toISOString()}, offset ${daysToDue} days`,
              actorType: "SYSTEM",
              actorUserId: null,
              correlationId: systemCtx.correlationId,
            });

            remindersSent++;
          }
        }
      }

      const overdueAt = new Date(reverifyDueAt.getTime() + policyConfig.emailReverifyOverdueGraceDays * MS_DAY);
      if (now >= overdueAt) {
        if (!ctx.user.lockedAt || ctx.user.lockReason !== "EMAIL_REVERIFY_OVERDUE") {
          await db.update(userVerification)
            .set({
              lockedAt: now,
              lockReason: "EMAIL_REVERIFY_OVERDUE",
              updatedAt: now,
            })
            .where(eq(userVerification.userId, user.id));

          appendIdentityAudit({
            userId: user.id,
            email: user.email,
            category: "VERIFICATION",
            type: "ACCOUNT_LOCKED_REVERIFY_OVERDUE",
            title: "Account locked (reverify overdue)",
            description: `Reverify due at ${reverifyDueAt.toISOString()}`,
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
