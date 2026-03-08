import { pgTable, text, integer, real, primaryKey, serial, boolean, bigint, index, uniqueIndex, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

const nowUnix = sql`(extract(epoch from now()))`;
const nowUnixMs = sql`(extract(epoch from now()) * 1000)`;


// Identity links: many-to-many between users and identity keys (device, IP, fingerprint)
export const griftIdentityLinks = pgTable("grift_identity_links", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  linkType: text("link_type").notNull(), // device_install_id | device_fp | device_id | ip | ip_subnet
  linkValue: text("link_value").notNull(),
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  metadataJson: text("metadata_json"),
}, (t) => ({
  idxUser: index("idx_grift_identity_user").on(t.userId),
  idxTypeValue: index("idx_grift_identity_type_value").on(t.linkType, t.linkValue),
  uniqueUserLink: uniqueIndex("idx_grift_identity_unique").on(t.userId, t.linkType, t.linkValue),
}));

// Alerts for admin review
export const griftAlerts = pgTable("grift_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ruleType: text("rule_type").notNull(), // SHARED_DEVICE | SHARED_DEVICE_FP | etc.
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  score: integer("score").notNull().default(0),
  status: text("status").notNull().default("open"), // open | resolved | dismissed | in_review
  detailsJson: text("details_json"),
  relatedUserId: integer("related_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
  reviewedAt: bigint("reviewed_at", { mode: "number" }),
  reviewedBy: integer("reviewed_by"),
  resolutionNote: text("resolution_note"),
});

// Cached/aggregated risk score per user
export const griftUserRisk = pgTable("grift_user_risk", {
  userId: integer("user_id").primaryKey(),
  riskScore: integer("risk_score").notNull().default(0),
  riskFactorsJson: text("risk_factors_json"),
  lastEvaluatedAt: bigint("last_evaluated_at", { mode: "number" }).notNull().default(nowUnixMs),
  manualOverride: text("manual_override"),
  overrideBy: integer("override_by"),
  overrideAt: bigint("override_at", { mode: "number" }),
  overrideReason: text("override_reason"),
  enforcementStatus: text("enforcement_status").default("ACTIVE"),
  enforcementAt: bigint("enforcement_at", { mode: "number" }),
  enforcementBy: integer("enforcement_by"),
  enforcementReason: text("enforcement_reason"),
});

// Linked account edges (graph representation)
export const griftLinkedAccountEdges = pgTable(
  "grift_linked_account_edges",
  {
    id: serial("id").primaryKey(),
    userA: integer("user_a").notNull(),
    userB: integer("user_b").notNull(),
    linkType: text("link_type").notNull(), // SHARED_DEVICE | SHARED_IP | etc.
    linkValue: text("link_value"),
    confidence: real("confidence").notNull().default(1.0),
    firstLinkedAt: bigint("first_linked_at", { mode: "number" }).notNull().default(nowUnixMs),
    lastConfirmedAt: bigint("last_confirmed_at", { mode: "number" }).notNull().default(nowUnixMs),
    metadataJson: text("metadata_json"),
  },
  (t) => ({
    uniqueEdge: uniqueIndex("idx_grift_linked_account_edges_unique").on(t.userA, t.userB, t.linkType, t.linkValue),
    idxUserALastConfirmed: index("idx_grift_linked_account_edges_user_a_last_confirmed_at").on(t.userA, t.lastConfirmedAt),
    idxUserBLastConfirmed: index("idx_grift_linked_account_edges_user_b_last_confirmed_at").on(t.userB, t.lastConfirmedAt),
  }),
);

