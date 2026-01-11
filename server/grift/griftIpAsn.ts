import type Database from "better-sqlite3";
import { lookupIp2Asn, maybeImportIp2AsnDataset } from "./griftIp2AsnDataset";

export type IpAsnOrg = {
  ip: string;
  asn: number | null;
  org: string | null;
  source: string | null;
  fetchedAt: number | null;
};

type IpAsnCacheRow = {
  ip: string;
  asn: number | null;
  org: string | null;
  source: string | null;
  fetched_at: number | null;
  next_retry_at: number | null;
  attempt_count: number | null;
};

function parseIntSafe(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function normalizeIpKey(input: string | null | undefined): string | null {
  if (!input) return null;
  let ip = String(input).trim();
  if (!ip) return null;
  if (ip.includes(",")) ip = ip.split(",")[0]!.trim();
  // Strip IPv4-mapped IPv6 prefix (common in Node/Express)
  if (ip.toLowerCase().startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
  // Strip bracketed IPv6 with port: [::1]:1234
  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket?.[1]) ip = bracket[1];
  // Strip IPv4 port: 1.2.3.4:1234
  const ipv4Port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4Port?.[1]) ip = ipv4Port[1];
  return ip.trim().toLowerCase() || null;
}

function isPrivateIp(ip: string): boolean {
  const key = normalizeIpKey(ip);
  if (!key) return true;

  // IPv6 loopback/link-local/ULA
  if (key === "::1") return true;
  if (key.startsWith("fe80:")) return true;
  if (key.startsWith("fc") || key.startsWith("fd")) return true;

  // IPv4 private ranges
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

function backoffMs(attemptCount: number) {
  const base = 5 * 60 * 1000; // 5 minutes
  const max = 24 * 60 * 60 * 1000; // 24 hours
  const pow = Math.min(6, Math.max(0, attemptCount)); // cap growth
  return Math.min(max, base * Math.pow(2, pow));
}

export function touchIpAsnCache(db: Database.Database, ipRaw: string, nowMs: number = Date.now()) {
  const ip = normalizeIpKey(ipRaw);
  if (!ip) return;
  db.prepare(
    `
    INSERT INTO grift_ip_asn_cache (ip, last_seen_at)
    VALUES (?, ?)
    ON CONFLICT(ip) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `
  ).run(ip, nowMs);
}

export function noteIpAsnFromHeaders(
  db: Database.Database,
  input: { ip: string; asn?: number | null; org?: string | null },
  nowMs: number = Date.now()
) {
  const ip = normalizeIpKey(input.ip);
  if (!ip) return;
  const asn = typeof input.asn === "number" ? input.asn : null;
  const org = typeof input.org === "string" ? input.org : null;
  if (asn == null && !org) {
    touchIpAsnCache(db, ip, nowMs);
    return;
  }

  db.prepare(
    `
    INSERT INTO grift_ip_asn_cache (ip, asn, org, source, fetched_at, last_seen_at)
    VALUES (?, ?, ?, 'proxy_header', ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      asn = COALESCE(excluded.asn, asn),
      org = COALESCE(excluded.org, org),
      source = 'proxy_header',
      fetched_at = COALESCE(excluded.fetched_at, fetched_at),
      last_seen_at = excluded.last_seen_at,
      error = NULL,
      error_at = NULL,
      next_retry_at = NULL
  `
  ).run(ip, asn, org, nowMs, nowMs);
}

export function getCachedIpAsnOrg(
  db: Database.Database,
  ipRaw: string,
  opts?: { nowMs?: number; ttlMs?: number }
): IpAsnOrg | null {
  const ip = normalizeIpKey(ipRaw);
  if (!ip) return null;
  const nowMs = opts?.nowMs ?? Date.now();
  const ttlMs = opts?.ttlMs ?? 7 * 24 * 60 * 60 * 1000;

  const row = db
    .prepare(
      `
      SELECT ip, asn, org, source, fetched_at, next_retry_at, attempt_count
      FROM grift_ip_asn_cache
      WHERE ip = ?
    `
    )
    .get(ip) as IpAsnCacheRow | undefined;

  if (!row) return null;
  if (!row.asn && !row.org) return null;
  if (row.fetched_at != null && row.fetched_at < nowMs - ttlMs) return null;

  return {
    ip: row.ip,
    asn: row.asn ?? null,
    org: row.org ?? null,
    source: row.source ?? null,
    fetchedAt: row.fetched_at ?? null,
  };
}

export function resolveAsnOrg(
  db: Database.Database,
  input: { ip?: string | null; asn?: number | null; org?: string | null },
  nowMs: number = Date.now()
): { ip: string | null; asn: number | null; org: string | null } {
  const ip = normalizeIpKey(input.ip ?? null);
  if (!ip) return { ip: null, asn: input.asn ?? null, org: input.org ?? null };

  // If a proxy/provider already gave ASN/org, treat it as authoritative and cache it.
  if (typeof input.asn === "number" || typeof input.org === "string") {
    noteIpAsnFromHeaders(db, { ip, asn: input.asn ?? null, org: input.org ?? null }, nowMs);
    return { ip, asn: input.asn ?? null, org: input.org ?? null };
  }

  // Touch so the scheduler can enrich later.
  touchIpAsnCache(db, ip, nowMs);

  const cached = getCachedIpAsnOrg(db, ip, { nowMs });
  if (cached) return { ip, asn: cached.asn ?? null, org: cached.org ?? null };

  // Fast offline lookup via ip2asn range table (if imported).
  const local = lookupIp2Asn(db, ip);
  if (local) {
    updateCacheSuccess(db, ip, { asn: local.asn, org: local.org, source: local.source, nowMs });
    backfillTables(db, ip, local.asn, local.org);
    return { ip, asn: local.asn, org: local.org };
  }

  return { ip, asn: null, org: null };
}

function parseProviderResponse(data: any): { asn: number | null; org: string | null } {
  if (!data || typeof data !== "object") return { asn: null, org: null };

  const asn =
    parseIntSafe(data.asn) ??
    parseIntSafe(data.as_number) ??
    parseIntSafe(data.asNumber) ??
    parseIntSafe(data.asn_number) ??
    parseIntSafe(data.as) ??
    null;

  const org =
    cleanString(data.org, 256) ??
    cleanString(data.organization, 256) ??
    cleanString(data.as_name, 256) ??
    cleanString(data.as_description, 256) ??
    cleanString(data.asDescription, 256) ??
    null;

  return { asn, org };
}

function providerUrlForIp(ip: string) {
  const template = process.env.GRIFT_IPTOASN_URL_TEMPLATE;
  if (!template) return null;
  return template.replace("{ip}", encodeURIComponent(ip));
}

async function fetchIpAsnOrg(ip: string): Promise<{ asn: number | null; org: string | null; raw?: any }> {
  const url = providerUrlForIp(ip);
  if (!url) return { asn: null, org: null };

  const timeoutMs = Math.max(500, Math.min(10_000, Number(process.env.GRIFT_IPTOASN_TIMEOUT_MS ?? 4000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = process.env.GRIFT_IPTOASN_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text || res.statusText}`);
    }

    const data = await res.json().catch(() => null);
    const parsed = parseProviderResponse(data);
    return { ...parsed, raw: data };
  } finally {
    clearTimeout(timer);
  }
}

function updateCacheSuccess(
  db: Database.Database,
  ip: string,
  result: { asn: number | null; org: string | null; source: string; nowMs: number }
) {
  const { asn, org, source, nowMs } = result;
  db.prepare(
    `
    UPDATE grift_ip_asn_cache
    SET
      asn = ?,
      org = ?,
      source = ?,
      fetched_at = ?,
      last_attempt_at = ?,
      attempt_count = COALESCE(attempt_count, 0) + 1,
      error = NULL,
      error_at = NULL,
      next_retry_at = NULL
    WHERE ip = ?
  `
  ).run(asn, org, source, nowMs, nowMs, ip);
}

function updateCacheError(db: Database.Database, ip: string, err: string, nowMs: number) {
  const row = db
    .prepare(`SELECT attempt_count FROM grift_ip_asn_cache WHERE ip = ?`)
    .get(ip) as { attempt_count?: number } | undefined;
  const attemptCount = Math.max(0, Number(row?.attempt_count ?? 0));
  const nextRetryAt = nowMs + backoffMs(attemptCount);

  db.prepare(
    `
    UPDATE grift_ip_asn_cache
    SET
      last_attempt_at = ?,
      attempt_count = COALESCE(attempt_count, 0) + 1,
      error = ?,
      error_at = ?,
      next_retry_at = ?
    WHERE ip = ?
  `
  ).run(nowMs, err.slice(0, 500), nowMs, nextRetryAt, ip);
}

function backfillTables(db: Database.Database, ip: string, asn: number | null, org: string | null) {
  if (asn == null && !org) return;
  // Prefer to only fill missing values; preserve any already-recorded values.
  // Match both normalized and common raw variants (e.g., IPv4-mapped IPv6 "::ffff:1.2.3.4").
  const ipKey = normalizeIpKey(ip) ?? ip;
  const ipKeyLower = ipKey.toLowerCase();
  const candidates = new Set<string>([ipKeyLower]);
  if (ipKeyLower.includes(".")) candidates.add(`::ffff:${ipKeyLower}`);

  const candidateList = Array.from(candidates);
  const placeholders = candidateList.map(() => "?").join(",");
  const whereParts: string[] = [`lower(ip) IN (${placeholders})`];
  const params: any[] = [...candidateList];

  // Port-suffixed IPv4 (rare, but can exist in legacy logs): "1.2.3.4:1234"
  if (ipKeyLower.includes(".")) {
    whereParts.push(`lower(ip) LIKE ?`);
    params.push(`${ipKeyLower}:%`);
  }

  const ipWhere = `(${whereParts.join(" OR ")})`;

  try {
    db.prepare(
      `
      UPDATE grift_observations
      SET
        asn = COALESCE(asn, ?),
        org = COALESCE(org, ?)
      WHERE ${ipWhere} AND (asn IS NULL OR org IS NULL)
    `
    ).run(asn, org, ...params);
  } catch {
    // ignore
  }
  try {
    db.prepare(
      `
      UPDATE grift_trade_observations
      SET
        asn = COALESCE(asn, ?),
        org = COALESCE(org, ?)
      WHERE ${ipWhere} AND (asn IS NULL OR org IS NULL)
    `
    ).run(asn, org, ...params);
  } catch {
    // ignore
  }
  try {
    db.prepare(
      `
      UPDATE auth_events
      SET
        asn = COALESCE(asn, ?),
        org = COALESCE(org, ?)
      WHERE ${ipWhere} AND (asn IS NULL OR org IS NULL)
    `
    ).run(asn, org, ...params);
  } catch {
    // ignore
  }
}

export async function enrichIpAsnCacheBatch(
  db: Database.Database,
  opts?: { limit?: number; lookbackMs?: number; ttlMs?: number }
): Promise<{ attempted: number; enriched: number; skipped: boolean; reason?: string }> {
  const nowMs = Date.now();
  const lookbackMs = opts?.lookbackMs ?? 24 * 60 * 60 * 1000;
  const ttlMs = opts?.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = Math.max(1, Math.min(200, Number(opts?.limit ?? 30)));

  // Ensure local dataset is imported if available (safe no-op if already imported).
  try {
    await maybeImportIp2AsnDataset(db);
  } catch {
    // ignore import failures; remote enrichment may still be possible.
  }

  const hasRemoteProvider = !!process.env.GRIFT_IPTOASN_URL_TEMPLATE;
  const hasLocalDataset = (() => {
    try {
      const row = db.prepare(`SELECT 1 as ok FROM grift_ip_asn_ranges LIMIT 1`).get() as any;
      return !!row?.ok;
    } catch {
      return false;
    }
  })();

  if (!hasLocalDataset && !hasRemoteProvider) {
    return { attempted: 0, enriched: 0, skipped: true, reason: "No local ip2asn dataset imported and no remote provider configured" };
  }

  // Seed cache with IPs seen recently in observations.
  const since = nowMs - lookbackMs;
  try {
    const ips = db
      .prepare(
        `
        SELECT DISTINCT ip
        FROM grift_observations
        WHERE observed_at >= ? AND ip IS NOT NULL AND ip != ''
        LIMIT 5000
      `
      )
      .all(since) as { ip: string }[];
    for (const r of ips) {
      const ip = normalizeIpKey(r.ip);
      if (!ip) continue;
      touchIpAsnCache(db, ip, nowMs);
    }
  } catch {
    // ignore
  }

  const staleBefore = nowMs - ttlMs;
  const rows = db
    .prepare(
      `
      SELECT ip, asn, org, fetched_at, next_retry_at
      FROM grift_ip_asn_cache
      WHERE
        (asn IS NULL OR org IS NULL OR fetched_at IS NULL OR fetched_at < ?)
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY last_seen_at DESC
      LIMIT ?
    `
    )
    .all(staleBefore, nowMs, limit) as { ip: string; asn: number | null; org: string | null; fetched_at: number | null; next_retry_at: number | null }[];

  let attempted = 0;
  let enriched = 0;

  for (const row of rows) {
    const ip = normalizeIpKey(row.ip);
    if (!ip) continue;
    attempted++;

    if (isPrivateIp(ip)) {
      updateCacheError(db, ip, "PRIVATE_IP", nowMs);
      continue;
    }

    try {
      // Prefer offline dataset for determinism; fall back to remote provider when configured.
      const local = hasLocalDataset ? lookupIp2Asn(db, ip) : null;
      if (local) {
        updateCacheSuccess(db, ip, { asn: local.asn, org: local.org, source: local.source, nowMs });
        backfillTables(db, ip, local.asn, local.org);
        enriched++;
        continue;
      }

      if (hasRemoteProvider) {
        const result = await fetchIpAsnOrg(ip);
        if (result.asn == null && !result.org) {
          updateCacheError(db, ip, "NO_DATA", nowMs);
          continue;
        }
        updateCacheSuccess(db, ip, { asn: result.asn, org: result.org, source: "iptoasn", nowMs });
        backfillTables(db, ip, result.asn, result.org);
        enriched++;
        continue;
      }

      updateCacheError(db, ip, "NO_DATA", nowMs);
    } catch (e: any) {
      updateCacheError(db, ip, String(e?.message ?? e ?? "ENRICH_ERROR"), nowMs);
    }
  }

  return { attempted, enriched, skipped: false };
}
