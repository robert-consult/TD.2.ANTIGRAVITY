// server/grift/griftTypes.ts
export type GriftSeverity = "LOW" | "MED" | "HIGH" | "CRITICAL";
export type GriftSignalStatus = "OPEN" | "IN_REVIEW" | "CLOSED" | "IGNORED";

export type GriftRuleCode =
  | "MULTI_ACCOUNT_DEVICE"
  | "MULTI_ACCOUNT_FINGERPRINT"
  | "HEDGE_PAIR"
  | "IP_CHURN"
  | "UA_CHURN"
  | "DEVICE_CHURN"
  | "GEO_VELOCITY"
  | "CONCURRENT_SESSIONS"
  | "ASN_VOLATILITY"
  | "SHARED_IPASN_CLUSTER"
  | "MULTI_ACCOUNT_LADDERING"
  | "SHARED_DEVICE"
  | "IMPOSSIBLE_TRAVEL"
  | "UA_CHANGE_IN_SESSION"
  | "COORDINATED_HEDGE"
  | "ACCOUNT_FROZEN"
  | "ACCOUNT_DISABLED";

export type GriftConfig = {
  id: number; // always 1
  enabled: number; // 1/0

  // windows
  multiAccountWindowDays: number; // default 30
  churnWindowHours: number;       // default 24
  hedgeWindowMinutes: number;     // default 10
  concurrentWindowMinutes: number; // default 15

  // churn thresholds
  ipUniqueThreshold: number;      // default 4
  uaUniqueThreshold: number;      // default 3
  deviceUniqueThreshold: number;  // default 3
  asnUniqueThreshold: number;     // default 3

  // geo velocity
  geoVelocityKmhThreshold: number;    // default 900
  geoVelocityMinDistanceKm: number;   // default 800
  geoVelocityMaxHours: number;        // default 6

  // hedging linkage controls
  hedgeRequireDeviceMatch: number; // default 1
  hedgeAllowIpMatch: number;       // default 1

  // scoring weights
  scoreMultiAccountDevice: number; // default 35
  scoreMultiAccountFingerprint: number; // default 25
  scoreHedgePair: number;          // default 55
  scoreIpChurn: number;            // default 20
  scoreUaChurn: number;            // default 15
  scoreDeviceChurn: number;        // default 20
  scoreGeoVelocity: number;        // default 30
  scoreConcurrentSessions: number; // default 25
  scoreAsnVolatility: number;      // default 15
  scoreSharedIpAsnCluster: number; // default 40
  scoreMultiAccountLaddering: number; // default 50

  // clustering thresholds
  clusterMinUsersForIpAsn: number; // default 3 - min users sharing IP+ASN to form cluster
  ladderingWindowDays: number;     // default 7 - window for detecting laddering pattern
  ladderingMinSequence: number;    // default 3 - min consecutive trades to trigger

  // tiers (score cutoffs)
  tierMed: number;      // default 40
  tierHigh: number;     // default 60
  tierCritical: number; // default 80

  // MFA/KYC risk mitigations (points subtracted from score)
  mitigationMfa: number;         // default 10 - points deducted if user has MFA enabled
  mitigationKycApproved: number; // default 15 - points deducted if user has approved KYC

  // Enforcement thresholds
  enforcementFreezeThreshold: number;   // default 80 - score at which to freeze account
  enforcementDisableThreshold: number;  // default 100 - score at which to disable account
  enforcementAutoFreeze: number;        // default 0 (disabled) - 1 to auto-freeze at threshold
  enforcementAutoDisable: number;       // default 0 (disabled) - 1 to auto-disable at threshold

  // retention (raw telemetry)
  retentionObservationsDays: number;        // default 180 - grift_observations retention
  retentionTradeObservationsDays: number;   // default 180 - grift_trade_observations retention
  retentionAuthEventsDays: number;          // default 180 - auth_events retention
  retentionIpAsnCacheDays: number;          // default 365 - grift_ip_asn_cache retention

  updatedAt: number;
  updatedByAdminId?: number | null;
};

export type EnforcementAction = "FREEZE" | "UNFREEZE" | "DISABLE" | "ENABLE" | "WARN" | "RESTRICT_TRADING" | "RESTRICT_WITHDRAWAL";
export type EnforcementStatus = "NONE" | "FROZEN" | "DISABLED" | "RESTRICTED";

export type AuditContext = {
  ts: number;
  userId?: number;
  sessionId?: string;
  deviceId?: string;
  deviceIdLegacy?: string;
  deviceFp?: string;
  deviceInstallId?: string;
  clientTz?: string;
  clientLang?: string;
  eventType?: string;
  ip?: string;
  userAgent?: string;
  // enrichment
  geoCountry?: string;
  geoRegion?: string;
  geoCity?: string;
  geoAccuracyKm?: number;
  latitude?: number;
  longitude?: number;
  asn?: number;
  org?: string;
};

export type RuleTrigger = {
  ruleCode: GriftRuleCode;
  severity: GriftSeverity;
  primaryUserId: number;
  secondaryUserId?: number;
  points: number;
  evidence: Record<string, any>;
};