// Admin-editable grift detection configuration (thresholds and point values)
export const griftConfig = pgTable("grift_config", {
  id: integer("id").primaryKey().default(1),
  enabled: integer("enabled").notNull().default(1),
  multiAccountWindowDays: integer("multi_account_window_days").notNull().default(30),
  churnWindowHours: integer("churn_window_hours").notNull().default(24),
  hedgeWindowMinutes: integer("hedge_window_minutes").notNull().default(10),
  concurrentWindowMinutes: integer("concurrent_window_minutes").notNull().default(15),
  ipUniqueThreshold: integer("ip_unique_threshold").notNull().default(4),
  uaUniqueThreshold: integer("ua_unique_threshold").notNull().default(3),
  deviceUniqueThreshold: integer("device_unique_threshold").notNull().default(3),
  asnUniqueThreshold: integer("asn_unique_threshold").notNull().default(3),
  geoVelocityKmhThreshold: integer("geo_velocity_kmh_threshold").notNull().default(900),
  geoVelocityMinDistanceKm: integer("geo_velocity_min_distance_km").notNull().default(800),
  geoVelocityMaxHours: integer("geo_velocity_max_hours").notNull().default(6),
  hedgeRequireDeviceMatch: integer("hedge_require_device_match").notNull().default(1),
  hedgeAllowIpMatch: integer("hedge_allow_ip_match").notNull().default(1),
  scoreMultiAccountDevice: integer("score_multi_account_device").notNull().default(35),
  scoreHedgePair: integer("score_hedge_pair").notNull().default(55),
  scoreIpChurn: integer("score_ip_churn").notNull().default(20),
  scoreUaChurn: integer("score_ua_churn").notNull().default(15),
  scoreDeviceChurn: integer("score_device_churn").notNull().default(20),
  scoreGeoVelocity: integer("score_geo_velocity").notNull().default(30),
  scoreConcurrentSessions: integer("score_concurrent_sessions").notNull().default(25),
  scoreAsnVolatility: integer("score_asn_volatility").notNull().default(15),
  scoreSharedIpAsnCluster: integer("score_shared_ip_asn_cluster").notNull().default(40),
  scoreMultiAccountLaddering: integer("score_multi_account_laddering").notNull().default(50),
  clusterMinUsersForIpAsn: integer("cluster_min_users_for_ip_asn").notNull().default(3),
  ladderingWindowDays: integer("laddering_window_days").notNull().default(7),
  ladderingMinSequence: integer("laddering_min_sequence").notNull().default(3),
  tierMed: integer("tier_med").notNull().default(40),
  tierHigh: integer("tier_high").notNull().default(60),
  tierCritical: integer("tier_critical").notNull().default(80),
  mitigationMfa: integer("mitigation_mfa").notNull().default(10),
  mitigationKycApproved: integer("mitigation_kyc_approved").notNull().default(15),
  enforcementFreezeThreshold: integer("enforcement_freeze_threshold").notNull().default(80),
  enforcementDisableThreshold: integer("enforcement_disable_threshold").notNull().default(100),
  enforcementAutoFreeze: integer("enforcement_auto_freeze").notNull().default(0),
  enforcementAutoDisable: integer("enforcement_auto_disable").notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowUnixMs),
  updatedByAdminId: integer("updated_by_admin_id"),
});

// Device rollups (aggregate device info)
export const griftDevices = pgTable("grift_devices", {
  deviceId: text("device_id").primaryKey(),
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
  firstIp: text("first_ip"),
  firstGeoCountry: text("first_geo_country"),
  trustLevel: text("trust_level").notNull().default("NEW"), // NEW | TRUSTED | CHALLENGED | BLOCKED
  usersCount: integer("users_count").notNull().default(1),
  metadataJson: text("metadata_json"),
});

// Device-to-user link graph
export const griftDeviceUsers = pgTable(
  "grift_device_users",
  {
    id: serial("id").primaryKey(),
    deviceId: text("device_id").notNull(),
    userId: integer("user_id").notNull(),
    firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
    lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
    seenCount: integer("seen_count").notNull().default(1),
    linkStrength: real("link_strength").notNull().default(1.0),
  },
  (t) => ({
    uniqueDeviceUser: uniqueIndex("idx_grift_device_users_device_user").on(t.deviceId, t.userId),
    idxDeviceLastSeen: index("idx_grift_device_users_device_last_seen_at").on(t.deviceId, t.lastSeenAt),
  }),
);

