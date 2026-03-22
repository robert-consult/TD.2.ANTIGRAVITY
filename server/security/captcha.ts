import type { Request } from "express";
import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getClientIp } from "../lib/auditContext";
import { getValkey } from "../services/valkey";

// Slider CAPTCHA settings
const SLIDER_CAPTCHA_TTL_MS = 10 * 60 * 1000;
export const SLIDER_CAPTCHA_ISSUE_TTL_MS = SLIDER_CAPTCHA_TTL_MS; // maximum solve window after issuance
export const SLIDER_CAPTCHA_VERIFY_TTL_MS = SLIDER_CAPTCHA_TTL_MS; // maximum signup-submit window after verification
export const SLIDER_MIN_SOLVE_MS = 800; // discourage bot-complete instantly
const SLIDER_CONSUME_LOCK_MS = 10 * 1000;
const SLIDER_CONSUME_LOCK_PREFIX = "captcha:slider:consume:";
let sliderDistributedLockWarningLogged = false;

const sliderConsumeLocks = new Map<string, number>();
const sliderConsumeLockCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, lockUntilMs] of sliderConsumeLocks.entries()) {
    if (lockUntilMs <= now) {
      sliderConsumeLocks.delete(key);
    }
  }
}, 30 * 1000);
sliderConsumeLockCleanupTimer.unref?.();

function requiresDistributedSliderConsumeLock(): boolean {
  return process.env.NODE_ENV === "production" && String(process.env.SERVER_REUSE_PORT ?? "0").trim() === "1";
}

async function acquireSliderConsumeLock(key: string, nowMs: number): Promise<boolean> {
  const valkey = getValkey();
  if (valkey) {
    try {
      const result = await valkey.set(
        `${SLIDER_CONSUME_LOCK_PREFIX}${key}`,
        String(nowMs),
        "PX",
        SLIDER_CONSUME_LOCK_MS,
        "NX",
      );
      return result === "OK";
    } catch {
      if (requiresDistributedSliderConsumeLock()) {
        if (!sliderDistributedLockWarningLogged) {
          sliderDistributedLockWarningLogged = true;
          console.error("[Captcha] Distributed consume lock unavailable in reusePort mode; rejecting slider consumes.");
        }
        return false;
      }
      // fall back to in-process lock when valkey is unavailable
    }
  }

  if (requiresDistributedSliderConsumeLock()) {
    if (!sliderDistributedLockWarningLogged) {
      sliderDistributedLockWarningLogged = true;
      console.error("[Captcha] VALKEY_URL is required for slider consume lock in reusePort mode; rejecting slider consumes.");
    }
    return false;
  }

  const consumeLockedUntil = sliderConsumeLocks.get(key);
  if (typeof consumeLockedUntil === "number" && consumeLockedUntil > nowMs) {
    return false;
  }
  sliderConsumeLocks.set(key, nowMs + SLIDER_CONSUME_LOCK_MS);
  return true;
}

export type CaptchaProvider = "TURNSTILE" | "HCAPTCHA" | "SLIDER";

export type CaptchaRuntimeConfig = {
  enforceSignupCaptcha: boolean;
  selectedProvider: CaptchaProvider;
  effectiveProvider: CaptchaProvider;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  turnstileSecretConfigured: boolean;
  hcaptchaSecretConfigured: boolean;
  selectedProviderSecretConfigured: boolean;
};

function hasTurnstileSecret(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY || process.env.CAPTCHA_TURNSTILE_SECRET);
}

function hasHcaptchaSecret(): boolean {
  return Boolean(process.env.HCAPTCHA_SECRET_KEY || process.env.CAPTCHA_HCAPTCHA_SECRET);
}

function normalizeCaptchaProvider(raw: unknown): CaptchaProvider {
  const normalized = String(raw ?? "SLIDER").trim().toUpperCase();
  if (normalized === "TURNSTILE" || normalized === "HCAPTCHA" || normalized === "SLIDER") {
    return normalized;
  }
  return "SLIDER";
}

export function resolveCaptchaProvider(
  provider: CaptchaProvider
): { provider: CaptchaProvider; fallbackUsed: boolean } {
  if (provider === "TURNSTILE" && !hasTurnstileSecret()) return { provider: "SLIDER", fallbackUsed: true };
  if (provider === "HCAPTCHA" && !hasHcaptchaSecret()) return { provider: "SLIDER", fallbackUsed: true };
  return { provider, fallbackUsed: false };
}

