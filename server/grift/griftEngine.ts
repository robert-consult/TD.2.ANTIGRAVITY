// server/grift/griftEngine.ts
import type { GriftDb } from "./griftDb";
import type { GriftConfig, GriftRuleCode, GriftSeverity, AuditContext, RuleTrigger } from "./griftTypes";
import { DEFAULT_GRIFT_CONFIG } from "./griftDefaults";
import { haversineKm, kmh } from "./griftGeo";
import { normalizeIpKey, resolveAsnOrg } from "./griftIpAsn";

let configCache: { cfg: GriftConfig; fetchedAt: number } | null = null;
const CONFIG_TTL_MS = 60_000;

// Map snake_case DB row to camelCase GriftConfig with default fallbacks for NULL values
function mapConfigRow(row: any): GriftConfig {
  const d = DEFAULT_GRIFT_CONFIG;
  return {
    id: row.id ?? d.id,
    enabled: row.enabled ?? d.enabled,
    multiAccountWindowDays: row.multi_account_window_days ?? d.multiAccountWindowDays,
    churnWindowHours: row.churn_window_hours ?? d.churnWindowHours,
    hedgeWindowMinutes: row.hedge_window_minutes ?? d.hedgeWindowMinutes,
    concurrentWindowMinutes: row.concurrent_window_minutes ?? d.concurrentWindowMinutes,
    ipUniqueThreshold: row.ip_unique_threshold ?? d.ipUniqueThreshold,
    uaUniqueThreshold: row.ua_unique_threshold ?? d.uaUniqueThreshold,
    deviceUniqueThreshold: row.device_unique_threshold ?? d.deviceUniqueThreshold,
    asnUniqueThreshold: row.asn_unique_threshold ?? d.asnUniqueThreshold,
    geoVelocityKmhThreshold: row.geo_velocity_kmh_threshold ?? d.geoVelocityKmhThreshold,
    geoVelocityMinDistanceKm: row.geo_velocity_min_distance_km ?? d.geoVelocityMinDistanceKm,
    geoVelocityMaxHours: row.geo_velocity_max_hours ?? d.geoVelocityMaxHours,
    hedgeRequireDeviceMatch: row.hedge_require_device_match ?? d.hedgeRequireDeviceMatch,
    hedgeAllowIpMatch: row.hedge_allow_ip_match ?? d.hedgeAllowIpMatch,
    scoreMultiAccountDevice: row.score_multi_account_device ?? d.scoreMultiAccountDevice,
    scoreMultiAccountFingerprint: row.score_multi_account_fingerprint ?? d.scoreMultiAccountFingerprint,
    scoreHedgePair: row.score_hedge_pair ?? d.scoreHedgePair,
    scoreIpChurn: row.score_ip_churn ?? d.scoreIpChurn,
    scoreUaChurn: row.score_ua_churn ?? d.scoreUaChurn,
    scoreDeviceChurn: row.score_device_churn ?? d.scoreDeviceChurn,
    scoreGeoVelocity: row.score_geo_velocity ?? d.scoreGeoVelocity,
    scoreConcurrentSessions: row.score_concurrent_sessions ?? d.scoreConcurrentSessions,
    scoreAsnVolatility: row.score_asn_volatility ?? d.scoreAsnVolatility,
    scoreSharedIpAsnCluster: row.score_shared_ip_asn_cluster ?? d.scoreSharedIpAsnCluster,
    scoreMultiAccountLaddering: row.score_multi_account_laddering ?? d.scoreMultiAccountLaddering,
    clusterMinUsersForIpAsn: row.cluster_min_users_for_ip_asn ?? d.clusterMinUsersForIpAsn,
    ladderingWindowDays: row.laddering_window_days ?? d.ladderingWindowDays,
    ladderingMinSequence: row.laddering_min_sequence ?? d.ladderingMinSequence,
    tierMed: row.tier_med ?? d.tierMed,
    tierHigh: row.tier_high ?? d.tierHigh,
    tierCritical: row.tier_critical ?? d.tierCritical,
    mitigationMfa: row.mitigation_mfa ?? d.mitigationMfa,
    mitigationKycApproved: row.mitigation_kyc_approved ?? d.mitigationKycApproved,
    enforcementFreezeThreshold: row.enforcement_freeze_threshold ?? d.enforcementFreezeThreshold,
    enforcementDisableThreshold: row.enforcement_disable_threshold ?? d.enforcementDisableThreshold,
    enforcementAutoFreeze: row.enforcement_auto_freeze ?? d.enforcementAutoFreeze,
    enforcementAutoDisable: row.enforcement_auto_disable ?? d.enforcementAutoDisable,
    retentionObservationsDays: row.retention_observations_days ?? d.retentionObservationsDays,
    retentionTradeObservationsDays: row.retention_trade_observations_days ?? d.retentionTradeObservationsDays,
    retentionAuthEventsDays: row.retention_auth_events_days ?? d.retentionAuthEventsDays,
    retentionIpAsnCacheDays: row.retention_ip_asn_cache_days ?? d.retentionIpAsnCacheDays,
    updatedAt: row.updated_at ?? d.updatedAt,
    updatedByAdminId: row.updated_by_admin_id ?? d.updatedByAdminId,
  };
}

export async function getConfig(db: GriftDb): Promise<GriftConfig> {
  const now = Date.now();
  if (configCache && now - configCache.fetchedAt < CONFIG_TTL_MS) {
    return configCache.cfg;
  }
  const row = await db.prepare("SELECT * FROM grift_config WHERE id=1").get() as any;
  const cfg = row ? mapConfigRow(row) : DEFAULT_GRIFT_CONFIG;
  configCache = { cfg, fetchedAt: now };
  return cfg;
}

export function invalidateConfigCache() {
  configCache = null;
}

function severity(points: number, cfg: GriftConfig): GriftSeverity {
  if (points >= cfg.tierCritical) return "CRITICAL";
  if (points >= cfg.tierHigh) return "HIGH";
  if (points >= cfg.tierMed) return "MED";
  return "LOW";
}

