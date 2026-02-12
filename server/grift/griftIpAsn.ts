import type { GriftDb } from "./griftDb";
import { lookupIp2Asn, maybeImportIp2AsnDataset } from "./griftIp2AsnDataset";
import { isPrivateOrLoopbackIp, normalizeIpKey as normalizeRequestIpKey } from "@shared/security/requestIdentity";

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
  return normalizeRequestIpKey(input);
}

function isPrivateIp(ip: string): boolean {
  return isPrivateOrLoopbackIp(ip);
}

function backoffMs(attemptCount: number) {
  const base = 5 * 60 * 1000; // 5 minutes
  const max = 24 * 60 * 60 * 1000; // 24 hours
  const pow = Math.min(6, Math.max(0, attemptCount)); // cap growth
  return Math.min(max, base * Math.pow(2, pow));
}

export async function touchIpAsnCache(db: GriftDb, ipRaw: string, nowMs: number = Date.now()): Promise<void> {
  const ip = normalizeIpKey(ipRaw);
  if (!ip) return;
  await db.prepare(
    `
    INSERT INTO grift_ip_asn_cache (ip, last_seen_at)
    VALUES (?, ?)
    ON CONFLICT(ip) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `
  ).run(ip, nowMs);
}

export async function noteIpAsnFromHeaders(
  db: GriftDb,
  input: { ip: string; asn?: number | null; org?: string | null },
  nowMs: number = Date.now()
): Promise<void> {
  const ip = normalizeIpKey(input.ip);
  if (!ip) return;
  const asn = typeof input.asn === "number" ? input.asn : null;
  const org = typeof input.org === "string" ? input.org : null;
  if (asn == null && !org) {
    await touchIpAsnCache(db, ip, nowMs);
    return;
  }

  await db.prepare(
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

export async function getCachedIpAsnOrg(
  db: GriftDb,
  ipRaw: string,
  opts?: { nowMs?: number; ttlMs?: number }
): Promise<IpAsnOrg | null> {
  const ip = normalizeIpKey(ipRaw);
  if (!ip) return null;
  const nowMs = opts?.nowMs ?? Date.now();
  const ttlMs = opts?.ttlMs ?? 7 * 24 * 60 * 60 * 1000;

  const row = await db
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

export async function resolveAsnOrg(
  db: GriftDb,
  input: { ip?: string | null; asn?: number | null; org?: string | null },
  nowMs: number = Date.now()
): Promise<{ ip: string | null; asn: number | null; org: string | null }> {
  const ip = normalizeIpKey(input.ip ?? null);
  if (!ip) return { ip: null, asn: input.asn ?? null, org: input.org ?? null };

  // If a proxy/provider already gave ASN/org, treat it as authoritative and cache it.
  if (typeof input.asn === "number" || typeof input.org === "string") {
    await noteIpAsnFromHeaders(db, { ip, asn: input.asn ?? null, org: input.org ?? null }, nowMs);
    return { ip, asn: input.asn ?? null, org: input.org ?? null };
  }

  // Touch so the scheduler can enrich later.
  await touchIpAsnCache(db, ip, nowMs);

  const cached = await getCachedIpAsnOrg(db, ip, { nowMs });
  if (cached) return { ip, asn: cached.asn ?? null, org: cached.org ?? null };

  // Fast offline lookup via ip2asn range table (if imported).
  const local = await lookupIp2Asn(db, ip);
  if (local) {
    await updateCacheSuccess(db, ip, { asn: local.asn, org: local.org, source: local.source, nowMs });
    await backfillTables(db, ip, local.asn, local.org);
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

async function updateCacheSuccess(
  db: GriftDb,
  ip: string,
  result: { asn: number | null; org: string | null; source: string; nowMs: number }
): Promise<void> {
  const { asn, org, source, nowMs } = result;
  await db.prepare(
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

async function updateCacheError(db: GriftDb, ip: string, err: string, nowMs: number): Promise<void> {
  const row = await db
    .prepare(`SELECT attempt_count FROM grift_ip_asn_cache WHERE ip = ?`)
    .get(ip) as { attempt_count?: number } | undefined;
  const attemptCount = Math.max(0, Number(row?.attempt_count ?? 0));
  const nextRetryAt = nowMs + backoffMs(attemptCount);

  await db.prepare(
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

async function backfillTables(db: GriftDb, ip: string, asn: number | null, org: string | null): Promise<void> {
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
    await db.prepare(
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
    await db.prepare(
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
    await db.prepare(
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
  db: GriftDb,
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
  const hasLocalDataset = await (async () => {
    try {
      const row = await db.prepare(`SELECT 1 as ok FROM grift_ip_asn_ranges LIMIT 1`).get() as any;
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
    const ips = await db
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
      await touchIpAsnCache(db, ip, nowMs);
    }
  } catch {
    // ignore
  }

  const staleBefore = nowMs - ttlMs;
  const rows = await db
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
      await updateCacheError(db, ip, "PRIVATE_IP", nowMs);
      continue;
    }

    try {
      // Prefer offline dataset for determinism; fall back to remote provider when configured.
      const local = hasLocalDataset ? await lookupIp2Asn(db, ip) : null;
      if (local) {
        await updateCacheSuccess(db, ip, { asn: local.asn, org: local.org, source: local.source, nowMs });
        await backfillTables(db, ip, local.asn, local.org);
        enriched++;
        continue;
      }

      if (hasRemoteProvider) {
        const result = await fetchIpAsnOrg(ip);
        if (result.asn == null && !result.org) {
          await updateCacheError(db, ip, "NO_DATA", nowMs);
          continue;
        }
        await updateCacheSuccess(db, ip, { asn: result.asn, org: result.org, source: "iptoasn", nowMs });
        await backfillTables(db, ip, result.asn, result.org);
        enriched++;
        continue;
      }

      await updateCacheError(db, ip, "NO_DATA", nowMs);
    } catch (e: any) {
      await updateCacheError(db, ip, String(e?.message ?? e ?? "ENRICH_ERROR"), nowMs);
    }
  }

  return { attempted, enriched, skipped: false };
}