export function resolveCaptchaRuntimeConfig(input: {
  signupCaptchaEnforce?: unknown;
  captchaProvider?: unknown;
}): CaptchaRuntimeConfig {
  const selectedProvider = normalizeCaptchaProvider(input.captchaProvider);
  const resolved = resolveCaptchaProvider(selectedProvider);
  const turnstileSecretConfigured = hasTurnstileSecret();
  const hcaptchaSecretConfigured = hasHcaptchaSecret();

  let selectedProviderSecretConfigured = true;
  let fallbackReason: string | null = null;
  if (selectedProvider === "TURNSTILE") {
    selectedProviderSecretConfigured = turnstileSecretConfigured;
    if (!turnstileSecretConfigured) {
      fallbackReason = "TURNSTILE secret is not configured; runtime falls back to SLIDER.";
    }
  } else if (selectedProvider === "HCAPTCHA") {
    selectedProviderSecretConfigured = hcaptchaSecretConfigured;
    if (!hcaptchaSecretConfigured) {
      fallbackReason = "HCAPTCHA secret is not configured; runtime falls back to SLIDER.";
    }
  }

  return {
    enforceSignupCaptcha: Boolean(input.signupCaptchaEnforce ?? true),
    selectedProvider,
    effectiveProvider: resolved.provider,
    fallbackUsed: resolved.fallbackUsed,
    fallbackReason,
    turnstileSecretConfigured,
    hcaptchaSecretConfigured,
    selectedProviderSecretConfigured,
  };
}

export async function getCaptchaRuntimeConfig(): Promise<CaptchaRuntimeConfig> {
  const cfg = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  });
  return resolveCaptchaRuntimeConfig({
    signupCaptchaEnforce: cfg?.signupCaptchaEnforce,
    captchaProvider: cfg?.captchaProvider,
  });
}

export async function verifySignupCaptcha(
  req: Request,
  captchaToken: string | undefined | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { enforceSignupCaptcha, effectiveProvider } = await getCaptchaRuntimeConfig();
  if (!enforceSignupCaptcha) return { ok: true };

  if (effectiveProvider === "SLIDER") {
    const sessionAny: any = (req as any).session;
    const slider = sessionAny?.captchaSlider;
    const now = Date.now();
    const sessionId = String((req as any).sessionID ?? "");

    if (!slider?.id || !slider?.issuedAtMs) {
      sessionAny.captchaSlider = null;
      return { ok: false, message: "CAPTCHA_REQUIRED" };
    }

    if (typeof slider.consumedAtMs === "number") {
      sessionAny.captchaSlider = null;
      return { ok: false, message: "CAPTCHA_ALREADY_USED" };
    }

    if (typeof slider.verifiedAtMs !== "number" || now - slider.verifiedAtMs > SLIDER_CAPTCHA_VERIFY_TTL_MS) {
      sessionAny.captchaSlider = null;
      return { ok: false, message: "CAPTCHA_EXPIRED" };
    }

    if (slider.verifiedAtMs < slider.issuedAtMs) {
      sessionAny.captchaSlider = null;
      return { ok: false, message: "CAPTCHA_EXPIRED" };
    }

    if (slider.verifiedAtMs - slider.issuedAtMs < SLIDER_MIN_SOLVE_MS) {
      sessionAny.captchaSlider = null;
      return { ok: false, message: "CAPTCHA_TOO_FAST" };
    }

    const consumeKey = `${sessionId || "anon"}:${String(slider.id)}`;
    const lockAcquired = await acquireSliderConsumeLock(consumeKey, now);
    if (!lockAcquired) {
      sessionAny.captchaSlider = null;
      return { ok: false, message: "CAPTCHA_ALREADY_USED" };
    }

    slider.consumedAtMs = now;
    sessionAny.captchaSlider = slider;
    return { ok: true };
  }

  if (!captchaToken || captchaToken.trim().length < 10) {
    return { ok: false, message: "CAPTCHA_REQUIRED" };
  }

  const ip = getClientIp(req) || undefined;

  try {
    if (effectiveProvider === "TURNSTILE") {
      const secret = process.env.TURNSTILE_SECRET_KEY || process.env.CAPTCHA_TURNSTILE_SECRET;
      if (!secret) return { ok: false, message: "CAPTCHA_SECRET_NOT_CONFIGURED" };

      const form = new URLSearchParams();
      form.set("secret", secret);
      form.set("response", captchaToken);
      if (ip) form.set("remoteip", ip);

      const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const data: any = await resp.json().catch(() => ({}));
      if (!data?.success) {
        const codes = Array.isArray(data?.["error-codes"]) ? data["error-codes"].join(",") : "unknown";
        return { ok: false, message: `CAPTCHA_FAILED:${codes}` };
      }
      return { ok: true };
    }

    if (effectiveProvider === "HCAPTCHA") {
      const secret = process.env.HCAPTCHA_SECRET_KEY || process.env.CAPTCHA_HCAPTCHA_SECRET;
      if (!secret) return { ok: false, message: "CAPTCHA_SECRET_NOT_CONFIGURED" };

      const form = new URLSearchParams();
      form.set("secret", secret);
      form.set("response", captchaToken);
      if (ip) form.set("remoteip", ip);

      const resp = await fetch("https://hcaptcha.com/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      const data: any = await resp.json().catch(() => ({}));
      if (!data?.success) {
        const codes = Array.isArray(data?.["error-codes"]) ? data["error-codes"].join(",") : "unknown";
        return { ok: false, message: `CAPTCHA_FAILED:${codes}` };
      }
      return { ok: true };
    }

    return { ok: false, message: "CAPTCHA_PROVIDER_UNSUPPORTED" };
  } catch (e: any) {
    return { ok: false, message: `CAPTCHA_VERIFY_ERROR:${e?.message ?? "unknown"}` };
  }
}