// ---------------------------------------------------------------------
// Signal management with deduplication
// ---------------------------------------------------------------------
export async function createOrUpdateSignal(
  db: GriftDb,
  trigger: RuleTrigger,
  dedupeKey: string,
  ctx?: AuditContext,
  meta?: { symbol?: string; tradeId?: number }
): Promise<number> {
  const now = ctx?.ts ?? Date.now();
  const existing = await db.prepare(`
    SELECT id, points, status, severity FROM grift_signals WHERE dedupe_key = ?
  `).get(dedupeKey) as { id: number; points: number; status: string; severity: GriftSeverity } | undefined;

  const deviceId = ctx?.deviceId ?? null;
  const deviceFp = ctx?.deviceFp ?? null;
  const deviceInstallId = ctx?.deviceInstallId ?? null;
  const clientTz = ctx?.clientTz ?? null;
  const clientLang = ctx?.clientLang ?? null;
  const ip = ctx?.ip ?? null;
  const userAgent = ctx?.userAgent ?? null;
  const geoCountry = ctx?.geoCountry ?? null;
  const geoRegion = ctx?.geoRegion ?? null;
  const geoCity = ctx?.geoCity ?? null;
  const latitude = ctx?.latitude ?? null;
  const longitude = ctx?.longitude ?? null;
  const asn = ctx?.asn ?? null;
  const org = ctx?.org ?? null;
  const symbol = meta?.symbol ?? null;
  const tradeId = meta?.tradeId ?? null;

  if (existing) {
    const isOpen = existing.status === "OPEN";
    const updatedPoints = isOpen ? Math.max(existing.points, trigger.points) : existing.points;
    const updatedSeverity = isOpen && trigger.points > existing.points ? trigger.severity : existing.severity;

    await db.prepare(`
      UPDATE grift_signals SET
        points = ?,
        severity = ?,
        evidence_json = ?,
        updated_at = ?,
        device_id = COALESCE(?, device_id),
        device_fp = COALESCE(?, device_fp),
        device_install_id = COALESCE(?, device_install_id),
        client_tz = COALESCE(?, client_tz),
        client_lang = COALESCE(?, client_lang),
        ip = COALESCE(?, ip),
        user_agent = COALESCE(?, user_agent),
        geo_country = COALESCE(?, geo_country),
        geo_region = COALESCE(?, geo_region),
        geo_city = COALESCE(?, geo_city),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        asn = COALESCE(?, asn),
        org = COALESCE(?, org),
        symbol = COALESCE(?, symbol),
        trade_id = COALESCE(?, trade_id)
      WHERE id = ?
    `).run(
      updatedPoints,
      updatedSeverity,
      JSON.stringify(trigger.evidence),
      now,
      deviceId,
      deviceFp,
      deviceInstallId,
      clientTz,
      clientLang,
      ip,
      userAgent,
      geoCountry,
      geoRegion,
      geoCity,
      latitude,
      longitude,
      asn,
      org,
      symbol,
      tradeId,
      existing.id
    );
    return existing.id;
  }

  const result = await db.prepare(`
    INSERT INTO grift_signals (
      user_id, rule_code, severity, related_user_id, points, evidence_json, status,
      dedupe_key, created_at, updated_at,
      device_id, device_fp, device_install_id, client_tz, client_lang,
      ip, user_agent, geo_country, geo_region, geo_city, latitude, longitude, asn, org,
      symbol, trade_id
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, 'OPEN',
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?
    )
    RETURNING id
  `).run(
    trigger.primaryUserId,
    trigger.ruleCode,
    trigger.severity,
    trigger.secondaryUserId ?? null,
    trigger.points,
    JSON.stringify(trigger.evidence),
    dedupeKey,
    now,
    now,
    deviceId,
    deviceFp,
    deviceInstallId,
    clientTz,
    clientLang,
    ip,
    userAgent,
    geoCountry,
    geoRegion,
    geoCity,
    latitude,
    longitude,
    asn,
    org,
    symbol,
    tradeId
  );

  return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------
// Device tracking
// ---------------------------------------------------------------------
export async function recordDevice(db: GriftDb, deviceId: string, userId: number, ip?: string, ua?: string) {
  const now = Date.now();

  // Upsert device - schema uses device_id as PRIMARY KEY
  await db.prepare(`
    INSERT INTO grift_devices (device_id, first_seen_at, last_seen_at, first_ip)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE
      SET last_seen_at = ?,
          first_ip = COALESCE(grift_devices.first_ip, EXCLUDED.first_ip)
  `).run(deviceId, now, now, ip ?? null, now);

  // Upsert device-user link
  await db.prepare(`
    INSERT INTO grift_device_users (device_id, user_id, first_seen_at, last_seen_at, seen_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(device_id, user_id) DO UPDATE
      SET last_seen_at = ?,
          seen_count = grift_device_users.seen_count + 1
  `).run(deviceId, userId, now, now, now);
}

function normalizeIp(ip: string): string {
  return normalizeIpKey(ip) ?? ip;
}

function computeIpSubnet(ip: string): string | null {
  const normalized = normalizeIp(ip);
  if (normalized.includes(":")) {
    const parts = normalized.split(":").filter(Boolean);
    if (parts.length === 0) return null;
    const prefix = parts.slice(0, 4).join(":");
    if (!prefix) return null;
    return `${prefix}::/64`;
  }
  const parts = normalized.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function stableUserPair(a: number, b: number) {
  return a < b ? ([a, b] as const) : ([b, a] as const);
}

async function upsertIdentityLink(
  db: GriftDb,
  userId: number,
  linkType: string,
  linkValue: string,
  metadata?: Record<string, any>
): Promise<void> {
  const now = Date.now();
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  await db.prepare(`
    INSERT INTO grift_identity_links (
      user_id, link_type, link_value, first_seen_at, last_seen_at, occurrence_count, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(user_id, link_type, link_value) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      occurrence_count = grift_identity_links.occurrence_count + 1,
      metadata_json = COALESCE(excluded.metadata_json, grift_identity_links.metadata_json)
  `).run(userId, linkType, linkValue, now, now, metadataJson);
}

async function recordIdentityLinks(db: GriftDb, ctx: AuditContext): Promise<void> {
  if (!ctx.userId) return;
  const userId = ctx.userId;

  if (ctx.deviceInstallId) {
    await upsertIdentityLink(db, userId, "device_install_id", ctx.deviceInstallId);
  }
  if (ctx.deviceFp) {
    await upsertIdentityLink(db, userId, "device_fp", ctx.deviceFp);
  }
  if (ctx.deviceIdLegacy) {
    await upsertIdentityLink(db, userId, "device_id", ctx.deviceIdLegacy);
  } else if (!ctx.deviceInstallId && ctx.deviceId) {
    await upsertIdentityLink(db, userId, "device_id", ctx.deviceId);
  }
  if (ctx.ip) {
    const ip = normalizeIp(ctx.ip);
    await upsertIdentityLink(db, userId, "ip", ip);
    const subnet = computeIpSubnet(ip);
    if (subnet) {
      await upsertIdentityLink(db, userId, "ip_subnet", subnet, { ip });
    }
  }
  if (ctx.asn != null) {
    await upsertIdentityLink(db, userId, "asn", String(ctx.asn));
  }
  if (ctx.org) {
    await upsertIdentityLink(db, userId, "org", ctx.org);
  }
}

// ---------------------------------------------------------------------
// Observation recording
// ---------------------------------------------------------------------
export async function recordObservation(db: GriftDb, ctx: AuditContext): Promise<void> {
  if (!ctx.userId) return;
  const eventType = ctx.eventType ?? "SESSION_PING";
  const observedAt = ctx.ts ?? Date.now();

  await db.prepare(`
    INSERT INTO grift_observations (
      user_id, event_type, session_id, device_id, device_fp, device_install_id, client_tz, client_lang,
      ip, user_agent, geo_country, geo_region, geo_city, latitude, longitude, asn, org, observed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ctx.userId,
    eventType,
    ctx.sessionId ?? null,
    ctx.deviceId ?? null,
    ctx.deviceFp ?? null,
    ctx.deviceInstallId ?? null,
    ctx.clientTz ?? null,
    ctx.clientLang ?? null,
    ctx.ip ?? null,
    ctx.userAgent ?? null,
    ctx.geoCountry ?? null,
    ctx.geoRegion ?? null,
    ctx.geoCity ?? null,
    ctx.latitude ?? null,
    ctx.longitude ?? null,
    ctx.asn ?? null,
    ctx.org ?? null,
    observedAt
  );

  await recordIdentityLinks(db, ctx);
}

export async function recordTradeObservation(
  db: GriftDb,
  tradeId: number,
  symbol: string,
  direction: string,
  lots: number,
  ctx: AuditContext
): Promise<void> {
  if (!ctx.userId) return;
  const observedAt = ctx.ts ?? Date.now();

  await db.prepare(`
    INSERT INTO grift_trade_observations (
      trade_id, user_id, session_id, device_id, device_fp, device_install_id, client_tz, client_lang,
      ip, user_agent, symbol, direction, lots, geo_country, geo_region, geo_city, latitude, longitude, asn, org, observed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tradeId,
    ctx.userId,
    ctx.sessionId ?? null,
    ctx.deviceId ?? null,
    ctx.deviceFp ?? null,
    ctx.deviceInstallId ?? null,
    ctx.clientTz ?? null,
    ctx.clientLang ?? null,
    ctx.ip ?? null,
    ctx.userAgent ?? null,
    symbol,
    direction,
    lots,
    ctx.geoCountry ?? null,
    ctx.geoRegion ?? null,
    ctx.geoCity ?? null,
    ctx.latitude ?? null,
    ctx.longitude ?? null,
    ctx.asn ?? null,
    ctx.org ?? null,
    observedAt
  );
}

// ---------------------------------------------------------------------
// Linked account edge management
// ---------------------------------------------------------------------
export async function recordLinkedEdge(
  db: GriftDb,
  userIdA: number,
  userIdB: number,
  linkType: "device" | "device_fp" | "ip" | "ip_subnet" | "asn",
  linkValue: string
): Promise<void> {
  if (userIdA === userIdB) return;

  const now = Date.now();
  const [lo, hi] = userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];

  await db.prepare(`
    INSERT INTO grift_linked_account_edges (user_a, user_b, link_type, link_value, confidence, first_linked_at, last_confirmed_at)
    VALUES (?, ?, ?, ?, 1.0, ?, ?)
    ON CONFLICT(user_a, user_b, link_type, link_value) DO UPDATE SET confidence = confidence + 0.1, last_confirmed_at = ?
  `).run(lo, hi, linkType, linkValue, now, now, now);
}

// ---------------------------------------------------------------------
// RULE: MULTI_ACCOUNT_DEVICE
// ---------------------------------------------------------------------
export async function checkMultiAccountDevice(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.deviceId || !ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.multiAccountWindowDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const users = await db.prepare(`
    SELECT DISTINCT user_id FROM grift_device_users
    WHERE device_id = ? AND last_seen_at >= ?
  `).all(ctx.deviceId, cutoff) as { user_id: number }[];

  const otherUsers = users.filter((u) => u.user_id !== ctx.userId);
  if (otherUsers.length === 0) return null;

  for (const other of otherUsers) {
    await recordLinkedEdge(db, ctx.userId, other.user_id, "device", ctx.deviceId);
  }

  const points = cfg.scoreMultiAccountDevice;
  const linkedUserIds = otherUsers.map((u) => u.user_id).sort((a, b) => a - b);
  return {
    ruleCode: "MULTI_ACCOUNT_DEVICE",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    secondaryUserId: linkedUserIds[0],
    points,
    evidence: { deviceId: ctx.deviceId, linkedUsers: linkedUserIds },
  };
}

// ---------------------------------------------------------------------
// RULE: MULTI_ACCOUNT_FINGERPRINT
// ---------------------------------------------------------------------
export async function checkMultiAccountFingerprint(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.deviceFp || !ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.multiAccountWindowDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const users = await db
    .prepare(
      `
      SELECT DISTINCT user_id FROM grift_identity_links
      WHERE link_type = 'device_fp' AND link_value = ? AND last_seen_at >= ?
    `
    )
    .all(ctx.deviceFp, cutoff) as { user_id: number }[];

  const otherUsers = users.filter((u) => u.user_id !== ctx.userId);
  if (otherUsers.length === 0) return null;

  for (const other of otherUsers) {
    await recordLinkedEdge(db, ctx.userId, other.user_id, "device_fp", ctx.deviceFp);
  }

  const points = cfg.scoreMultiAccountFingerprint;
  const linkedUserIds = otherUsers.map((u) => u.user_id).sort((a, b) => a - b);
  return {
    ruleCode: "MULTI_ACCOUNT_FINGERPRINT",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    secondaryUserId: linkedUserIds[0],
    points,
    evidence: {
      deviceFp: ctx.deviceFp,
      linkedUsers: linkedUserIds,
      windowDays: cfg.multiAccountWindowDays,
    },
  };
}

// ---------------------------------------------------------------------
// RULE: IP_CHURN
// ---------------------------------------------------------------------
export async function checkIpChurn(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.churnWindowHours * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const ips = await db.prepare(`
    SELECT DISTINCT ip FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND ip IS NOT NULL
  `).all(ctx.userId, cutoff) as { ip: string }[];

  if (ips.length < cfg.ipUniqueThreshold) return null;

  const points = cfg.scoreIpChurn;
  return {
    ruleCode: "IP_CHURN",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: { uniqueIps: ips.length, threshold: cfg.ipUniqueThreshold, windowHours: cfg.churnWindowHours },
  };
}

// ---------------------------------------------------------------------
// RULE: UA_CHURN
// ---------------------------------------------------------------------
export async function checkUaChurn(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.churnWindowHours * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const uas = await db.prepare(`
    SELECT DISTINCT user_agent FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND user_agent IS NOT NULL
  `).all(ctx.userId, cutoff) as { user_agent: string }[];

  if (uas.length < cfg.uaUniqueThreshold) return null;

  const points = cfg.scoreUaChurn;
  return {
    ruleCode: "UA_CHURN",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: { uniqueUas: uas.length, threshold: cfg.uaUniqueThreshold, windowHours: cfg.churnWindowHours },
  };
}

// ---------------------------------------------------------------------
// RULE: DEVICE_CHURN
// ---------------------------------------------------------------------
export async function checkDeviceChurn(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.churnWindowHours * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const devices = await db.prepare(`
    SELECT DISTINCT device_id FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND device_id IS NOT NULL
  `).all(ctx.userId, cutoff) as { device_id: string }[];

  if (devices.length < cfg.deviceUniqueThreshold) return null;

  const points = cfg.scoreDeviceChurn;
  return {
    ruleCode: "DEVICE_CHURN",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: { uniqueDevices: devices.length, threshold: cfg.deviceUniqueThreshold, windowHours: cfg.churnWindowHours },
  };
}

// ---------------------------------------------------------------------
// RULE: GEO_VELOCITY (Impossible Travel)
// ---------------------------------------------------------------------
export async function checkGeoVelocity(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId || ctx.latitude == null || ctx.longitude == null) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.geoVelocityMaxHours * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const prev = await db.prepare(`
    SELECT latitude, longitude, observed_at, geo_country, geo_region, geo_city, device_id, ip, user_agent
    FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND observed_at < ? AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY observed_at DESC LIMIT 1
  `).get(ctx.userId, cutoff, ctx.ts) as { 
    latitude: number; longitude: number; observed_at: number;
    geo_country: string | null; geo_region: string | null; geo_city: string | null;
    device_id: string | null; ip: string | null; user_agent: string | null;
  } | undefined;

  if (!prev) return null;

  const distKm = haversineKm(
    { lat: prev.latitude, lon: prev.longitude },
    { lat: ctx.latitude, lon: ctx.longitude }
  );

  if (distKm < cfg.geoVelocityMinDistanceKm) return null;

  const deltaMs = ctx.ts - prev.observed_at;
  const velocityKmh = kmh(distKm, deltaMs);

  if (velocityKmh < cfg.geoVelocityKmhThreshold) return null;

  const points = cfg.scoreGeoVelocity;

  const trigger: RuleTrigger = {
    ruleCode: "GEO_VELOCITY",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: {
      distanceKm: Math.round(distKm),
      velocityKmh: Math.round(velocityKmh),
      timeElapsedHours: Math.round((deltaMs / (1000 * 60 * 60)) * 100) / 100,
      previousLocation: {
        lat: prev.latitude,
        lon: prev.longitude,
        country: prev.geo_country,
        region: prev.geo_region,
        city: prev.geo_city,
        observedAt: prev.observed_at,
      },
      currentLocation: {
        lat: ctx.latitude,
        lon: ctx.longitude,
        country: ctx.geoCountry,
        region: ctx.geoRegion,
        city: ctx.geoCity,
        observedAt: ctx.ts,
      },
      threshold: cfg.geoVelocityKmhThreshold,
      context: {
        deviceId: ctx.deviceId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        geoCountry: ctx.geoCountry,
        geoRegion: ctx.geoRegion,
        geoCity: ctx.geoCity,
        asn: ctx.asn,
        org: ctx.org,
      },
    },
  };

  return trigger;
}

// ---------------------------------------------------------------------
// RULE: CONCURRENT_SESSIONS
// ---------------------------------------------------------------------
export async function checkConcurrentSessions(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.concurrentWindowMinutes * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const observations = await db.prepare(`
    SELECT device_id, ip, observed_at, user_agent, geo_country, geo_region, geo_city
    FROM grift_observations
    WHERE user_id = ? AND observed_at >= ?
  `).all(ctx.userId, cutoff) as { 
    device_id: string | null; ip: string | null; observed_at: number;
    user_agent: string | null; geo_country: string | null; geo_region: string | null; geo_city: string | null;
  }[];

  const contextMap = new Map<string, { device_id: string | null; ip: string | null; observed_at: number }>();
  for (const obs of observations) {
    const key = `${obs.device_id || 'unknown'}:${obs.ip || 'unknown'}`;
    if (!contextMap.has(key)) {
      contextMap.set(key, { device_id: obs.device_id, ip: obs.ip, observed_at: obs.observed_at });
    }
  }

  const distinctContexts = contextMap.size;
  if (distinctContexts < 2) return null;

  const points = cfg.scoreConcurrentSessions;

  const contexts = Array.from(contextMap.values()).map(c => ({
    device_id: c.device_id,
    ip: c.ip,
    observed_at: c.observed_at,
  }));

  const trigger: RuleTrigger = {
    ruleCode: "CONCURRENT_SESSIONS",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: {
      distinctContexts,
      contexts,
      windowMinutes: cfg.concurrentWindowMinutes,
      context: {
        deviceId: ctx.deviceId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        geoCountry: ctx.geoCountry,
        geoRegion: ctx.geoRegion,
        geoCity: ctx.geoCity,
        asn: ctx.asn,
        org: ctx.org,
      },
    },
  };

  return trigger;
}

// ---------------------------------------------------------------------
// RULE: ASN_VOLATILITY
// ---------------------------------------------------------------------
export async function checkAsnVolatility(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.churnWindowHours * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const asns = await db.prepare(`
    SELECT DISTINCT asn FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND asn IS NOT NULL
  `).all(ctx.userId, cutoff) as { asn: number }[];

  if (asns.length < cfg.asnUniqueThreshold) return null;

  const points = cfg.scoreAsnVolatility;
  return {
    ruleCode: "ASN_VOLATILITY",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: { uniqueAsns: asns.length, threshold: cfg.asnUniqueThreshold, windowHours: cfg.churnWindowHours },
  };
}

// ---------------------------------------------------------------------
// RULE: SHARED_IPASN_CLUSTER (Multiple users sharing IP+ASN combination)
// ---------------------------------------------------------------------
export async function checkSharedIpAsnCluster(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger | null> {
  if (!ctx.userId || !ctx.ip || !ctx.asn) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.multiAccountWindowDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const cluster = await db.prepare(`
    SELECT DISTINCT user_id FROM grift_observations
    WHERE ip = ? AND asn = ? AND observed_at >= ? AND user_id != ?
  `).all(ctx.ip, ctx.asn, cutoff, ctx.userId) as { user_id: number }[];

  if (cluster.length < cfg.clusterMinUsersForIpAsn - 1) return null;

  for (const member of cluster) {
    await recordLinkedEdge(db, ctx.userId, member.user_id, "ip", ctx.ip);
    if (ctx.asn) {
      await recordLinkedEdge(db, ctx.userId, member.user_id, "asn", String(ctx.asn));
    }
  }

  const points = cfg.scoreSharedIpAsnCluster;
  return {
    ruleCode: "SHARED_IPASN_CLUSTER",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: {
      ip: ctx.ip,
      asn: ctx.asn,
      clusterSize: cluster.length + 1,
      clusterMembers: cluster.map((m) => m.user_id),
      threshold: cfg.clusterMinUsersForIpAsn,
    },
  };
}

// ---------------------------------------------------------------------
// RULE: MULTI_ACCOUNT_LADDERING (Sequential trades across linked accounts)
// ---------------------------------------------------------------------
export async function checkMultiAccountLaddering(
  db: GriftDb,
  tradeId: number,
  symbol: string,
  direction: string,
  ctx: AuditContext
): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.ladderingWindowDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - windowMs;

  const edges = await db.prepare(`
    SELECT user_a, user_b FROM grift_linked_account_edges
    WHERE (user_a = ? OR user_b = ?)
  `).all(ctx.userId, ctx.userId) as { user_a: number; user_b: number }[];

  const linkedUserIds = new Set<number>();
  linkedUserIds.add(ctx.userId);
  for (const e of edges) {
    linkedUserIds.add(e.user_a);
    linkedUserIds.add(e.user_b);
  }

  if (linkedUserIds.size < 2) return null;

  const placeholders = Array.from(linkedUserIds).map(() => "?").join(",");
  const recentTrades = await db.prepare(`
    SELECT user_id, trade_id, observed_at FROM grift_trade_observations
    WHERE user_id IN (${placeholders})
      AND symbol = ?
      AND direction = ?
      AND observed_at >= ?
    ORDER BY observed_at ASC
  `).all(...Array.from(linkedUserIds), symbol, direction, cutoff) as { user_id: number; trade_id: number; observed_at: number }[];

  if (recentTrades.length < cfg.ladderingMinSequence) return null;

  let sequenceCount = 0;
  let lastUserId: number | null = null;
  const ladderSequence: { userId: number; tradeId: number }[] = [];

  for (const trade of recentTrades) {
    if (trade.user_id !== lastUserId) {
      sequenceCount++;
      ladderSequence.push({ userId: trade.user_id, tradeId: trade.trade_id });
      lastUserId = trade.user_id;
    }
  }

  if (sequenceCount < cfg.ladderingMinSequence) return null;

  const points = cfg.scoreMultiAccountLaddering;
  return {
    ruleCode: "MULTI_ACCOUNT_LADDERING",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    points,
    evidence: {
      symbol,
      direction,
      sequenceLength: sequenceCount,
      linkedAccounts: Array.from(linkedUserIds),
      ladderSequence: ladderSequence.slice(0, 10),
      windowDays: cfg.ladderingWindowDays,
      threshold: cfg.ladderingMinSequence,
    },
  };
}

// ---------------------------------------------------------------------
// RULE: HEDGE_PAIR (Coordinated Hedging)
// ---------------------------------------------------------------------
export async function checkHedgePair(
  db: GriftDb,
  tradeId: number,
  symbol: string,
  direction: string,
  ctx: AuditContext
): Promise<RuleTrigger | null> {
  if (!ctx.userId) return null;
  const cfg = await getConfig(db);

  const windowMs = cfg.hedgeWindowMinutes * 60 * 1000;
  const cutoff = Date.now() - windowMs;
  const oppositeDir = direction === "BUY" ? "SELL" : "BUY";

  const edges = await db.prepare(`
    SELECT user_a, user_b FROM grift_linked_account_edges
    WHERE (user_a = ? OR user_b = ?)
  `).all(ctx.userId, ctx.userId) as { user_a: number; user_b: number }[];

  const linkedUserIds = new Set<number>();
  for (const e of edges) {
    if (e.user_a !== ctx.userId) linkedUserIds.add(e.user_a);
    if (e.user_b !== ctx.userId) linkedUserIds.add(e.user_b);
  }

  const candidates = await db.prepare(`
    SELECT user_id, trade_id, device_id, device_fp, device_install_id, ip, observed_at
    FROM grift_trade_observations
    WHERE symbol = ?
      AND direction = ?
      AND observed_at >= ?
      AND user_id != ?
    ORDER BY observed_at DESC
    LIMIT 200
  `).all(symbol, oppositeDir, cutoff, ctx.userId) as {
    user_id: number;
    trade_id: number;
    device_id: string | null;
    device_fp: string | null;
    device_install_id: string | null;
    ip: string | null;
    observed_at: number;
  }[];

  if (candidates.length === 0) return null;

  const matchStrength = (t: (typeof candidates)[number]) => {
    const deviceMatch = !!(ctx.deviceId && t.device_id && t.device_id === ctx.deviceId);
    const fpMatch = !!(ctx.deviceFp && t.device_fp && t.device_fp === ctx.deviceFp);
    const ipMatch = !!(cfg.hedgeAllowIpMatch && ctx.ip && t.ip && t.ip === ctx.ip);
    const linkedEdge = linkedUserIds.has(t.user_id);

    // Prioritize strong linkage for selecting the "best" opposing trade.
    return (deviceMatch ? 30 : 0) + (fpMatch ? 20 : 0) + (ipMatch ? 10 : 0) + (linkedEdge ? 5 : 0);
  };

  const eligible = candidates
    .map((t) => ({ t, strength: matchStrength(t) }))
    .filter((x) => x.strength > 0)
    .sort((a, b) => b.strength - a.strength || (b.t.observed_at ?? 0) - (a.t.observed_at ?? 0));

  if (eligible.length === 0) return null;

  const best = eligible[0]!.t;

  const deviceMatch = !!(ctx.deviceId && best.device_id && best.device_id === ctx.deviceId);
  const fpMatch = !!(ctx.deviceFp && best.device_fp && best.device_fp === ctx.deviceFp);
  const ipMatch = !!(cfg.hedgeAllowIpMatch && ctx.ip && best.ip && best.ip === ctx.ip);
  const linkedEdge = linkedUserIds.has(best.user_id);

  // Honor configured linkage controls. When "require device match" is on, edge-only linkage is insufficient.
  if (cfg.hedgeRequireDeviceMatch) {
    const satisfiesDevicePolicy = deviceMatch || fpMatch || (cfg.hedgeAllowIpMatch ? ipMatch : false);
    if (!satisfiesDevicePolicy) return null;
  }

  // Strengthen the account-link graph for downstream laddering/network views.
  if (ctx.userId) {
    if (deviceMatch && ctx.deviceId) await recordLinkedEdge(db, ctx.userId, best.user_id, "device", ctx.deviceId);
    if (fpMatch && ctx.deviceFp) await recordLinkedEdge(db, ctx.userId, best.user_id, "device_fp", ctx.deviceFp);
    if (ipMatch && ctx.ip) await recordLinkedEdge(db, ctx.userId, best.user_id, "ip", ctx.ip);
    if (ctx.asn != null) await recordLinkedEdge(db, ctx.userId, best.user_id, "asn", String(ctx.asn));
  }

  const points = cfg.scoreHedgePair;
  return {
    ruleCode: "HEDGE_PAIR",
    severity: severity(points, cfg),
    primaryUserId: ctx.userId,
    secondaryUserId: best.user_id,
    points,
    evidence: {
      symbol,
      direction,
      oppositeDirection: oppositeDir,
      linkedTrades: eligible.slice(0, 20).map((e) => ({
        userId: e.t.user_id,
        tradeId: e.t.trade_id,
        linkage: {
          deviceMatch: !!(ctx.deviceId && e.t.device_id && e.t.device_id === ctx.deviceId),
          fpMatch: !!(ctx.deviceFp && e.t.device_fp && e.t.device_fp === ctx.deviceFp),
          ipMatch: !!(cfg.hedgeAllowIpMatch && ctx.ip && e.t.ip && e.t.ip === ctx.ip),
          linkedEdge: linkedUserIds.has(e.t.user_id),
        },
        observedAt: e.t.observed_at,
      })),
      selectedMatch: {
        userId: best.user_id,
        tradeId: best.trade_id,
        linkage: { deviceMatch, fpMatch, ipMatch, linkedEdge },
      },
      windowMinutes: cfg.hedgeWindowMinutes,
      linkagePolicy: {
        hedgeRequireDeviceMatch: cfg.hedgeRequireDeviceMatch,
        hedgeAllowIpMatch: cfg.hedgeAllowIpMatch,
      },
    },
  };
}

// ---------------------------------------------------------------------
// Auth events logging
// ---------------------------------------------------------------------
export async function recordAuthEvent(
  db: GriftDb,
  eventType: string,
  ctx: AuditContext,
  success: boolean = true,
  failureReason?: string,
  metadata?: Record<string, any>
): Promise<void> {
  await db.prepare(`
    INSERT INTO auth_events (
      user_id, event_type, session_id, device_id, device_fp, device_install_id, client_tz, client_lang,
      ip, user_agent, geo_country, geo_region, geo_city, latitude, longitude, asn, org,
      success, failure_reason, metadata_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ctx.userId ?? null,
    eventType,
    ctx.sessionId ?? null,
    ctx.deviceId ?? null,
    ctx.deviceFp ?? null,
    ctx.deviceInstallId ?? null,
    ctx.clientTz ?? null,
    ctx.clientLang ?? null,
    ctx.ip ?? null,
    ctx.userAgent ?? null,
    ctx.geoCountry ?? null,
    ctx.geoRegion ?? null,
    ctx.geoCity ?? null,
    ctx.latitude ?? null,
    ctx.longitude ?? null,
    ctx.asn ?? null,
    ctx.org ?? null,
    success ? 1 : 0,
    failureReason ?? null,
    metadata ? JSON.stringify(metadata) : null,
    Date.now()
  );
}

// ---------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------
export async function onLoginSuccess(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger[]> {
  const cfg = await getConfig(db);
  if (!cfg.enabled) return [];

  const triggers: RuleTrigger[] = [];
  const relatedUserIds = new Set<number>();
  const baseCtx = ctx.eventType ? ctx : { ...ctx, eventType: "LOGIN_SUCCESS" };
  const resolved = await resolveAsnOrg(
    db,
    { ip: baseCtx.ip ?? null, asn: baseCtx.asn ?? null, org: baseCtx.org ?? null },
    baseCtx.ts ?? Date.now()
  );
  const eventCtx: AuditContext = {
    ...baseCtx,
    ip: resolved.ip ?? baseCtx.ip,
    asn: resolved.asn ?? baseCtx.asn,
    org: resolved.org ?? baseCtx.org,
  };

  // Record device and observation
  if (eventCtx.deviceId && eventCtx.userId) {
    await recordDevice(db, eventCtx.deviceId, eventCtx.userId, eventCtx.ip, eventCtx.userAgent);
  }
  await recordObservation(db, eventCtx);
  await recordAuthEvent(db, "LOGIN_SUCCESS", eventCtx);

  // Run detection rules
  const multiAccount = await checkMultiAccountDevice(db, eventCtx);
  if (multiAccount) {
    const [lo, hi] = stableUserPair(multiAccount.primaryUserId, multiAccount.secondaryUserId ?? multiAccount.primaryUserId);
    const key = `MULTI_ACCOUNT_DEVICE:${eventCtx.deviceId}:${lo}:${hi}`;
    await createOrUpdateSignal(db, multiAccount, key, eventCtx);
    if (multiAccount.secondaryUserId) {
      relatedUserIds.add(multiAccount.secondaryUserId);
    }
    triggers.push(multiAccount);
  }

  const multiAccountFp = await checkMultiAccountFingerprint(db, eventCtx);
  if (multiAccountFp) {
    const [lo, hi] = stableUserPair(multiAccountFp.primaryUserId, multiAccountFp.secondaryUserId ?? multiAccountFp.primaryUserId);
    const key = `MULTI_ACCOUNT_FINGERPRINT:${eventCtx.deviceFp}:${lo}:${hi}`;
    await createOrUpdateSignal(db, multiAccountFp, key, eventCtx);
    if (multiAccountFp.secondaryUserId) {
      relatedUserIds.add(multiAccountFp.secondaryUserId);
    }
    triggers.push(multiAccountFp);
  }

  const ipChurn = await checkIpChurn(db, eventCtx);
  if (ipChurn) {
    const key = `IP_CHURN:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, ipChurn, key, eventCtx);
    triggers.push(ipChurn);
  }

  const uaChurn = await checkUaChurn(db, eventCtx);
  if (uaChurn) {
    const key = `UA_CHURN:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, uaChurn, key, eventCtx);
    triggers.push(uaChurn);
  }

  const deviceChurn = await checkDeviceChurn(db, eventCtx);
  if (deviceChurn) {
    const key = `DEVICE_CHURN:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, deviceChurn, key, eventCtx);
    triggers.push(deviceChurn);
  }

  const geoVelocity = await checkGeoVelocity(db, eventCtx);
  if (geoVelocity) {
    const key = `GEO_VELOCITY:${eventCtx.userId}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, geoVelocity, key, eventCtx);
    triggers.push(geoVelocity);
  }

  const concurrent = await checkConcurrentSessions(db, eventCtx);
  if (concurrent) {
    const key = `CONCURRENT_SESSIONS:${eventCtx.userId}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, concurrent, key, eventCtx);
    triggers.push(concurrent);
  }

  const asnVol = await checkAsnVolatility(db, eventCtx);
  if (asnVol) {
    const key = `ASN_VOLATILITY:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, asnVol, key, eventCtx);
    triggers.push(asnVol);
  }

  const ipAsnCluster = await checkSharedIpAsnCluster(db, eventCtx);
  if (ipAsnCluster) {
    const key = `SHARED_IPASN_CLUSTER:${eventCtx.userId}:${eventCtx.ip}:${eventCtx.asn}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, ipAsnCluster, key, eventCtx);
    if (ipAsnCluster.secondaryUserId) {
      relatedUserIds.add(ipAsnCluster.secondaryUserId);
    }
    triggers.push(ipAsnCluster);
  }

  // Update user risk score and aggregates
  if (eventCtx.userId) {
    await evaluateUserRisk(db, eventCtx.userId);
  }
  for (const relatedUserId of relatedUserIds) {
    await evaluateUserRisk(db, relatedUserId);
  }

  return triggers;
}

