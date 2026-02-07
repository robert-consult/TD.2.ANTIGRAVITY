// server/grift/griftGeo.ts
import type { Request } from "express";
import geoip from "geoip-lite";
import { normalizeIpKey } from "./griftIpAsn";
import { getTrustedProxyCountryIso2, getTrustedProxyHeaderValue } from "../security/proxyHeaders";

function headerString(req: Request, key: string): string | null {
  const value = req.headers[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function cleanString(input: string | null, maxLen: number): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function cleanToken(input: string | null, maxLen: number): string | null {
  const s = cleanString(input, maxLen);
  if (!s) return null;
  // Avoid control chars and whitespace in token-like identifiers
  if (/[\s\x00-\x1F\x7F]/.test(s)) return null;
  return s;
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

export function kmh(distanceKm: number, deltaMs: number) {
  const hours = deltaMs / (1000 * 60 * 60);
  if (hours <= 0) return Infinity;
  return distanceKm / hours;
}

// Extract IP with proper precedence for various hosting providers
// CF-Connecting-IP -> X-Forwarded-For -> X-Real-IP -> socket
export function extractIp(req: Request): string | null {
  const normalize = (value: string | null) => (value ? normalizeIpKey(value) ?? value : null);

  const cfIp = headerString(req, "cf-connecting-ip");
  if (cfIp) return normalize(cfIp);

  const xff = headerString(req, "x-forwarded-for");
  if (xff) {
    const ips = xff.split(",");
    const firstIp = ips[0]?.trim();
    if (firstIp) return normalize(firstIp);
  }

  const xReal = headerString(req, "x-real-ip");
  if (xReal) return normalize(xReal);

  return normalize(req.ip || req.socket?.remoteAddress || null);
}

// Extract device ID from headers (case-insensitive)
export function extractDeviceInstallId(req: Request): string | null {
  const header = headerString(req, "x-device-install-id");
  const bodyValue = (req.body as any)?.deviceInstallId;
  const raw = typeof bodyValue === "string" ? bodyValue : header;
  return cleanToken(raw ?? null, 128);
}

export function extractDeviceFingerprint(req: Request): string | null {
  const headerFp = headerString(req, "x-device-fp") ?? headerString(req, "x-fingerprint");
  const bodyValue = (req.body as any)?.deviceFp;
  const raw = typeof bodyValue === "string" ? bodyValue : headerFp;
  return cleanToken(raw ?? null, 256);
}

export function extractLegacyDeviceId(req: Request): string | null {
  const headerId = headerString(req, "x-device-id");
  const bodyValue = (req.body as any)?.deviceId;
  const raw = typeof bodyValue === "string" ? bodyValue : headerId;
  return cleanToken(raw ?? null, 128);
}

// Extract ASN from headers (Cloudflare, Vercel, etc.)
export function extractAsn(req: Request): number | null {
  const asnHeader = getTrustedProxyHeaderValue(req, ["cf-asn", "x-vercel-ip-asn"]);
  if (asnHeader) {
    const asn = parseInt(asnHeader.trim(), 10);
    return isNaN(asn) ? null : asn;
  }
  return null;
}

// Extract org name from headers
export function extractOrg(req: Request): string | null {
  const org = getTrustedProxyHeaderValue(req, [
    "cf-org",
    "cf-organization",
    "cf-isp",
    "x-vercel-ip-org",
    "x-vercel-ip-as-org",
  ]);
  return cleanString(org ?? null, 256);
}

// Extract country from headers
export function extractCountry(req: Request): string | null {
  return getTrustedProxyCountryIso2(req) ?? null;
}

// Extract city from headers
export function extractCity(req: Request): string | null {
  const city = getTrustedProxyHeaderValue(req, ["cf-ipcity", "x-vercel-ip-city", "x-appengine-city"]);
  return cleanString(city ?? null, 128);
}

// Extract region from headers
export function extractRegion(req: Request): string | null {
  const region = getTrustedProxyHeaderValue(req, ["cf-region", "x-vercel-ip-country-region", "x-appengine-region"]);
  return cleanString(region ?? null, 128);
}

// Extract latitude from headers or body
export function extractLatitude(req: Request): number | null {
  const lat = getTrustedProxyHeaderValue(req, ["cf-iplat", "x-vercel-ip-latitude"]) ?? (req.body as any)?.latitude ?? (req.body as any)?.lat;
  if (lat != null) {
    const parsed = typeof lat === "number" ? lat : parseFloat(lat as string);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// Extract longitude from headers or body
export function extractLongitude(req: Request): number | null {
  const lon =
    getTrustedProxyHeaderValue(req, ["cf-iplon", "x-vercel-ip-longitude"]) ??
    (req.body as any)?.longitude ??
    (req.body as any)?.lon ??
    (req.body as any)?.lng;
  if (lon != null) {
    const parsed = typeof lon === "number" ? lon : parseFloat(lon as string);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// Full context extraction from request
export interface GriftRequestContext {
  ip: string | null;
  deviceId: string | null;
  deviceIdLegacy: string | null;
  deviceInstallId: string | null;
  deviceFp: string | null;
  clientTz: string | null;
  clientLang: string | null;
  userAgent: string | null;
  asn: number | null;
  org: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  geoRegion: string | null;
  latitude: number | null;
  longitude: number | null;
  sessionId: string | null;
}

export function extractGriftContext(req: Request): GriftRequestContext {
  const ip = extractIp(req);
  const headerCountry = extractCountry(req);
  const headerRegion = extractRegion(req);
  const headerCity = extractCity(req);
  const headerLat = extractLatitude(req);
  const headerLon = extractLongitude(req);

  const geo = ip ? geoip.lookup(ip) : null;
  const geoLat = Array.isArray(geo?.ll) ? Number(geo?.ll?.[0]) : null;
  const geoLon = Array.isArray(geo?.ll) ? Number(geo?.ll?.[1]) : null;

  const deviceInstallId = extractDeviceInstallId(req);
  const legacyDeviceId = extractLegacyDeviceId(req);
  // Prefer install ID as canonical device identifier; legacy ID is retained separately for linkage.
  const deviceId = deviceInstallId ?? legacyDeviceId;

  return {
    ip,
    deviceId,
    deviceIdLegacy: legacyDeviceId,
    deviceInstallId,
    deviceFp: extractDeviceFingerprint(req),
    clientTz: cleanString(headerString(req, "x-client-tz"), 64),
    clientLang: cleanString(headerString(req, "x-client-lang"), 32),
    userAgent: cleanString(headerString(req, "user-agent"), 512),
    asn: extractAsn(req),
    org: extractOrg(req),
    geoCountry: headerCountry ?? (geo?.country ?? null),
    geoCity: headerCity ?? (geo?.city ?? null),
    geoRegion: headerRegion ?? (geo?.region ?? null),
    latitude: headerLat ?? geoLat ?? null,
    longitude: headerLon ?? geoLon ?? null,
    sessionId: req.sessionID || null,
  };
}
