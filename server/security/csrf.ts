import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import {
  CSRF_HEADER_FALLBACK_NAME,
  CSRF_HEADER_NAME,
  CSRF_TOKEN_COOKIE_NAME,
  isCsrfSafeMethod,
} from "@shared/security/csrf";
import { incHttpResponses403CsrfTotal } from "../routes/metricsState";

const CSRF_SESSION_KEY = "csrfToken";
const CSRF_TOKEN_MIN_LEN = 32;
const CSRF_TOKEN_MAX_LEN = 256;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

type CsrfProtectionOptions = {
  sessionCookieName: string;
};

function normalizeToken(raw: unknown): string | null {
  const token = String(raw ?? "").trim();
  if (!token) return null;
  if (token.length < CSRF_TOKEN_MIN_LEN || token.length > CSRF_TOKEN_MAX_LEN) return null;
  if (!CSRF_TOKEN_PATTERN.test(token)) return null;
  return token;
}

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function parseCookieMap(req: Request): Record<string, string> | null {
  const rawHeader = req.headers.cookie;
  if (!rawHeader) return null;

  const result: Record<string, string> = {};
  const pairs = String(rawHeader).split(";");
  for (const pair of pairs) {
    const [rawKey, ...rawValueParts] = pair.trim().split("=");
    if (!rawKey) continue;
    const rawValue = rawValueParts.join("=");
    if (!rawValue) continue;
    try {
      result[rawKey] = decodeURIComponent(rawValue);
    } catch {
      result[rawKey] = rawValue;
    }
  }

  return result;
}

function parseCookieRawValue(req: Request, name: string): string | null {
  const parsed = parseCookieMap(req);
  const rawValue = parsed?.[name];
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseCookieValue(req: Request, name: string): string | null {
  return normalizeToken(parseCookieRawValue(req, name));
}

function hasSessionCookie(req: Request, sessionCookieName: string): boolean {
  return parseCookieRawValue(req, sessionCookieName) != null;
}

function resolveCookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

let warnedAboutInvalidSameSiteNone = false;

function resolveCookieSameSite(): "lax" | "strict" {
  const configured = String(process.env.COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (configured === "strict") return "strict";
  if (configured === "none") {
    if (!warnedAboutInvalidSameSiteNone) {
      warnedAboutInvalidSameSiteNone = true;
      console.error(
        "[Security] COOKIE_SAMESITE=none is not permitted for CSRF double-submit cookies. Falling back to SameSite=lax.",
      );
    }
    return "lax";
  }
  return "lax";
}

function setCsrfCookie(res: Response, token: string) {
  res.cookie(CSRF_TOKEN_COOKIE_NAME, token, {
    secure: resolveCookieSecure(),
    httpOnly: false,
    sameSite: resolveCookieSameSite(),
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.setHeader("Vary", "Cookie");
}

function ensureSessionCsrfToken(req: Request): string {
  const sess = req.session as any;
  const existing = normalizeToken(sess?.[CSRF_SESSION_KEY]);
  if (existing) return existing;

  const cookieToken = parseCookieValue(req, CSRF_TOKEN_COOKIE_NAME);
  if (cookieToken) {
    sess[CSRF_SESSION_KEY] = cookieToken;
    return cookieToken;
  }

  const generated = generateCsrfToken();
  sess[CSRF_SESSION_KEY] = generated;
  return generated;
}

function readHeaderCsrfToken(req: Request): string | null {
  return (
    normalizeToken(req.get(CSRF_HEADER_NAME)) ??
    normalizeToken(req.get(CSRF_HEADER_FALLBACK_NAME)) ??
    normalizeToken(req.get("csrf-token"))
  );
}

function isSessionScopedRequest(req: Request, sessionCookieName: string): boolean {
  if (hasSessionCookie(req, sessionCookieName)) return true;
  if (Number.isInteger(Number((req.session as any)?.userId)) && Number((req.session as any)?.userId) > 0) return true;
  return false;
}

function csrfFailure(res: Response, reason: "MISSING" | "MISMATCH") {
  incHttpResponses403CsrfTotal();
  return res.status(403).json({
    message: "CSRF_TOKEN_INVALID",
    code: "CSRF_TOKEN_INVALID",
    reason,
    header: CSRF_HEADER_NAME,
  });
}

export function createCsrfProtection(options: CsrfProtectionOptions) {
  const { sessionCookieName } = options;

  function issueCsrfToken(req: Request, res: Response, next: NextFunction) {
    if (!isSessionScopedRequest(req, sessionCookieName) && req.path !== "/csrf") {
      return next();
    }
    const token = ensureSessionCsrfToken(req);
    setCsrfCookie(res, token);
    return next();
  }

  function enforceCsrf(req: Request, res: Response, next: NextFunction) {
    if (isCsrfSafeMethod(req.method)) return next();
    if (!isSessionScopedRequest(req, sessionCookieName)) return next();

    const sessionToken = ensureSessionCsrfToken(req);
    const cookieToken = parseCookieValue(req, CSRF_TOKEN_COOKIE_NAME);
    const headerToken = readHeaderCsrfToken(req);
    if (!cookieToken || !headerToken) return csrfFailure(res, "MISSING");
    if (cookieToken !== sessionToken || headerToken !== sessionToken) return csrfFailure(res, "MISMATCH");
    return next();
  }

  function csrfTokenHandler(req: Request, res: Response) {
    const token = ensureSessionCsrfToken(req);
    setCsrfCookie(res, token);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      csrfToken: token,
      header: CSRF_HEADER_NAME,
      cookie: CSRF_TOKEN_COOKIE_NAME,
    });
  }

  return {
    issueCsrfToken,
    enforceCsrf,
    csrfTokenHandler,
  };
}
