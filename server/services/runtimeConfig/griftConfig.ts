import type { GriftDb } from "../../grift/griftDb";
import type { GriftConfig } from "../../grift/griftTypes";
import { DEFAULT_GRIFT_CONFIG } from "../../grift/griftDefaults";

export type GriftConfigSource = Record<string, unknown> | null | undefined;

export type GriftEngineCaps = {
  configTtlMs: number;
  maxLinkedEdgeWritesPerTrigger: number;
  maxEvidenceLinkedUsers: number;
  maxLinkedEdgeBatchRows: number;
};

export type EffectiveGriftConfigState = {
  policy: GriftConfig;
  source: "DB" | "DEFAULT";
  engineCaps: GriftEngineCaps;
  diagnostics: {
    configCacheTtlMs: number;
  };
};

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseBoundedPositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = parsePositiveInt(raw, fallback);
  return Math.min(max, Math.max(min, n));
}

export const GRIFT_CONFIG_TTL_MS = parseBoundedPositiveInt(process.env.GRIFT_CONFIG_TTL_MS, 15_000, 5_000, 120_000);

const ENGINE_CAPS: GriftEngineCaps = {
  configTtlMs: GRIFT_CONFIG_TTL_MS,
  maxLinkedEdgeWritesPerTrigger: parsePositiveInt(process.env.GRIFT_MAX_LINKED_EDGE_WRITES_PER_TRIGGER, 50),
  maxEvidenceLinkedUsers: parsePositiveInt(process.env.GRIFT_MAX_EVIDENCE_LINKED_USERS, 50),
  maxLinkedEdgeBatchRows: parseBoundedPositiveInt(process.env.GRIFT_MAX_LINKED_EDGE_BATCH_ROWS, 200, 10, 1000),
};

export function getGriftEngineCaps(): GriftEngineCaps {
  return { ...ENGINE_CAPS };
}

export function resolveGriftRuntimePolicy(row: GriftConfigSource): GriftConfig {
  const source = (row ?? null) as any;
  const defaults = DEFAULT_GRIFT_CONFIG;
  return {
    id: Number(source?.id ?? defaults.id),
    enabled: source?.enabled ?? defaults.enabled,
    multiAccountWindowDays: source?.multi_account_window_days ?? defaults.multiAccountWindowDays,
    churnWindowHours: source?.churn_window_hours ?? defaults.churnWindowHours,
    hedgeWindowMinutes: source?.hedge_window_minutes ?? defaults.hedgeWindowMinutes,
    concurrentWindowMinutes: source?.concurrent_window_minutes ?? defaults.concurrentWindowMinutes,
    ipUniqueThreshold: source?.ip_unique_threshold ?? defaults.ipUniqueThreshold,
    uaUniqueThreshold: source?.ua_unique_threshold ?? defaults.uaUniqueThreshold,
    deviceUniqueThreshold: source?.device_unique_threshold ?? defaults.deviceUniqueThreshold,
    asnUniqueThreshold: source?.asn_unique_threshold ?? defaults.asnUniqueThreshold,
    geoVelocityKmhThreshold: source?.geo_velocity_kmh_threshold ?? defaults.geoVelocityKmhThreshold,
    geoVelocityMinDistanceKm: source?.geo_velocity_min_distance_km ?? defaults.geoVelocityMinDistanceKm,
    geoVelocityMaxHours: source?.geo_velocity_max_hours ?? defaults.geoVelocityMaxHours,
    hedgeRequireDeviceMatch: source?.hedge_require_device_match ?? defaults.hedgeRequireDeviceMatch,
    hedgeAllowIpMatch: source?.hedge_allow_ip_match ?? defaults.hedgeAllowIpMatch,
    scoreMultiAccountDevice: source?.score_multi_account_device ?? defaults.scoreMultiAccountDevice,
    scoreMultiAccountFingerprint: source?.score_multi_account_fingerprint ?? defaults.scoreMultiAccountFingerprint,
    scoreHedgePair: source?.score_hedge_pair ?? defaults.scoreHedgePair,
    scoreIpChurn: source?.score_ip_churn ?? defaults.scoreIpChurn,
    scoreUaChurn: source?.score_ua_churn ?? defaults.scoreUaChurn,
    scoreDeviceChurn: source?.score_device_churn ?? defaults.scoreDeviceChurn,
    scoreGeoVelocity: source?.score_geo_velocity ?? defaults.scoreGeoVelocity,
    scoreConcurrentSessions: source?.score_concurrent_sessions ?? defaults.scoreConcurrentSessions,
    scoreAsnVolatility: source?.score_asn_volatility ?? defaults.scoreAsnVolatility,
    scoreSharedIpAsnCluster: source?.score_shared_ip_asn_cluster ?? defaults.scoreSharedIpAsnCluster,
    scoreMultiAccountLaddering: source?.score_multi_account_laddering ?? defaults.scoreMultiAccountLaddering,
    clusterMinUsersForIpAsn: source?.cluster_min_users_for_ip_asn ?? defaults.clusterMinUsersForIpAsn,
    ladderingWindowDays: source?.laddering_window_days ?? defaults.ladderingWindowDays,
    ladderingMinSequence: source?.laddering_min_sequence ?? defaults.ladderingMinSequence,
    tierMed: source?.tier_med ?? defaults.tierMed,
    tierHigh: source?.tier_high ?? defaults.tierHigh,
    tierCritical: source?.tier_critical ?? defaults.tierCritical,
    mitigationMfa: source?.mitigation_mfa ?? defaults.mitigationMfa,
    mitigationKycApproved: source?.mitigation_kyc_approved ?? defaults.mitigationKycApproved,
    enforcementFreezeThreshold: source?.enforcement_freeze_threshold ?? defaults.enforcementFreezeThreshold,
    enforcementDisableThreshold: source?.enforcement_disable_threshold ?? defaults.enforcementDisableThreshold,
    enforcementAutoFreeze: source?.enforcement_auto_freeze ?? defaults.enforcementAutoFreeze,
    enforcementAutoDisable: source?.enforcement_auto_disable ?? defaults.enforcementAutoDisable,
    retentionObservationsDays: source?.retention_observations_days ?? defaults.retentionObservationsDays,
    retentionTradeObservationsDays:
      source?.retention_trade_observations_days ?? defaults.retentionTradeObservationsDays,
    retentionAuthEventsDays: source?.retention_auth_events_days ?? defaults.retentionAuthEventsDays,
    retentionIpAsnCacheDays: source?.retention_ip_asn_cache_days ?? defaults.retentionIpAsnCacheDays,
    updatedAt: source?.updated_at ?? defaults.updatedAt,
    updatedByAdminId: source?.updated_by_admin_id ?? defaults.updatedByAdminId,
  };
}

export async function getGriftEffectiveConfigState(db: GriftDb): Promise<EffectiveGriftConfigState> {
  const row = (await db.prepare("SELECT * FROM grift_config WHERE id=1").get()) as GriftConfigSource;
  return {
    policy: resolveGriftRuntimePolicy(row),
    source: row ? "DB" : "DEFAULT",
    engineCaps: getGriftEngineCaps(),
    diagnostics: {
      configCacheTtlMs: GRIFT_CONFIG_TTL_MS,
    },
  };
}