// Session/behavioral telemetry hook (ping + sensitive actions that should refresh risk)
export async function onSessionActivity(db: GriftDb, ctx: AuditContext): Promise<RuleTrigger[]> {
  const cfg = await getConfig(db);
  if (!cfg.enabled) return [];

  const triggers: RuleTrigger[] = [];
  const relatedUserIds = new Set<number>();
  const baseCtx = ctx.eventType ? ctx : { ...ctx, eventType: "SESSION_PING" };
  const resolved = await resolveAsnOrg(
    db,
    { ip: baseCtx.ip ?? null, asn: baseCtx.asn ?? null, org: baseCtx.org ?? null },
    baseCtx.ts ?? Date.now()
  );
  const eventCtx: AuditContext = {
    ...baseCtx,
    ip: resolved.ip ?? baseCtx.ip,
    asn: resolved.asn ?? baseCtx.asn,
    org: resolved.org ?? baseCtx.org,
  };

  // Record device and observation (identity links are recorded from observations)
  if (eventCtx.deviceId && eventCtx.userId) {
    await recordDevice(db, eventCtx.deviceId, eventCtx.userId, eventCtx.ip, eventCtx.userAgent);
  }
  await recordObservation(db, eventCtx);

  // Run session-related detection rules (same set as login, minus auth-event logging)
  const multiAccount = await checkMultiAccountDevice(db, eventCtx);
  if (multiAccount) {
    const [lo, hi] = stableUserPair(multiAccount.primaryUserId, multiAccount.secondaryUserId ?? multiAccount.primaryUserId);
    const key = `MULTI_ACCOUNT_DEVICE:${eventCtx.deviceId}:${lo}:${hi}`;
    await createOrUpdateSignal(db, multiAccount, key, eventCtx);
    if (multiAccount.secondaryUserId) {
      relatedUserIds.add(multiAccount.secondaryUserId);
    }
    triggers.push(multiAccount);
  }

  const multiAccountFp = await checkMultiAccountFingerprint(db, eventCtx);
  if (multiAccountFp) {
    const [lo, hi] = stableUserPair(multiAccountFp.primaryUserId, multiAccountFp.secondaryUserId ?? multiAccountFp.primaryUserId);
    const key = `MULTI_ACCOUNT_FINGERPRINT:${eventCtx.deviceFp}:${lo}:${hi}`;
    await createOrUpdateSignal(db, multiAccountFp, key, eventCtx);
    if (multiAccountFp.secondaryUserId) {
      relatedUserIds.add(multiAccountFp.secondaryUserId);
    }
    triggers.push(multiAccountFp);
  }

  const geoVelocity = await checkGeoVelocity(db, eventCtx);
  if (geoVelocity) {
    const key = `GEO_VELOCITY:${eventCtx.userId}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, geoVelocity, key, eventCtx);
    triggers.push(geoVelocity);
  }

  const concurrent = await checkConcurrentSessions(db, eventCtx);
  if (concurrent) {
    const key = `CONCURRENT_SESSIONS:${eventCtx.userId}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, concurrent, key, eventCtx);
    triggers.push(concurrent);
  }

  const ipChurn = await checkIpChurn(db, eventCtx);
  if (ipChurn) {
    const key = `IP_CHURN:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, ipChurn, key, eventCtx);
    triggers.push(ipChurn);
  }

  const uaChurn = await checkUaChurn(db, eventCtx);
  if (uaChurn) {
    const key = `UA_CHURN:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, uaChurn, key, eventCtx);
    triggers.push(uaChurn);
  }

  const deviceChurn = await checkDeviceChurn(db, eventCtx);
  if (deviceChurn) {
    const key = `DEVICE_CHURN:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, deviceChurn, key, eventCtx);
    triggers.push(deviceChurn);
  }

  const asnVol = await checkAsnVolatility(db, eventCtx);
  if (asnVol) {
    const key = `ASN_VOLATILITY:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, asnVol, key, eventCtx);
    triggers.push(asnVol);
  }

  const ipAsnCluster = await checkSharedIpAsnCluster(db, eventCtx);
  if (ipAsnCluster) {
    const key = `SHARED_IPASN_CLUSTER:${eventCtx.userId}:${eventCtx.ip}:${eventCtx.asn}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, ipAsnCluster, key, eventCtx);
    if (ipAsnCluster.secondaryUserId) {
      relatedUserIds.add(ipAsnCluster.secondaryUserId);
    }
    triggers.push(ipAsnCluster);
  }

  // Update user risk score and aggregates
  if (eventCtx.userId) {
    await evaluateUserRisk(db, eventCtx.userId);
  }
  for (const relatedUserId of relatedUserIds) {
    await evaluateUserRisk(db, relatedUserId);
  }

  return triggers;
}

export async function onTradeSubmit(
  db: GriftDb,
  tradeId: number,
  symbol: string,
  direction: string,
  lots: number,
  ctx: AuditContext
): Promise<RuleTrigger[]> {
  const cfg = await getConfig(db);
  if (!cfg.enabled) return [];

  const triggers: RuleTrigger[] = [];
  const relatedUserIds = new Set<number>();
  const baseCtx = ctx.eventType ? ctx : { ...ctx, eventType: "TRADE_SUBMIT" };
  const resolved = await resolveAsnOrg(
    db,
    { ip: baseCtx.ip ?? null, asn: baseCtx.asn ?? null, org: baseCtx.org ?? null },
    baseCtx.ts ?? Date.now()
  );
  const eventCtx: AuditContext = {
    ...baseCtx,
    ip: resolved.ip ?? baseCtx.ip,
    asn: resolved.asn ?? baseCtx.asn,
    org: resolved.org ?? baseCtx.org,
  };

  // Record trade observation
  await recordTradeObservation(db, tradeId, symbol, direction, lots, eventCtx);
  await recordObservation(db, eventCtx);
  if (eventCtx.deviceId && eventCtx.userId) {
    await recordDevice(db, eventCtx.deviceId, eventCtx.userId, eventCtx.ip, eventCtx.userAgent);
  }

  // Ensure linked-account graph is established even if users haven't logged in since deployment.
  const multiAccount = await checkMultiAccountDevice(db, eventCtx);
  if (multiAccount) {
    const [lo, hi] = stableUserPair(multiAccount.primaryUserId, multiAccount.secondaryUserId ?? multiAccount.primaryUserId);
    const key = `MULTI_ACCOUNT_DEVICE:${eventCtx.deviceId}:${lo}:${hi}`;
    await createOrUpdateSignal(db, multiAccount, key, eventCtx);
    if (multiAccount.secondaryUserId) {
      relatedUserIds.add(multiAccount.secondaryUserId);
    }
    triggers.push(multiAccount);
  }

  const multiAccountFp = await checkMultiAccountFingerprint(db, eventCtx);
  if (multiAccountFp) {
    const [lo, hi] = stableUserPair(multiAccountFp.primaryUserId, multiAccountFp.secondaryUserId ?? multiAccountFp.primaryUserId);
    const key = `MULTI_ACCOUNT_FINGERPRINT:${eventCtx.deviceFp}:${lo}:${hi}`;
    await createOrUpdateSignal(db, multiAccountFp, key, eventCtx);
    if (multiAccountFp.secondaryUserId) {
      relatedUserIds.add(multiAccountFp.secondaryUserId);
    }
    triggers.push(multiAccountFp);
  }

  const ipAsnCluster = await checkSharedIpAsnCluster(db, eventCtx);
  if (ipAsnCluster) {
    const key = `SHARED_IPASN_CLUSTER:${eventCtx.userId}:${eventCtx.ip}:${eventCtx.asn}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, ipAsnCluster, key, eventCtx);
    if (ipAsnCluster.secondaryUserId) {
      relatedUserIds.add(ipAsnCluster.secondaryUserId);
    }
    triggers.push(ipAsnCluster);
  }

  // Check for coordinated hedging
  const hedge = await checkHedgePair(db, tradeId, symbol, direction, eventCtx);
  if (hedge) {
    const [lo, hi] = stableUserPair(hedge.primaryUserId, hedge.secondaryUserId ?? hedge.primaryUserId);
    const key = `HEDGE_PAIR:${symbol}:${lo}:${hi}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, hedge, key, eventCtx, { symbol, tradeId });
    if (hedge.secondaryUserId) {
      relatedUserIds.add(hedge.secondaryUserId);
    }
    triggers.push(hedge);
  }

  // Check for multi-account laddering pattern
  const laddering = await checkMultiAccountLaddering(db, tradeId, symbol, direction, eventCtx);
  if (laddering) {
    const key = `MULTI_ACCOUNT_LADDERING:${symbol}:${eventCtx.userId}:${Math.floor(Date.now() / (24 * 60 * 60 * 1000))}`;
    await createOrUpdateSignal(db, laddering, key, eventCtx, { symbol, tradeId });
    if (laddering.secondaryUserId) {
      relatedUserIds.add(laddering.secondaryUserId);
    }
    triggers.push(laddering);
  }

  // Update user risk and aggregates
  if (eventCtx.userId) {
    await evaluateUserRisk(db, eventCtx.userId);
  }
  for (const relatedUserId of relatedUserIds) {
    await evaluateUserRisk(db, relatedUserId);
  }

  return triggers;
}

// ---------------------------------------------------------------------
// Recompute User Aggregates - Full risk score calculation
// ---------------------------------------------------------------------
export interface UserAggregates {
  scoreCurrent: number;
  score7d: number;
  score30d: number;
  devices7d: number;
  ips7d: number;
  userAgents7d: number;
  countries7d: number;
  asns7d: number;
  linkedAccounts30d: number;
  hedgePairs7d: number;
  openSignalsCount: number;
  tier: string;
}

export async function recomputeUserAggregates(db: GriftDb, userId: number): Promise<UserAggregates> {
  const cfg = await getConfig(db);
  const now = Date.now();
  const d7 = now - 7 * 24 * 60 * 60 * 1000;
  const d30 = now - 30 * 24 * 60 * 60 * 1000;

  // Calculate score_current from sum of points on OPEN signals only
  const openSignals = await db.prepare(`
    SELECT
      points, created_at, rule_code,
      user_id, related_user_id,
      device_id, device_fp,
      symbol,
      dedupe_key
    FROM grift_signals
    WHERE (user_id = ? OR related_user_id = ?) AND status = 'OPEN'
  `).all(userId, userId) as {
    points: number;
    created_at: number;
    rule_code: string;
    user_id: number;
    related_user_id: number | null;
    device_id: string | null;
    device_fp: string | null;
    symbol: string | null;
    dedupe_key: string;
  }[];

  let scoreCurrent = 0;
  let score7d = 0;
  let score30d = 0;
  let hedgePairs7d = 0;

  const dedupedSignals = new Map<
    string,
    { points: number; created_at: number; rule_code: string }
  >();

  for (const s of openSignals) {
    let groupKey = s.dedupe_key;

    // De-dupe historical symmetric signals that may exist from older dedupe keys.
    // Keep the highest-points signal per group.
    if (s.rule_code === "MULTI_ACCOUNT_DEVICE" && s.related_user_id != null && s.device_id) {
      const [lo, hi] = stableUserPair(s.user_id, s.related_user_id);
      groupKey = `MULTI_ACCOUNT_DEVICE:${s.device_id}:${lo}:${hi}`;
    } else if (s.rule_code === "MULTI_ACCOUNT_FINGERPRINT" && s.related_user_id != null && s.device_fp) {
      const [lo, hi] = stableUserPair(s.user_id, s.related_user_id);
      groupKey = `MULTI_ACCOUNT_FINGERPRINT:${s.device_fp}:${lo}:${hi}`;
    } else if (s.rule_code === "HEDGE_PAIR" && s.related_user_id != null && s.symbol) {
      const [lo, hi] = stableUserPair(s.user_id, s.related_user_id);
      const hourBucket = Math.floor(s.created_at / (60 * 60 * 1000));
      groupKey = `HEDGE_PAIR:${s.symbol}:${hourBucket}:${lo}:${hi}`;
    }

    const existing = dedupedSignals.get(groupKey);
    if (!existing || s.points > existing.points || (s.points === existing.points && s.created_at > existing.created_at)) {
      dedupedSignals.set(groupKey, {
        points: s.points,
        created_at: s.created_at,
        rule_code: s.rule_code,
      });
    }
  }

  for (const s of dedupedSignals.values()) {
    scoreCurrent += s.points;
    if (s.created_at >= d7) {
      score7d += s.points;
      if (s.rule_code === "HEDGE_PAIR") {
        hedgePairs7d++;
      }
    }
    if (s.created_at >= d30) {
      score30d += s.points;
    }
  }

  // Count distinct device_ids from observations last 7 days
  const devices7dResult = await db.prepare(`
    SELECT COUNT(DISTINCT device_id) as cnt FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND device_id IS NOT NULL
  `).get(userId, d7) as { cnt: number } | undefined;
  const devices7d = devices7dResult?.cnt ?? 0;

  // Count distinct ips from observations last 7 days
  const ips7dResult = await db.prepare(`
    SELECT COUNT(DISTINCT ip) as cnt FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND ip IS NOT NULL
  `).get(userId, d7) as { cnt: number } | undefined;
  const ips7d = ips7dResult?.cnt ?? 0;

  // Count distinct user_agents from observations last 7 days
  const userAgents7dResult = await db.prepare(`
    SELECT COUNT(DISTINCT user_agent) as cnt FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND user_agent IS NOT NULL
  `).get(userId, d7) as { cnt: number } | undefined;
  const userAgents7d = userAgents7dResult?.cnt ?? 0;

  // Count distinct geo_country from observations last 7 days
  const countries7dResult = await db.prepare(`
    SELECT COUNT(DISTINCT geo_country) as cnt FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND geo_country IS NOT NULL
  `).get(userId, d7) as { cnt: number } | undefined;
  const countries7d = countries7dResult?.cnt ?? 0;

  // Count distinct asn from observations last 7 days
  const asns7dResult = await db.prepare(`
    SELECT COUNT(DISTINCT asn) as cnt FROM grift_observations
    WHERE user_id = ? AND observed_at >= ? AND asn IS NOT NULL
  `).get(userId, d7) as { cnt: number } | undefined;
  const asns7d = asns7dResult?.cnt ?? 0;

  // Count linked_accounts_30d from grift_linked_account_edges last 30 days
  const linkedAccounts30dResult = await db.prepare(`
    SELECT COUNT(DISTINCT CASE WHEN user_a = ? THEN user_b ELSE user_a END) as cnt
    FROM grift_linked_account_edges
    WHERE (user_a = ? OR user_b = ?) AND last_confirmed_at >= ?
  `).get(userId, userId, userId, d30) as { cnt: number } | undefined;
  const linkedAccounts30d = linkedAccounts30dResult?.cnt ?? 0;

  const openSignalsCount = dedupedSignals.size;

  // Check for MFA/KYC status for mitigations
  let mfaMitigation = 0;
  let kycMitigation = 0;

  try {
    const mfa = await db.prepare(`SELECT enabled FROM user_mfa WHERE user_id = ?`).get(userId) as { enabled: number } | undefined;
    if (mfa?.enabled) {
      mfaMitigation = cfg.mitigationMfa ?? 10;
    }

    const kyc = await db.prepare(`SELECT status FROM user_kyc_profiles WHERE user_id = ?`).get(userId) as { status: string } | undefined;
    if (kyc?.status === "APPROVED") {
      kycMitigation = cfg.mitigationKycApproved ?? 15;
    }
  } catch (e) {
    // Tables may not exist yet
  }

  // Apply mitigations to current score
  const adjustedScoreCurrent = Math.max(0, scoreCurrent - mfaMitigation - kycMitigation);

  // Determine tier based on score_current vs thresholds
  let tier: string;
  if (adjustedScoreCurrent >= cfg.tierCritical) tier = "CRITICAL";
  else if (adjustedScoreCurrent >= cfg.tierHigh) tier = "HIGH";
  else if (adjustedScoreCurrent >= cfg.tierMed) tier = "MED";
  else tier = "LOW";

  // Upsert into grift_user_scores table
  await db.prepare(`
    INSERT INTO grift_user_scores (
      user_id, score_current, score_7d, score_30d, tier, 
      devices_7d, ips_7d, user_agents_7d, countries_7d, asns_7d,
      linked_accounts_30d, hedge_pairs_7d, open_signals_count, last_evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      score_current = ?,
      score_7d = ?,
      score_30d = ?,
      tier = ?,
      devices_7d = ?,
      ips_7d = ?,
      user_agents_7d = ?,
      countries_7d = ?,
      asns_7d = ?,
      linked_accounts_30d = ?,
      hedge_pairs_7d = ?,
      open_signals_count = ?,
      last_evaluated_at = ?
  `).run(
    userId, adjustedScoreCurrent, score7d, score30d, tier,
    devices7d, ips7d, userAgents7d, countries7d, asns7d,
    linkedAccounts30d, hedgePairs7d, openSignalsCount, now,
    adjustedScoreCurrent, score7d, score30d, tier,
    devices7d, ips7d, userAgents7d, countries7d, asns7d,
    linkedAccounts30d, hedgePairs7d, openSignalsCount, now
  );

  return {
    scoreCurrent: adjustedScoreCurrent,
    score7d,
    score30d,
    devices7d,
    ips7d,
    userAgents7d,
    countries7d,
    asns7d,
    linkedAccounts30d,
    hedgePairs7d,
    openSignalsCount,
    tier,
  };
}

// ---------------------------------------------------------------------
// Risk score calculation with MFA/KYC mitigations
// ---------------------------------------------------------------------
export async function evaluateUserRisk(db: GriftDb, userId: number): Promise<{ tier: string; totalScore: number }> {
  // Delegate to recomputeUserAggregates for full aggregate calculation
  const aggregates = await recomputeUserAggregates(db, userId);
  return { tier: aggregates.tier, totalScore: aggregates.scoreCurrent };
}

// ---------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------
export async function getSignals(
  db: GriftDb,
  filters?: { status?: string; ruleCode?: string; userId?: number; severity?: string; limit?: number }
) {
  let sql = "SELECT * FROM grift_signals WHERE 1=1";
  const params: any[] = [];

  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.ruleCode) {
    sql += " AND rule_code = ?";
    params.push(filters.ruleCode);
  }
  if (filters?.userId) {
    sql += " AND (user_id = ? OR related_user_id = ?)";
    params.push(filters.userId, filters.userId);
  }
  if (filters?.severity) {
    sql += " AND severity = ?";
    params.push(filters.severity);
  }

  sql += " ORDER BY created_at DESC";

  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  return await db.prepare(sql).all(...params);
}

export async function getUserScore(db: GriftDb, userId: number) {
  return await db.prepare(`SELECT * FROM grift_user_scores WHERE user_id = ?`).get(userId);
}

export async function getLinkedAccounts(db: GriftDb, userId: number) {
  return await db.prepare(`
    SELECT * FROM grift_linked_account_edges
    WHERE user_a = ? OR user_b = ?
    ORDER BY last_confirmed_at DESC
  `).all(userId, userId);
}

export async function getFlaggedUsers(db: GriftDb, minTier: string = "MED") {
  const tiers = ["LOW", "MED", "HIGH", "CRITICAL"];
  const minIdx = tiers.indexOf(minTier);
  const validTiers = tiers.slice(minIdx);

  const placeholders = validTiers.map(() => "?").join(",");
  return await db.prepare(`
    SELECT * FROM grift_user_scores
    WHERE tier IN (${placeholders})
    ORDER BY score_current DESC
  `).all(...validTiers);
}

export async function getTierCounts(db: GriftDb) {
  const rows = await db.prepare(`
    SELECT tier, COUNT(*) as count FROM grift_user_scores GROUP BY tier
  `).all() as { tier: string; count: number }[];

  const counts: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0, CRITICAL: 0 };
  for (const r of rows) {
    const key = r.tier === "MEDIUM" ? "MED" : r.tier;
    if (key in counts) {
      counts[key] = r.count;
    }
  }
  return counts;
}

export async function getNetworks(db: GriftDb) {
  // Find all linked account clusters using DFS
  const edges = await db.prepare(`
    SELECT user_a, user_b, link_type, confidence FROM grift_linked_account_edges
  `).all() as { user_a: number; user_b: number; link_type: string; confidence: number }[];

  const adjacency = new Map<number, Set<number>>();
  for (const e of edges) {
    if (!adjacency.has(e.user_a)) adjacency.set(e.user_a, new Set());
    if (!adjacency.has(e.user_b)) adjacency.set(e.user_b, new Set());
    adjacency.get(e.user_a)!.add(e.user_b);
    adjacency.get(e.user_b)!.add(e.user_a);
  }

  const visited = new Set<number>();
  const clusters: number[][] = [];

  for (const userId of Array.from(adjacency.keys())) {
    if (visited.has(userId)) continue;

    const cluster: number[] = [];
    const stack = [userId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);

      const neighbors = adjacency.get(current) ?? new Set();
      for (const neighbor of Array.from(neighbors)) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  return clusters.map((c, idx) => ({
    clusterId: idx + 1,
    userIds: c,
    size: c.length,
  }));
}
