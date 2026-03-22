import { eq } from "drizzle-orm";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { sha256 } from "../legal/cryptoUtils";
import { resolveCaptchaRuntimeConfig } from "../security/captcha";

export async function getSignupPublicConfig() {
  const [row] = await db
    .select({
      signupCaptchaEnforce: systemConfig.signupCaptchaEnforce,
      captchaProvider: systemConfig.captchaProvider,
      signupPhoneEnforce: systemConfig.signupPhoneEnforce,
      signupFreeze: systemConfig.signupFreeze,
      signupFreezeMessage: systemConfig.signupFreezeMessage,
      signupWaitlistEnabled: systemConfig.signupWaitlistEnabled,
      signupWaitlistPolicyVersion: systemConfig.signupWaitlistPolicyVersion,
      signupWaitlistPolicyContent: systemConfig.signupWaitlistPolicyContent,
    })
    .from(systemConfig)
    .where(eq(systemConfig.id, 1))
    .limit(1);
  const waitlistPolicyContent = String((row as any)?.signupWaitlistPolicyContent ?? "");
  const waitlistPolicyVersion = String((row as any)?.signupWaitlistPolicyVersion ?? "1");
  const waitlistPolicySha256 = sha256(waitlistPolicyContent);

  const captcha = resolveCaptchaRuntimeConfig({
    signupCaptchaEnforce: row?.signupCaptchaEnforce,
    captchaProvider: row?.captchaProvider,
  });

  return {
    captcha: {
      enforceSignupCaptcha: captcha.enforceSignupCaptcha,
      provider: captcha.effectiveProvider,
    },
    signupPhoneEnforce: Boolean(row?.signupPhoneEnforce ?? true),
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
}

export function normalizeSignupPhone(phone: string | undefined | null, countryIso2: string) {
  if (!phone) return { ok: true, e164: null };
  try {
    const parsed = parsePhoneNumberFromString(phone, countryIso2 as any);
    if (!parsed || !parsed.isValid()) return { ok: false, e164: null };
    return { ok: true, e164: parsed.number.toString() };
  } catch {
    return { ok: false, e164: null };
  }
}
