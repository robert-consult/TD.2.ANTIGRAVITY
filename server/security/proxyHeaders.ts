import type { Request } from "express";
import {
  isPrivateOrLoopbackIp,
  normalizeIpKey,
  readRequestHeader,
} from "@shared/security/requestIdentity";

function parseEnvBool(raw: string | undefined): boolean | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function hasKnownProxySignature(req: Request): boolean {
  const cloudflare = Boolean(readRequestHeader(req as any, "cf-connecting-ip") && readRequestHeader(req as any, "cf-ray"));
  const vercel = Boolean(readRequestHeader(req as any, "x-vercel-id") && readRequestHeader(req as any, "x-vercel-ip-country"));
  const appEngine = Boolean(
    readRequestHeader(req as any, "x-appengine-country") &&
      (readRequestHeader(req as any, "x-appengine-user-ip") || readRequestHeader(req as any, "x-cloud-trace-context")),
  );
  return cloudflare || vercel || appEngine;
}

function getRemoteAddress(req: Request): string | undefined {
  const raw = req.socket?.remoteAddress ?? (req as any).connection?.remoteAddress;
  if (!raw) return undefined;
  return normalizeIpKey(String(raw)) ?? String(raw);
}

export function shouldTrustProxyGeoHeaders(req: Request): boolean {
  const override = parseEnvBool(process.env.TRUST_PROXY_GEO_HEADERS);
  if (override !== undefined) return override;

  const remote = getRemoteAddress(req);
  if (remote && isPrivateOrLoopbackIp(remote)) return true;

  if (hasKnownProxySignature(req)) return true;

  // Preserve local/dev behavior when requests are proxied through local tooling.
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

export function normalizeIso2(value: unknown): string | undefined {
  const raw = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : undefined;
}

export function getTrustedProxyHeaderValue(req: Request, names: string[]): string | undefined {
  if (!shouldTrustProxyGeoHeaders(req)) return undefined;
  for (const name of names) {
    const value = readRequestHeader(req as any, name);
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function getTrustedProxyCountryIso2(req: Request): string | undefined {
  const raw = getTrustedProxyHeaderValue(req, ["cf-ipcountry", "x-vercel-ip-country", "x-appengine-country"]);
  return normalizeIso2(raw);
}
