// server/grift/griftDefaults.ts
import type { GriftConfig } from "./griftTypes";

export const DEFAULT_GRIFT_CONFIG: GriftConfig = {
  id: 1,
  enabled: 1,

  multiAccountWindowDays: 30,
  churnWindowHours: 24,
  hedgeWindowMinutes: 10,
  concurrentWindowMinutes: 15,

  ipUniqueThreshold: 4,
  uaUniqueThreshold: 3,
  deviceUniqueThreshold: 3,
  asnUniqueThreshold: 3,

  geoVelocityKmhThreshold: 900,
  geoVelocityMinDistanceKm: 800,
  geoVelocityMaxHours: 6,

  hedgeRequireDeviceMatch: 1,
  hedgeAllowIpMatch: 1,

  scoreMultiAccountDevice: 35,
  scoreMultiAccountFingerprint: 25,
  scoreHedgePair: 55,
  scoreIpChurn: 20,
  scoreUaChurn: 15,
  scoreDeviceChurn: 20,
  scoreGeoVelocity: 30,
  scoreConcurrentSessions: 25,
  scoreAsnVolatility: 15,
  scoreSharedIpAsnCluster: 40,
  scoreMultiAccountLaddering: 50,

  clusterMinUsersForIpAsn: 3,
  ladderingWindowDays: 7,
  ladderingMinSequence: 3,

  tierMed: 40,
  tierHigh: 60,
  tierCritical: 80,

  // MFA/KYC risk mitigations
  mitigationMfa: 10,
  mitigationKycApproved: 15,

  // Enforcement thresholds
  enforcementFreezeThreshold: 80,
  enforcementDisableThreshold: 100,
  enforcementAutoFreeze: 0,
  enforcementAutoDisable: 0,

  // retention (raw telemetry)
  retentionObservationsDays: 180,
  retentionTradeObservationsDays: 180,
  retentionAuthEventsDays: 180,
  retentionIpAsnCacheDays: 365,

  updatedAt: Date.now(),
  updatedByAdminId: null,
};