// Open/closed signals per user (individual rule triggers)
export const griftSignals = pgTable("grift_signals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  ruleCode: text("rule_code").notNull(), // MULTI_ACCOUNT_DEVICE | IP_CHURN | etc.
  dedupeKey: text("dedupe_key"), // For preventing duplicate signals in same window
  severity: text("severity").notNull().default("MEDIUM"),
  points: integer("points").notNull().default(0),
  status: text("status").notNull().default("OPEN"), // OPEN | CLOSED
  evidenceJson: text("evidence_json"),
  relatedUserId: integer("related_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowUnixMs),
  closedAt: bigint("closed_at", { mode: "number" }),
  closedByAdminId: integer("closed_by_admin_id"),
  closureNote: text("closure_note"),
  deviceId: text("device_id"),
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  geoCountry: text("geo_country"),
  geoRegion: text("geo_region"),
  geoCity: text("geo_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  asn: bigint("asn", { mode: "number" }),
  org: text("org"),
  symbol: text("symbol"),
  tradeId: integer("trade_id"),
});

// Grift observations (request/session telemetry)
export const griftObservations = pgTable(
  "grift_observations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    eventType: text("event_type").notNull().default("SESSION_PING"),
    sessionId: text("session_id"),
    deviceId: text("device_id"),
    deviceFp: text("device_fp"),
    deviceInstallId: text("device_install_id"),
    clientTz: text("client_tz"),
    clientLang: text("client_lang"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    geoCountry: text("geo_country"),
    geoRegion: text("geo_region"),
    geoCity: text("geo_city"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    asn: bigint("asn", { mode: "number" }),
    org: text("org"),
    observedAt: bigint("observed_at", { mode: "number" }).notNull().default(nowUnixMs),
  },
  (t) => ({
    idxUserObservedAt: index("idx_grift_observations_user_observed_at").on(t.userId, t.observedAt),
    idxIpAsnObservedUser: index("idx_grift_observations_ip_asn_observed_user").on(t.ip, t.asn, t.observedAt, t.userId),
  }),
);

// Grift trade observations (trade telemetry)
export const griftTradeObservations = pgTable(
  "grift_trade_observations",
  {
    id: serial("id").primaryKey(),
    tradeId: integer("trade_id").notNull(),
    userId: integer("user_id").notNull(),
    sessionId: text("session_id"),
    deviceId: text("device_id"),
    deviceFp: text("device_fp"),
    deviceInstallId: text("device_install_id"),
    clientTz: text("client_tz"),
    clientLang: text("client_lang"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    symbol: text("symbol").notNull(),
    direction: text("direction").notNull(),
    lots: real("lots").notNull(),
    geoCountry: text("geo_country"),
    geoRegion: text("geo_region"),
    geoCity: text("geo_city"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    asn: bigint("asn", { mode: "number" }),
    org: text("org"),
    observedAt: bigint("observed_at", { mode: "number" }).notNull().default(nowUnixMs),
  },
  (t) => ({
    idxSymbolDirectionObservedAt: index("idx_grift_trade_observations_symbol_direction_observed_at").on(t.symbol, t.direction, t.observedAt),
    idxUserSymbolDirectionObservedAt: index("idx_grift_trade_observations_user_symbol_direction_observed_at").on(t.userId, t.symbol, t.direction, t.observedAt),
  }),
);

// Aggregated grift risk scores
export const griftUserScores = pgTable("grift_user_scores", {
  userId: integer("user_id").primaryKey(),
  scoreCurrent: integer("score_current").notNull().default(0),
  score7d: integer("score_7d").notNull().default(0),
  score30d: integer("score_30d").notNull().default(0),
  tier: text("tier").notNull().default("LOW"),
  devices7d: integer("devices_7d").notNull().default(0),
  ips7d: integer("ips_7d").notNull().default(0),
  userAgents7d: integer("user_agents_7d").notNull().default(0),
  countries7d: integer("countries_7d").notNull().default(0),
  asns7d: integer("asns_7d").notNull().default(0),
  linkedAccounts30d: integer("linked_accounts_30d").notNull().default(0),
  hedgePairs7d: integer("hedge_pairs_7d").notNull().default(0),
  openSignalsCount: integer("open_signals_count").notNull().default(0),
  lastEvaluatedAt: bigint("last_evaluated_at", { mode: "number" }).notNull().default(0),
});

// Grift user enforcement status (freeze/disable)
export const griftUserEnforcements = pgTable("grift_user_enforcements", {
  userId: integer("user_id").primaryKey(),
  frozenAt: bigint("frozen_at", { mode: "number" }),
  frozenByAdminId: integer("frozen_by_admin_id"),
  disabledAt: bigint("disabled_at", { mode: "number" }),
  disabledByAdminId: integer("disabled_by_admin_id"),
  notes: text("notes"),
});

// Grift cases workflow
export const griftCases = pgTable("grift_cases", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("OPEN"),
  priority: text("priority").notNull().default("MEDIUM"),
  createdByAdminId: integer("created_by_admin_id"),
  assignedAdminId: integer("assigned_admin_id"),
  resolution: text("resolution"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowUnixMs),
  closedAt: bigint("closed_at", { mode: "number" }),
});

export const griftCaseSignals = pgTable("grift_case_signals", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  signalId: integer("signal_id").notNull(),
  addedAt: bigint("added_at", { mode: "number" }).notNull().default(nowUnixMs),
});

export const griftCaseNotes = pgTable("grift_case_notes", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  adminId: integer("admin_id").notNull(),
  note: text("note").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
});

export const griftCaseLinks = pgTable("grift_case_links", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  linkType: text("link_type").notNull(),
  linkId: integer("link_id").notNull(),
  addedByAdminId: integer("added_by_admin_id"),
  addedAt: bigint("added_at", { mode: "number" }).notNull().default(nowUnixMs),
});

