import { Router } from "express";
import crypto from "crypto";
import { getClientIp, getUserAgent } from "../security/sessionTrail";
import { appendIdentityAudit } from "../services/identityAudit";
import { resolveCaptchaRuntimeConfig, SLIDER_CAPTCHA_ISSUE_TTL_MS, SLIDER_MIN_SOLVE_MS } from "../security/captcha";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";

async function getCaptchaEnabled() {
  const row = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  });
  const captcha = resolveCaptchaRuntimeConfig({
    signupCaptchaEnforce: row?.signupCaptchaEnforce,
    captchaProvider: row?.captchaProvider,
  });
  return {
    enforceSignupCaptcha: captcha.enforceSignupCaptcha,
    provider: captcha.effectiveProvider,
  };
}

export const captchaSliderRouter = Router();

function logCaptchaEvent(
  type: "CAPTCHA_ISSUED" | "CAPTCHA_VERIFIED" | "CAPTCHA_FAILED" | "CAPTCHA_RESET",
  captchaId: string | null,
  message: string,
  req: any,
) {
  try {
    appendIdentityAudit({
      category: "SECURITY",
      type,
      title: message,
      description: captchaId ? `captchaId=${captchaId.slice(0, 8)}…` : message,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
    });
  } catch {
    // ignore audit errors
  }
}

captchaSliderRouter.post("/slider/start", async (req, res) => {
  const cfg = await getCaptchaEnabled();
  if (!cfg.enforceSignupCaptcha || cfg.provider !== "SLIDER") {
    return res.status(400).json({ ok: false, message: "SLIDER_NOT_ENABLED" });
  }

  const captchaId = crypto.randomBytes(16).toString("hex");
  const now = Date.now();

  (req.session as any).captchaSlider = {
    id: captchaId,
    issuedAtMs: now,
    verifiedAtMs: null,
    consumedAtMs: null,
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
  };

  logCaptchaEvent("CAPTCHA_ISSUED", captchaId, "Slider CAPTCHA issued", req);

  return res.json({ ok: true, captchaId, expiresInMs: SLIDER_CAPTCHA_ISSUE_TTL_MS });
});

captchaSliderRouter.post("/slider/complete", async (req, res) => {
  const cfg = await getCaptchaEnabled();
  if (!cfg.enforceSignupCaptcha || cfg.provider !== "SLIDER") {
    return res.status(400).json({ ok: false, message: "SLIDER_NOT_ENABLED" });
  }

  const captchaId = typeof (req.body as any)?.captchaId === "string" ? (req.body as any).captchaId : "";
  if (!captchaId || captchaId.length < 10) {
    logCaptchaEvent("CAPTCHA_FAILED", null, "Slider CAPTCHA missing id", req);
    return res.status(400).json({ ok: false, message: "CAPTCHA_REQUIRED" });
  }

  const slider: any = (req.session as any).captchaSlider;
  const now = Date.now();

  if (!slider?.id || slider.id !== captchaId) {
    logCaptchaEvent("CAPTCHA_FAILED", captchaId, "Slider CAPTCHA mismatch", req);
    return res.status(400).json({ ok: false, message: "CAPTCHA_MISMATCH" });
  }
  if (typeof slider.issuedAtMs !== "number" || now - slider.issuedAtMs > SLIDER_CAPTCHA_ISSUE_TTL_MS) {
    logCaptchaEvent("CAPTCHA_FAILED", captchaId, "Slider CAPTCHA expired", req);
    return res.status(400).json({ ok: false, message: "CAPTCHA_EXPIRED" });
  }

  if (now - slider.issuedAtMs < SLIDER_MIN_SOLVE_MS) {
    logCaptchaEvent("CAPTCHA_FAILED", captchaId, "Slider CAPTCHA solved too fast", req);
    return res.status(400).json({ ok: false, message: "CAPTCHA_TOO_FAST" });
  }

  slider.verifiedAtMs = now;
  slider.consumedAtMs = null;
  slider.ip = slider.ip || getClientIp(req);
  slider.userAgent = slider.userAgent || getUserAgent(req);
  (req.session as any).captchaSlider = slider;

  logCaptchaEvent("CAPTCHA_VERIFIED", captchaId, "Slider CAPTCHA verified", req);

  return res.json({ ok: true, verifiedAtMs: now });
});

captchaSliderRouter.post("/slider/reset", (req, res) => {
  (req.session as any).captchaSlider = null;
  logCaptchaEvent("CAPTCHA_RESET", null, "Slider CAPTCHA reset", req);
  return res.json({ ok: true });
});
