import type { Request } from "express";
import { normalizeIpKey } from "../grift/griftIpAsn";

function readHeader(req: Request, name: string): string | undefined {
  const value = req.headers?.[name as keyof typeof req.headers] ?? req.headers?.[name.toLowerCase() as keyof typeof req.headers];
  if (!value) return undefined;
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value);
}

function parseEnvBool(raw: string | undefined): boolean | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  const key = normalizeIpKey(ip) ?? ip;
  if (!key) return false;
  if (key === "::1") return true;
  if (key.startsWith("fe80:")) return true;
  if (key.startsWith("fc") || key.startsWith("fd")) return true;

  const m = key.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function hasKnownProxySignature(req: Request): boolean {
  const cloudflare = Boolean(readHeader(req, "cf-connecting-ip") && readHeader(req, "cf-ray"));
  const vercel = Boolean(readHeader(req, "x-vercel-id") && readHeader(req, "x-vercel-ip-country"));
  const appEngine = Boolean(
    readHeader(req, "x-appengine-country") &&
      (readHeader(req, "x-appengine-user-ip") || readHeader(req, "x-cloud-trace-context")),
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
    const value = readHeader(req, name);
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