// Grift admin audit entries (tamper-evident)
export const griftAdminActions = pgTable("grift_admin_actions", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  payloadJson: text("payload_json"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
  prevHash: text("prev_hash"),
  eventHash: text("hash"),
});

// Grift enforcement log entries
export const griftEnforcementLog = pgTable("grift_enforcement_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  action: text("action").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  adminId: integer("admin_id"),
  reason: text("reason"),
  riskScoreAtAction: integer("risk_score_at_action"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
});

// Auth events log (append-only)
export const authEvents = pgTable("auth_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  eventType: text("event_type").notNull(),
  sessionId: text("session_id"),
  deviceId: text("device_id"),
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  geoCountry: text("geo_country"),
  geoRegion: text("geo_region"),
  geoCity: text("geo_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  asn: bigint("asn", { mode: "number" }),
  org: text("org"),
  success: integer("success").notNull().default(1),
  failureReason: text("failure_reason"),
  metadataJson: text("metadata_json"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs),
});

// Grift IP -> ASN cache
export const griftIpAsnCache = pgTable("grift_ip_asn_cache", {
  ip: text("ip").primaryKey(),
  asn: bigint("asn", { mode: "number" }),
  org: text("org"),
  source: text("source"),
  fetchedAt: bigint("fetched_at", { mode: "number" }),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull().default(nowUnixMs),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastAttemptAt: bigint("last_attempt_at", { mode: "number" }),
  error: text("error"),
  errorAt: bigint("error_at", { mode: "number" }),
  nextRetryAt: bigint("next_retry_at", { mode: "number" }),
});

// Offline ip2asn dataset ranges
export const griftIpAsnRanges = pgTable("grift_ip_asn_ranges", {
  id: serial("id").primaryKey(),
  ipVersion: integer("ip_version").notNull(),
  startInt: bigint("start_int", { mode: "number" }),
  endInt: bigint("end_int", { mode: "number" }),
  startHex: text("start_hex"),
  endHex: text("end_hex"),
  asn: bigint("asn", { mode: "number" }),
  country: text("country"),
  org: text("org"),
});

export const griftIpAsnDatasetMeta = pgTable("grift_ip_asn_dataset_meta", {
  id: integer("id").primaryKey().default(1),
  filePath: text("file_path").notNull(),
  fileMtimeMs: bigint("file_mtime_ms", { mode: "number" }).notNull(),
  fileSize: bigint("file_size", { mode: "number" }).notNull(),
  importedAt: bigint("imported_at", { mode: "number" }).notNull(),
  rowCount: bigint("row_count", { mode: "number" }).notNull(),
  ipv4Count: bigint("ipv4_count", { mode: "number" }).notNull(),
  ipv6Count: bigint("ipv6_count", { mode: "number" }).notNull(),
});

export const insertGriftIdentityLinkSchema = createInsertSchema(griftIdentityLinks);
export const insertGriftConfigSchema = createInsertSchema(griftConfig);
export const insertGriftDeviceSchema = createInsertSchema(griftDevices);
export const insertGriftDeviceUserSchema = createInsertSchema(griftDeviceUsers);
export const insertGriftSignalSchema = createInsertSchema(griftSignals);
export const insertGriftAlertSchema = createInsertSchema(griftAlerts);
export const insertGriftUserRiskSchema = createInsertSchema(griftUserRisk);
export const insertGriftLinkedAccountEdgeSchema = createInsertSchema(griftLinkedAccountEdges);
