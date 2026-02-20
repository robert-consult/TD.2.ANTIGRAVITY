import type { Request, Response, Router } from "express";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@db";
import { signupWaitlist, systemConfig } from "@shared/schema";
import { hmacSign, sha256, stableStringify } from "../../legal/cryptoUtils";
import { verifySignupCaptcha } from "../../security/captcha";
import {
  buildGeoContext,
  extractGeoHints,
  getClientIp,
  getUserAgent,
} from "../../security/sessionTrail";
import { getTrustedProxyCountryIso2 } from "../../security/proxyHeaders";
import { evaluateSignupJurisdiction } from "../../policy/jurisdictionControl";
import { appendIdentityAudit } from "../../services/identityAudit";

export function registerWaitlistRoute(router: Router) {
  // Public invite waitlist join (when signups are frozen)
  router.post("/waitlist", async (req: Request, res: Response) => {
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

    const ipCountryIso2 =
      getTrustedProxyCountryIso2(req) ?? (geo.countryCode ? geo.countryCode.toUpperCase() : undefined);

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

    const prevHash = existing?.recordHash ? String(existing.recordHash) : prevRow?.recordHash ?? null;

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
      }),
    );

    if (existing?.id) {
      await db
        .update(signupWaitlist)
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
      await db.insert(signupWaitlist).values({
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
}
