import { useState, type ComponentProps } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatInstantToLocaleString } from "@shared/time/format";
import {
  AlertTriangle,
  Users,
  Link2,
  Activity,
  Fingerprint,
  Shield,
  Download,
  Settings,
  FileText,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Network,
  Briefcase,
  CheckCheck,
  AlertCircle
} from "lucide-react";
import { DashboardTab } from "./grift/DashboardTab";
import { SignalsTab } from "./grift/SignalsTab";
import { ConfigTab } from "./grift/ConfigTab";

const GRIFT_REFRESH_COLOR_HEX = "#2b7f8e";
const GRIFT_REFRESH_COLOR_HOVER_HEX = "#256c79";
const GRIFT_REFRESH_BUTTON_CLASS =
  "border-[color:var(--grift-refresh)] bg-[color:var(--grift-refresh)] text-white hover:bg-[color:var(--grift-refresh-hover)] hover:border-[color:var(--grift-refresh-hover)] focus-visible:ring-2 focus-visible:ring-[color:var(--grift-refresh)]/40";

function GriftRefreshButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button
      {...props}
      variant="outline"
      size="sm"
      style={{
        ...(props.style ?? {}),
        ["--grift-refresh" as any]: GRIFT_REFRESH_COLOR_HEX,
        ["--grift-refresh-hover" as any]: GRIFT_REFRESH_COLOR_HOVER_HEX,
      }}
      className={[GRIFT_REFRESH_BUTTON_CLASS, className].filter(Boolean).join(" ")}
    />
  );
}

interface GriftOverview {
  openSignalsCount: number;
  hedgePairs7d: number;
  linkedAccounts30d: number;
  geoVelocityHits7d: number;
  concurrentSessionsHits7d: number;
  ipChurnHits7d: number;
  uaChurnHits7d: number;
  deviceChurnHits7d: number;
  tierCounts: Record<string, number>;
  topUsersByScore: Array<{
    user_id: number;
    score_current: number;
    tier: string;
    username: string;
    email: string;
  }>;
}

interface GriftSignal {
  id: number;
  rule_code: string;
  severity: string;
  user_id: number;
  related_user_id?: number;
  points: number;
  status: string;
  created_at: number;
  closed_at?: number;
  evidence_json?: string;
  username?: string;
  email?: string;
  device_id?: string | null;
  device_install_id?: string | null;
  device_fp?: string | null;
  client_tz?: string | null;
  client_lang?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  geo_country?: string | null;
  geo_region?: string | null;
  geo_city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  asn?: number | null;
  org?: string | null;
  symbol?: string | null;
  trade_id?: number | null;
}

interface FlaggedUser {
  user_id: number;
  username: string;
  email: string;
  total_score: number;
  last_7d_score: number;
  last_30d_score: number;
  tier: string;
  open_signal_count: number;
  last_evaluated_at: number;
}

interface HedgePair {
  id: number;
  userId: number;
  relatedUserId: number;
  userUsername: string;
  userEmail: string;
  relatedUsername: string;
  relatedEmail: string;
  symbol: string | null;
  evidence: Record<string, unknown>;
  createdAt: number;
  status: string;
  points: number;
  severity: string;
}

interface NetworkData {
  totalEdges: number;
  clusterCount: number;
  clusters: Array<{
    size: number;
    userIds: number[];
  }>;
}

interface IdentityLinkSummary {
  link_type: string;
  link_value: string;
  user_count: number;
  last_seen_at: number;
}

interface IdentityLinksResponse {
  links: IdentityLinkSummary[];
  minUsers: number;
  limit: number;
}

interface IdentityLinkUser {
  id: number;
  username: string | null;
  email: string | null;
  last_seen_at: number;
}

interface IdentityLinkUsersResponse {
  linkType: string;
  linkValue: string;
  users: IdentityLinkUser[];
}

interface UserIdentityLinkRow {
  link_type: string;
  link_value: string;
  first_seen_at: number;
  last_seen_at: number;
  occurrence_count: number;
  metadata_json: string | null;
  user_count: number;
}

interface UserIdentityLinksResponse {
  userId: number;
  links: UserIdentityLinkRow[];
}

interface GriftCase {
  id: number;
  title: string;
  status: string;
  priority: string;
  created_by_admin_id: number | null;
  assigned_admin_id?: number | null;
  created_at: number;
  updated_at: number;
  closed_at?: number | null;
  resolution?: string | null;
}

interface GriftConfig {
  enabled: number | boolean;
  multiAccountWindowDays: number;
  churnWindowHours: number;
  hedgeWindowMinutes: number;
  concurrentWindowMinutes: number;
  ipUniqueThreshold: number;
  uaUniqueThreshold: number;
  deviceUniqueThreshold: number;
  asnUniqueThreshold: number;
  tierMed: number;
  tierHigh: number;
  tierCritical: number;
  scoreMultiAccountDevice: number;
  scoreMultiAccountFingerprint: number;
  scoreHedgePair: number;
  scoreIpChurn: number;
  scoreUaChurn: number;
  scoreDeviceChurn: number;
  scoreGeoVelocity: number;
  scoreConcurrentSessions: number;
  geoVelocityKmhThreshold: number;
  geoVelocityMinDistanceKm: number;
  geoVelocityMaxHours: number;
  hedgeRequireDeviceMatch: number | boolean;
  hedgeAllowIpMatch: number | boolean;
  scoreAsnVolatility: number;
  scoreSharedIpAsnCluster: number;
  scoreMultiAccountLaddering: number;
  clusterMinUsersForIpAsn: number;
  ladderingWindowDays: number;
  ladderingMinSequence: number;
  mitigationMfa: number;
  mitigationKycApproved: number;
  enforcementFreezeThreshold: number;
  enforcementDisableThreshold: number;
  enforcementAutoFreeze: number | boolean;
  enforcementAutoDisable: number | boolean;
  retentionObservationsDays: number;
  retentionTradeObservationsDays: number;
  retentionAuthEventsDays: number;
  retentionIpAsnCacheDays: number;
  [key: string]: number | boolean;
}

interface AuditLogEntry {
  id: number;
  admin_id: number;
  action: string;
  target_type: string;
  target_id: number;
  details_json?: string;
  created_at: number;
  prev_hash?: string;
  hash?: string;
}

interface KycQueueItem {
  userId: number;
  email: string;
  username: string;
  status: string;
  invitedAt: number | null;
  submittedAt: number | null;
  documentType: string | null;
  invitedByAdminId: number | null;
  inviteNote: string | null;
}

interface AuditVerifyResult {
  valid: boolean;
  totalEntries: number;
  brokenAt?: number;
  message?: string;
}

interface DbFileStat {
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number | null;
}

interface DbMaintenanceStats {
  engine?: "postgres";
  database?: {
    name: string;
    sizeBytes: number;
    sizePretty: string;
    stats: Record<string, number | string> | null;
  };
  generatedAt: number;
}

function getTierColor(tier: string) {
  switch (tier?.toUpperCase()) {
    case "CRITICAL": return "bg-red-600 text-white";
    case "HIGH": return "bg-orange-500 text-white";
    case "MED": case "MEDIUM": return "bg-amber-500 text-black";
    case "LOW": return "bg-green-600 text-white";
    default: return "bg-gray-500 text-white";
  }
}

function getSeverityColor(severity: string) {
  switch (severity?.toUpperCase()) {
    case "CRITICAL": return "bg-red-600";
    case "HIGH": return "bg-orange-500";
    case "MEDIUM": case "MED": return "bg-amber-500";
    case "LOW": return "bg-green-600";
    default: return "bg-gray-500";
  }
}

function getStatusColor(status: string) {
  switch (status?.toUpperCase()) {
    case "OPEN": return "bg-blue-500";
    case "CLOSED": return "bg-green-600";
    case "IGNORED": return "bg-gray-500";
    case "IN_REVIEW": return "bg-amber-500";
    default: return "bg-gray-500";
  }
}

function formatTimestamp(ts: string | number | Date | null | undefined) {
  return formatInstantToLocaleString(ts, { fallback: "N/A" });
}

function formatBytes(bytes: number) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : idx === 1 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[idx]}`;
}

function parseJson(raw?: string) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const GRIFT_FIELD_HELP = {
  overview: {
    inline: "Investigate suspicious account behavior, linked identities, and enforcement posture across dedicated analysis subtabs.",
    tooltip:
      "Grift Detection spans monitoring, forensics, and enforcement. Use subtab-specific controls deliberately and preserve audit context for high-impact actions.",
  },
  dashboard: {
    inline: "Risk overview with score distributions and top flagged users.",
    tooltip:
      "Dashboard aggregates recent detection outputs for triage. Use this as a starting point before drilling into signals or identities.",
  },
  signals: {
    inline: "Review individual detection events and close validated items.",
    tooltip:
      "Signals contain granular evidence payloads and state transitions. Close only after investigation confirms disposition.",
  },
  flaggedUsers: {
    inline: "User-level risk scoring summary across windows and open-signal counts.",
    tooltip:
      "Flagged users table prioritizes accounts for deeper review. Combine with Signals and Identities for attribution confidence.",
  },
  pairs: {
    inline: "Potential coordinated hedge relationships between user pairs.",
    tooltip:
      "Pair detections indicate correlated behavior but are not final proof. Validate with identity/network context before enforcement.",
  },
  networks: {
    inline: "Linked account graph and cluster summaries.",
    tooltip:
      "Network clusters show shared infrastructure relationships. Use for escalation and case grouping decisions.",
  },
  identities: {
    inline: "Device/IP/fingerprint correlation explorer with drill-down by linked users.",
    tooltip:
      "Identity links expose shared technical artifacts across accounts. Tune filters to reduce noise and isolate strong linkage.",
  },
  cases: {
    inline: "Case inventory for investigation workflow and case-state visibility.",
    tooltip:
      "Cases track investigation lifecycle metadata. Use alongside signals and audit logs for decision traceability.",
  },
  exports: {
    inline: "Download detection datasets for offline analysis and reporting.",
    tooltip:
      "Exports include potentially sensitive data. Confirm destination handling policy before downloading.",
  },
  config: {
    inline: "Tune detection behavior, scoring, enforcement, retention, and maintenance operations.",
    tooltip:
      "Configuration changes affect live risk posture. Apply changes in controlled increments and verify downstream signal behavior.",
  },
  audit: {
    inline: "Tamper-evident audit chain verification and administrative action history.",
    tooltip:
      "Audit tab validates hash-chain integrity and preserves admin operation traceability.",
  },
  refresh: {
    inline: "Reload latest data for the active investigative surface.",
    tooltip:
      "Refresh pulls current backend state for this panel. Use after actions or when validating a suspected stale snapshot.",
  },
  signalsStatusFilter: {
    inline: "Filter signals by lifecycle state.",
    tooltip:
      "Use status filter to isolate unresolved items (OPEN/IN_REVIEW) or validate closure quality.",
  },
  signalsRuleFilter: {
    inline: "Filter signals by detection rule family.",
    tooltip:
      "Rule filter narrows analysis to specific detector classes, useful during incident-focused triage.",
  },
  closeSignalAction: {
    inline: "Close an open signal after review completion.",
    tooltip:
      "Closing marks the signal disposition and removes it from active queueing. Confirm evidence and ownership before closing.",
  },
  kycStatusFilter: {
    inline: "Scope KYC queue by current workflow status.",
    tooltip:
      "Status filter reduces queue noise and helps operators focus on actionable items.",
  },
  kycApproveAction: {
    inline: "Approve submitted KYC package.",
    tooltip:
      "Approval advances user compliance status. Ensure documentation and policy criteria are fully satisfied.",
  },
  kycRejectAction: {
    inline: "Reject submitted KYC package.",
    tooltip:
      "Rejection should include a defensible reason and be applied only after review of submission quality.",
  },
  identitiesLinkType: {
    inline: "Limit identity search to a specific identifier class.",
    tooltip:
      "Narrow by identifier type to increase signal precision (for example device fingerprint vs IP subnet).",
  },
  identitiesSearch: {
    inline: "Search identity values by prefix/hash/IP fragment.",
    tooltip:
      "Use focused search terms to isolate suspect identity artifacts quickly in large datasets.",
  },
  identitiesMinUsers: {
    inline: "Minimum linked-user count required for rows to appear.",
    tooltip:
      "Higher minimums reduce noise by hiding weak single-user or two-user relationships.",
  },
  identitiesLimit: {
    inline: "Maximum number of identity link rows returned.",
    tooltip:
      "Use lower limits for fast triage; increase for broader forensic sweeps.",
  },
  identitiesApplyFilters: {
    inline: "Apply identity filters and refresh result set.",
    tooltip:
      "Applies current filter state and resets nested drill-down context.",
  },
  identitiesRefreshUsers: {
    inline: "Refresh linked users for selected identity value.",
    tooltip:
      "Use after identity ingestion updates or manual investigation actions.",
  },
  identitiesViewUserLinks: {
    inline: "Open complete identity-link footprint for selected user.",
    tooltip:
      "Shows all observed link types for that user with global user counts for each value.",
  },
  exportSignals: {
    inline: "Download full signals dataset as CSV.",
    tooltip:
      "Signals export is best for timeline reconstruction and offline scoring analysis.",
  },
  exportUsers: {
    inline: "Download flagged-user dataset as CSV.",
    tooltip:
      "Flagged users export supports case prioritization and periodic compliance reporting.",
  },
  exportObservations: {
    inline: "Download observation feed as CSV.",
    tooltip:
      "Observations export captures underlying telemetry inputs used by detectors.",
  },
  saveConfig: {
    inline: "Persist pending detection configuration edits.",
    tooltip:
      "Saving applies updated risk logic to future evaluations. Coordinate high-impact threshold changes with operations.",
  },
  ip2asnRefresh: {
    inline: "Refresh local ip2asn dataset status snapshot.",
    tooltip:
      "Use when validating ingestion freshness, range counts, and cache health.",
  },
  ip2asnReimport: {
    inline: "Rebuild local ip2asn range table from TSV dataset.",
    tooltip:
      "Reimport can take time and rebuilds range metadata. Run when dataset mismatch or corruption is suspected.",
  },
  ip2asnEnrich: {
    inline: "Backfill ASN/Org values for recent IP observations.",
    tooltip:
      "Enrichment improves network attribution accuracy for signals and identity link analysis.",
  },
  checkpoint: {
    inline: "Issue Postgres CHECKPOINT operation.",
    tooltip:
      "Checkpoint flushes WAL and can be I/O intensive. Use during controlled maintenance or incident response.",
  },
  vacuumConfirm: {
    inline: "Safety phrase required before VACUUM can run.",
    tooltip:
      "Type VACUUM exactly to unlock the operation and reduce accidental execution risk.",
  },
  vacuumRun: {
    inline: "Run manual VACUUM maintenance.",
    tooltip:
      "VACUUM is operationally sensitive and should run in low-traffic maintenance windows.",
  },
  auditRefresh: {
    inline: "Refresh audit log rows and chain-verification result.",
    tooltip:
      "Run refresh after admin actions or when investigating integrity alerts.",
  },
} as const;

const GRIFT_CONFIG_FIELD_HELP: Record<string, { inline: string; tooltip: string }> = {
  enabled: {
    inline: "Master switch for running grift detection logic.",
    tooltip: "Disable only for controlled maintenance or incident rollback; normal production should stay enabled.",
  },
  hedgeRequireDeviceMatch: {
    inline: "Require device identity match for hedge-pair scoring.",
    tooltip: "Tightens hedge correlation confidence by demanding shared device evidence.",
  },
  hedgeAllowIpMatch: {
    inline: "Allow shared IP evidence to contribute to hedge scoring.",
    tooltip: "Useful when device signals are sparse, but IP-only matches can be noisier.",
  },
  tierMed: {
    inline: "Score threshold entering medium risk tier.",
    tooltip: "Defines first escalation boundary for user risk classification.",
  },
  tierHigh: {
    inline: "Score threshold entering high risk tier.",
    tooltip: "Crossing this threshold should trigger enhanced review posture.",
  },
  tierCritical: {
    inline: "Score threshold entering critical risk tier.",
    tooltip: "Critical tier should represent immediate response priority.",
  },
  multiAccountWindowDays: {
    inline: "Lookback window for multi-account correlation checks.",
    tooltip: "Longer windows improve historical linkage recall but can increase stale noise.",
  },
  churnWindowHours: {
    inline: "Window for IP/UA/device churn pattern detection.",
    tooltip: "Short windows catch bursts; longer windows capture slower abuse behavior.",
  },
  hedgeWindowMinutes: {
    inline: "Temporal window for coordinated hedge behavior checks.",
    tooltip: "Defines how closely paired behaviors must align to be considered suspicious.",
  },
  concurrentWindowMinutes: {
    inline: "Window for concurrent-session correlation rules.",
    tooltip: "Used to identify suspicious simultaneous activity across related accounts.",
  },
  geoVelocityMaxHours: {
    inline: "Maximum hour span when evaluating geo-velocity jumps.",
    tooltip: "Geo anomalies outside this time span are ignored for velocity scoring.",
  },
  ladderingWindowDays: {
    inline: "Lookback for laddering-sequence analysis.",
    tooltip: "Controls how far back detector scans for coordinated sequence patterns.",
  },
  ipUniqueThreshold: {
    inline: "Unique-IP count threshold for anomaly triggering.",
    tooltip: "Lower values increase sensitivity to IP churn and proxy rotation.",
  },
  uaUniqueThreshold: {
    inline: "Unique user-agent threshold for anomaly triggering.",
    tooltip: "Helps detect scripted client rotation patterns.",
  },
  deviceUniqueThreshold: {
    inline: "Unique device-identifier threshold for anomaly triggering.",
    tooltip: "Highlights accounts rotating device identities aggressively.",
  },
  asnUniqueThreshold: {
    inline: "Unique ASN threshold for anomaly triggering.",
    tooltip: "Captures network-provider churn often associated with evasion.",
  },
  geoVelocityKmhThreshold: {
    inline: "Minimum implied travel speed to flag geo-velocity events.",
    tooltip: "Higher values reduce false positives from borderline location variance.",
  },
  geoVelocityMinDistanceKm: {
    inline: "Minimum distance required before geo-velocity rule can fire.",
    tooltip: "Prevents tiny geolocation jitter from generating impossible-travel signals.",
  },
  clusterMinUsersForIpAsn: {
    inline: "Minimum users required for shared IP+ASN cluster alerting.",
    tooltip: "Raises bar for network-cluster alerts to avoid low-confidence pairs.",
  },
  ladderingMinSequence: {
    inline: "Minimum event sequence length to trigger laddering detection.",
    tooltip: "Higher values require stronger behavioral sequences before signaling.",
  },
  scoreMultiAccountDevice: {
    inline: "Points added for multi-account shared install-ID evidence.",
    tooltip: "Weight controls contribution of shared install identifiers to total score.",
  },
  scoreMultiAccountFingerprint: {
    inline: "Points added for shared device-fingerprint evidence.",
    tooltip: "Increase when fingerprint confidence is high in your environment.",
  },
  scoreHedgePair: {
    inline: "Points added for coordinated hedge-pair detections.",
    tooltip: "Primary weight for paired trading coordination signals.",
  },
  scoreIpChurn: {
    inline: "Points added for suspicious IP churn behavior.",
    tooltip: "Adjust to tune sensitivity for proxy/VPN hopping patterns.",
  },
  scoreUaChurn: {
    inline: "Points added for unusual user-agent churn.",
    tooltip: "Useful for scripted client rotation detection.",
  },
  scoreDeviceChurn: {
    inline: "Points added for rapid device-identity churn.",
    tooltip: "Increase to penalize repeated device identity changes.",
  },
  scoreGeoVelocity: {
    inline: "Points added for geo-velocity anomalies.",
    tooltip: "Controls severity of impossible-travel-like events in final risk score.",
  },
  scoreConcurrentSessions: {
    inline: "Points added for concurrent-session anomalies.",
    tooltip: "Weights suspicious overlap in session activity across related accounts.",
  },
  scoreAsnVolatility: {
    inline: "Points added for ASN volatility behavior.",
    tooltip: "Captures rapid network-provider transitions indicative of evasion.",
  },
  scoreSharedIpAsnCluster: {
    inline: "Points added for shared IP+ASN cluster findings.",
    tooltip: "Cluster score weight for group-level network linkage anomalies.",
  },
  scoreMultiAccountLaddering: {
    inline: "Points added for multi-account laddering sequences.",
    tooltip: "Weights coordinated sequential behavior across related accounts.",
  },
  mitigationMfa: {
    inline: "Score reduction applied when MFA mitigation is present.",
    tooltip: "Positive mitigation lowers effective risk for users with strong MFA posture.",
  },
  mitigationKycApproved: {
    inline: "Score reduction applied for approved KYC status.",
    tooltip: "Approved KYC can reduce baseline risk when policy allows mitigation.",
  },
  enforcementFreezeThreshold: {
    inline: "Score threshold for freeze-level enforcement.",
    tooltip: "Users at/above this score become freeze candidates when auto-enforcement is enabled.",
  },
  enforcementDisableThreshold: {
    inline: "Score threshold for disable-level enforcement.",
    tooltip: "Higher-severity boundary for account disable actions.",
  },
  enforcementAutoFreeze: {
    inline: "Automatically freeze accounts crossing freeze threshold.",
    tooltip: "Enable only when confidence and response processes are mature.",
  },
  enforcementAutoDisable: {
    inline: "Automatically disable accounts crossing disable threshold.",
    tooltip: "Most aggressive control; requires strict governance and monitoring.",
  },
  retentionObservationsDays: {
    inline: "Retention duration for observation records.",
    tooltip: "Longer retention helps forensics but increases storage footprint.",
  },
  retentionTradeObservationsDays: {
    inline: "Retention duration for trade-observation records.",
    tooltip: "Used for historical strategy-pattern investigations and audits.",
  },
  retentionAuthEventsDays: {
    inline: "Retention duration for auth-event records.",
    tooltip: "Maintain sufficient depth for account-access investigations and compliance.",
  },
  retentionIpAsnCacheDays: {
    inline: "Retention duration for IP-to-ASN cache entries.",
    tooltip: "Balance lookup freshness against cache growth and storage costs.",
  },
};

function resolveConfigFieldHelp(key: string, label: string) {
  const found = GRIFT_CONFIG_FIELD_HELP[key];
  if (found) return found;
  return {
    inline: `Configure ${label.toLowerCase()} for detection behavior.`,
    tooltip: `Adjust ${label} carefully and validate downstream detection outcomes after saving.`,
  };
}

function FieldHintLabel({
  label,
  hint,
  labelClassName = "text-sm",
}: {
  label: string;
  hint: string;
  labelClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className={labelClassName}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
            aria-label={`${label} hint`}
          >
            Hint
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function UsersTab() {
  const { data, isLoading, isRefetching, refetch } = useQuery<{ users: FlaggedUser[] }>({
    queryKey: ["/api/admin/grift/flagged-users"],
  });

  const users = data?.users || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="Flagged Users" hint={GRIFT_FIELD_HELP.flaggedUsers.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.flaggedUsers.inline}</p>
        </div>
        <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </GriftRefreshButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-neutral-700">
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>7d Score</TableHead>
                  <TableHead>30d Score</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Open Signals</TableHead>
                  <TableHead>Last Evaluated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-400 py-8">
                      No flagged users
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.user_id} className="border-neutral-700">
                      <TableCell className="font-mono">{user.username || `#${user.user_id}`}</TableCell>
                      <TableCell className="text-gray-400">{user.email}</TableCell>
                      <TableCell className="font-bold text-lg">{user.total_score}</TableCell>
                      <TableCell>{user.last_7d_score}</TableCell>
                      <TableCell>{user.last_30d_score}</TableCell>
                      <TableCell>
                        <Badge className={getTierColor(user.tier)}>{user.tier}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{user.open_signal_count}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTimestamp(user.last_evaluated_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function KycQueueTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all_status");

  // Build query URL based on filter - default queryFn uses first queryKey element as URL
  const kycQueryUrl = statusFilter !== "all_status"
    ? `/api/admin/kyc/queue?status=${statusFilter}`
    : "/api/admin/kyc/queue";

  const { data, isLoading, isRefetching, refetch } = useQuery<KycQueueItem[]>({
    queryKey: [kycQueryUrl],
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ userId, decision, rejectionReason }: { userId: number; decision: "APPROVED" | "REJECTED"; rejectionReason?: string }) => {
      await apiRequest("POST", "/api/admin/kyc/review", { userId, decision, rejectionReason });
    },
    onSuccess: (_, variables) => {
      // Invalidate all KYC queue queries regardless of filter
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/admin/kyc/queue');
        }
      });
      toast({ title: `KYC ${variables.decision.toLowerCase()}` });
    },
    onError: () => {
      toast({ title: "Failed to process KYC review", variant: "destructive" });
    },
  });

  const kycQueue = data || [];

  const getKycStatusColor = (status: string) => {
    switch (status?.toUpperCase()) {
      case "INVITED": return "bg-blue-500";
      case "SUBMITTED": return "bg-amber-500";
      case "APPROVED": return "bg-green-600";
      case "REJECTED": return "bg-red-600";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="KYC Queue" hint={GRIFT_FIELD_HELP.kycStatusFilter.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.kycStatusFilter.inline}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <FieldHintLabel label="Status" hint={GRIFT_FIELD_HELP.kycStatusFilter.tooltip} labelClassName="text-sm" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 bg-neutral-700 border-neutral-600" title={GRIFT_FIELD_HELP.kycStatusFilter.tooltip}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_status">All</SelectItem>
                <SelectItem value="INVITED">Invited</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </GriftRefreshButton>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-neutral-700">
                  <TableHead>User ID</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited At</TableHead>
                  <TableHead>Submitted At</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kycQueue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                      <CheckCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No pending KYC applications
                    </TableCell>
                  </TableRow>
                ) : (
                  kycQueue.map((item) => (
                    <TableRow key={item.userId} className="border-neutral-700">
                      <TableCell className="font-mono text-sm">{item.userId}</TableCell>
                      <TableCell>
                        <div className="text-sm">{item.username || `User #${item.userId}`}</div>
                        <div className="text-xs text-gray-400">{item.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getKycStatusColor(item.status)}>{item.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {item.invitedAt ? formatTimestamp(item.invitedAt * 1000) : "N/A"}
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">
                        {item.submittedAt ? formatTimestamp(item.submittedAt * 1000) : "N/A"}
                      </TableCell>
                      <TableCell>
                        {item.status === "SUBMITTED" && (
                          <div className="flex gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => reviewMutation.mutate({ userId: item.userId, decision: "APPROVED" })}
                              disabled={reviewMutation.isPending}
                              title={GRIFT_FIELD_HELP.kycApproveAction.tooltip}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => reviewMutation.mutate({ userId: item.userId, decision: "REJECTED", rejectionReason: "Documents did not meet requirements" })}
                              disabled={reviewMutation.isPending}
                              title={GRIFT_FIELD_HELP.kycRejectAction.tooltip}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                        {item.status === "INVITED" && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Awaiting submission
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PairsTab() {
  const { data, isLoading, isRefetching, refetch } = useQuery<{ pairs: HedgePair[]; total: number }>({
    queryKey: ["/api/admin/grift/pairs"],
  });

  const pairs = data?.pairs || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="Hedge Pair Detections" hint={GRIFT_FIELD_HELP.pairs.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.pairs.inline}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Total: {data?.total || 0}</span>
          <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </GriftRefreshButton>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-neutral-700">
                  <TableHead>ID</TableHead>
                  <TableHead>User A</TableHead>
                  <TableHead>User B</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-400 py-8">
                      No hedge pairs detected
                    </TableCell>
                  </TableRow>
                ) : (
                  pairs.map((pair) => (
                    <TableRow key={pair.id} className="border-neutral-700">
                      <TableCell className="font-mono text-xs">{pair.id}</TableCell>
                      <TableCell>
                        <div className="text-sm">{pair.userUsername || `#${pair.userId}`}</div>
                        <div className="text-xs text-gray-400">{pair.userEmail}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{pair.relatedUsername || `#${pair.relatedUserId}`}</div>
                        <div className="text-xs text-gray-400">{pair.relatedEmail}</div>
                      </TableCell>
                      <TableCell className="font-mono font-bold">{pair.symbol || "N/A"}</TableCell>
                      <TableCell>
                        <Badge className={getSeverityColor(pair.severity)}>{pair.severity}</Badge>
                      </TableCell>
                      <TableCell className="font-bold">{pair.points}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(pair.status)}>{pair.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTimestamp(pair.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NetworksTab() {
  const { data, isLoading, isRefetching, refetch } = useQuery<NetworkData>({
    queryKey: ["/api/admin/grift/networks"],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="Linked Account Networks" hint={GRIFT_FIELD_HELP.networks.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.networks.inline}</p>
        </div>
        <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </GriftRefreshButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-neutral-800 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Total Edges</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data?.totalEdges || 0}</div>
              </CardContent>
            </Card>

            <Card className="bg-neutral-800 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Cluster Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data?.clusterCount || 0}</div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-neutral-800 border-neutral-700">
            <CardHeader>
              <CardTitle className="text-base">Detected Clusters</CardTitle>
              <CardDescription>Groups of accounts linked by shared devices/IPs</CardDescription>
            </CardHeader>
            <CardContent>
              {data?.clusters?.length === 0 ? (
                <p className="text-gray-400">No clusters detected</p>
              ) : (
                <div className="space-y-3">
                  {data?.clusters?.map((cluster, idx) => (
                    <div key={idx} className="bg-neutral-900 p-3 rounded">
                      <div className="flex items-center gap-2 mb-2">
                        <Network className="h-4 w-4 text-purple-400" />
                        <span className="font-semibold">Cluster {idx + 1}</span>
                        <Badge variant="outline">{cluster.size} users</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {cluster.userIds.map((userId) => (
                          <Badge key={userId} variant="secondary" className="font-mono">
                            User #{userId}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function IdentitiesTab() {
  const { toast } = useToast();

  const [linkType, setLinkType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [minUsers, setMinUsers] = useState(2);
  const [limit, setLimit] = useState(200);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<{ linkType: string; linkValue: string } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const { data, isLoading, isRefetching, refetch } = useQuery<IdentityLinksResponse>({
    queryKey: ["/api/admin/grift/identity-links", linkType, search, minUsers, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (linkType && linkType !== "all") params.set("linkType", linkType);
      if (search.trim()) params.set("search", search.trim());
      params.set("minUsers", String(minUsers));
      params.set("limit", String(limit));
      const res = await apiRequest("GET", `/api/admin/grift/identity-links?${params.toString()}`);
      return await res.json();
    },
  });

  const links = data?.links || [];

  const { data: linkUsersData, isLoading: linkUsersLoading, isRefetching: isRefetchingLinkUsers, refetch: refetchLinkUsers } = useQuery<
    IdentityLinkUsersResponse
  >({
    queryKey: ["/api/admin/grift/identity-links/users", selectedLink?.linkType, selectedLink?.linkValue],
    enabled: !!selectedLink,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("linkType", selectedLink!.linkType);
      params.set("linkValue", selectedLink!.linkValue);
      const res = await apiRequest("GET", `/api/admin/grift/identity-links/users?${params.toString()}`);
      return await res.json();
    },
  });

  const { data: userLinksData, isLoading: userLinksLoading } = useQuery<UserIdentityLinksResponse>({
    queryKey: ["/api/admin/grift/users", selectedUserId, "identity-links"],
    enabled: selectedUserId !== null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/grift/users/${selectedUserId}/identity-links`);
      return await res.json();
    },
  });

  const toggleLink = (t: string, v: string) => {
    const key = `${t}|${v}`;
    if (openKey === key) {
      setOpenKey(null);
      setSelectedLink(null);
      setSelectedUserId(null);
      return;
    }
    setOpenKey(key);
    setSelectedLink({ linkType: t, linkValue: v });
    setSelectedUserId(null);
  };

  const linkUsers = linkUsersData?.users || [];
  const userLinks = userLinksData?.links || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="Identity Links" hint={GRIFT_FIELD_HELP.identities.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.identities.inline}</p>
        </div>
        <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </GriftRefreshButton>
      </div>

      <Card className="bg-neutral-800 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="h-5 w-5" />
            Fingerprints & Identifiers
          </CardTitle>
          <CardDescription>
            Inspect shared device install IDs, device fingerprints, IPs, and subnets across users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <FieldHintLabel label="Link Type" hint={GRIFT_FIELD_HELP.identitiesLinkType.tooltip} labelClassName="text-sm" />
              <Select value={linkType} onValueChange={setLinkType}>
                <SelectTrigger className="bg-neutral-700 border-neutral-600 mt-1" title={GRIFT_FIELD_HELP.identitiesLinkType.tooltip}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="device_install_id">Device Install ID</SelectItem>
                  <SelectItem value="device_fp">Device Fingerprint</SelectItem>
                  <SelectItem value="device_id">Legacy Device ID</SelectItem>
                  <SelectItem value="ip">IP Address</SelectItem>
                  <SelectItem value="ip_subnet">IP Subnet</SelectItem>
                  <SelectItem value="asn">ASN</SelectItem>
                  <SelectItem value="org">Org</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <FieldHintLabel label="Search" hint={GRIFT_FIELD_HELP.identitiesSearch.tooltip} labelClassName="text-sm" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search link value (prefix/hash/IP)"
                className="bg-neutral-700 border-neutral-600 mt-1"
                title={GRIFT_FIELD_HELP.identitiesSearch.tooltip}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldHintLabel label="Min Users" hint={GRIFT_FIELD_HELP.identitiesMinUsers.tooltip} labelClassName="text-sm" />
                <Input
                  type="number"
                  value={minUsers}
                  min={2}
                  onChange={(e) => setMinUsers(Math.max(2, Number(e.target.value) || 2))}
                  className="bg-neutral-700 border-neutral-600 mt-1"
                  title={GRIFT_FIELD_HELP.identitiesMinUsers.tooltip}
                />
              </div>
              <div>
                <FieldHintLabel label="Limit" hint={GRIFT_FIELD_HELP.identitiesLimit.tooltip} labelClassName="text-sm" />
                <Input
                  type="number"
                  value={limit}
                  min={10}
                  max={1000}
                  onChange={(e) => setLimit(Math.max(10, Math.min(1000, Number(e.target.value) || 200)))}
                  className="bg-neutral-700 border-neutral-600 mt-1"
                  title={GRIFT_FIELD_HELP.identitiesLimit.tooltip}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <GriftRefreshButton
              disabled={isLoading || isRefetching}
              onClick={() => {
                setOpenKey(null);
                setSelectedLink(null);
                setSelectedUserId(null);
                void refetch();
                toast({ title: "Identity links refreshed" });
              }}
              title={GRIFT_FIELD_HELP.identitiesApplyFilters.tooltip}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
              Apply Filters
            </GriftRefreshButton>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-neutral-700">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                      No identity links found
                    </TableCell>
                  </TableRow>
                ) : (
                  links.map((link) => {
                    const key = `${link.link_type}|${link.link_value}`;
                    const isOpenRow = openKey === key;
                    return (
                      <Collapsible key={key} open={isOpenRow} asChild>
                        <>
                          <TableRow className="border-neutral-700">
                            <TableCell>
                              <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => toggleLink(link.link_type, link.link_value)}>
                                  {isOpenRow ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              </CollapsibleTrigger>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">
                                {link.link_type}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs max-w-[520px] truncate">{link.link_value}</TableCell>
                            <TableCell className="font-semibold">{link.user_count}</TableCell>
                            <TableCell className="text-xs text-gray-400">{formatTimestamp(link.last_seen_at)}</TableCell>
                          </TableRow>

                          <CollapsibleContent asChild>
                            <TableRow className="border-neutral-700 bg-neutral-900/30">
                              <TableCell colSpan={5}>
                                <div className="p-4 space-y-4">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="font-semibold">Users for this identity</div>
                                      <div className="text-xs text-gray-400">
                                        {link.link_type} = <span className="font-mono">{link.link_value}</span>
                                      </div>
                                    </div>
                                    <GriftRefreshButton
                                      disabled={linkUsersLoading || isRefetchingLinkUsers}
                                      onClick={() => {
                                        setSelectedUserId(null);
                                        const next = { linkType: link.link_type, linkValue: link.link_value };
                                        const isSame =
                                          selectedLink?.linkType === next.linkType && selectedLink?.linkValue === next.linkValue;
                                        setSelectedLink(next);
                                        if (isSame) void refetchLinkUsers();
                                      }}
                                      title={GRIFT_FIELD_HELP.identitiesRefreshUsers.tooltip}
                                    >
                                      <RefreshCw className={`h-4 w-4 mr-2 ${linkUsersLoading || isRefetchingLinkUsers ? "animate-spin" : ""}`} />
                                      Refresh Users
                                    </GriftRefreshButton>
                                  </div>

                                  {linkUsersLoading ? (
                                    <div className="flex items-center gap-2 text-gray-400">
                                      <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"></div>
                                      Loading users...
                                    </div>
                                  ) : linkUsers.length === 0 ? (
                                    <div className="text-sm text-gray-400">No users found for this identity.</div>
                                  ) : (
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="border-neutral-700">
                                          <TableHead>User</TableHead>
                                          <TableHead>Email</TableHead>
                                          <TableHead>Last Seen</TableHead>
                                          <TableHead className="w-40">Actions</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {linkUsers.map((u) => (
                                          <TableRow key={u.id} className="border-neutral-700">
                                            <TableCell className="font-mono text-xs">
                                              {u.username || `#${u.id}`}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-400">{u.email || "N/A"}</TableCell>
                                            <TableCell className="text-xs text-gray-400">{formatTimestamp(u.last_seen_at)}</TableCell>
                                            <TableCell>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSelectedUserId(u.id)}
                                                title={GRIFT_FIELD_HELP.identitiesViewUserLinks.tooltip}
                                              >
                                                View User Links
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  )}

                                  {selectedUserId !== null && (
                                    <Card className="bg-neutral-800 border-neutral-700">
                                      <CardHeader className="pb-2">
                                        <CardTitle className="text-sm">User #{selectedUserId} Identity Links</CardTitle>
                                        <CardDescription>
                                          All link types observed for this user (with global user counts).
                                        </CardDescription>
                                      </CardHeader>
                                      <CardContent>
                                        {userLinksLoading ? (
                                          <div className="flex items-center gap-2 text-gray-400">
                                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"></div>
                                            Loading identity links...
                                          </div>
                                        ) : userLinks.length === 0 ? (
                                          <div className="text-sm text-gray-400">No identity links recorded for this user.</div>
                                        ) : (
                                          <Table>
                                            <TableHeader>
                                              <TableRow className="border-neutral-700">
                                                <TableHead>Type</TableHead>
                                                <TableHead>Value</TableHead>
                                                <TableHead>Users</TableHead>
                                                <TableHead>Count</TableHead>
                                                <TableHead>Last Seen</TableHead>
                                              </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                              {userLinks.map((r, idx) => (
                                                <TableRow key={`${r.link_type}|${r.link_value}|${idx}`} className="border-neutral-700">
                                                  <TableCell className="font-mono text-xs">{r.link_type}</TableCell>
                                                  <TableCell className="font-mono text-xs max-w-[520px] truncate">{r.link_value}</TableCell>
                                                  <TableCell className="font-semibold">{r.user_count}</TableCell>
                                                  <TableCell className="font-mono text-xs">{r.occurrence_count}</TableCell>
                                                  <TableCell className="text-xs text-gray-400">{formatTimestamp(r.last_seen_at)}</TableCell>
                                                </TableRow>
                                              ))}
                                            </TableBody>
                                          </Table>
                                        )}
                                      </CardContent>
                                    </Card>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          </CollapsibleContent>
                        </>
                      </Collapsible>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CasesTab() {
  const { data, isLoading, isRefetching, refetch } = useQuery<{ cases: GriftCase[] }>({
    queryKey: ["/api/admin/grift/cases"],
  });

  const cases = data?.cases || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="Case Management" hint={GRIFT_FIELD_HELP.cases.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.cases.inline}</p>
        </div>
        <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </GriftRefreshButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-neutral-700">
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Assigned To</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Resolution</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-gray-400 py-8">
                      <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      No cases created yet
                    </TableCell>
                  </TableRow>
                ) : (
                  cases.map((c) => (
                    <TableRow key={c.id} className="border-neutral-700">
                      <TableCell className="font-mono text-xs">{c.id}</TableCell>
                      <TableCell>{c.title}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(c.status)}>{c.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getTierColor(c.priority)}>{c.priority}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-300">
                        {c.created_by_admin_id == null ? "N/A" : `#${c.created_by_admin_id}`}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-300">
                        {c.assigned_admin_id == null ? "Unassigned" : `#${c.assigned_admin_id}`}
                      </TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTimestamp(c.created_at)}</TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTimestamp(c.updated_at)}</TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTimestamp(c.closed_at)}</TableCell>
                      <TableCell className="text-xs text-gray-300">
                        <span className="block max-w-[16rem] truncate" title={c.resolution ?? ""}>
                          {c.resolution?.trim() ? c.resolution : "N/A"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ExportsTab() {
  const handleExport = (endpoint: string, filename: string) => {
    window.open(`/api/admin/grift/export/${endpoint}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div>
        <FieldHintLabel label="Export Data" hint={GRIFT_FIELD_HELP.exports.tooltip} labelClassName="text-lg font-semibold" />
        <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.exports.inline}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Signals Export
            </CardTitle>
            <CardDescription>Export all grift signals to CSV</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleExport("signals", "grift_signals.csv")}
              title={GRIFT_FIELD_HELP.exportSignals.tooltip}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Signals CSV
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-red-400" />
              Flagged Users Export
            </CardTitle>
            <CardDescription>Export flagged users to CSV</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleExport("flagged-users", "flagged_users.csv")}
              title={GRIFT_FIELD_HELP.exportUsers.tooltip}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Users CSV
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-400" />
              Observations Export
            </CardTitle>
            <CardDescription>Export observation data to CSV</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleExport("observations", "observations.csv")}
              title={GRIFT_FIELD_HELP.exportObservations.tooltip}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Observations CSV
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuditTab() {
  const { data: logsData, isLoading: logsLoading, isRefetching: logsRefetching, refetch: refetchLogs } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ["/api/admin/grift/audit-log"],
  });

  const { data: verifyData, isLoading: verifyLoading, isRefetching: verifyRefetching, refetch: refetchVerify } = useQuery<AuditVerifyResult>({
    queryKey: ["/api/admin/grift/audit-log/verify"],
  });

  const logs = logsData?.logs || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel label="Audit Log" hint={GRIFT_FIELD_HELP.audit.tooltip} labelClassName="text-lg font-semibold" />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.audit.inline}</p>
        </div>
        <div className="flex items-center gap-2">
          <GriftRefreshButton disabled={logsLoading || logsRefetching || verifyLoading || verifyRefetching} onClick={() => { refetchLogs(); refetchVerify(); }} title={GRIFT_FIELD_HELP.auditRefresh.tooltip}>
            <RefreshCw className={`h-4 w-4 mr-2 ${(logsLoading || logsRefetching || verifyLoading || verifyRefetching) ? "animate-spin" : ""}`} />
            Refresh
          </GriftRefreshButton>
        </div>
      </div>

      <Card className="bg-neutral-800 border-neutral-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <div className="flex-1">
              <FieldHintLabel label="Hash Chain Verification" hint={GRIFT_FIELD_HELP.audit.tooltip} labelClassName="text-base" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {verifyLoading ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary"></div>
              <span>Verifying...</span>
            </div>
          ) : verifyData?.valid ? (
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span>Audit chain integrity verified ({verifyData.totalEntries} entries)</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-400">
              <XCircle className="h-5 w-5" />
              <span>Chain broken at entry {verifyData?.brokenAt}: {verifyData?.message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {logsLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-neutral-700">
                    <TableHead>ID</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Admin</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        No audit logs
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id} className="border-neutral-700">
                        <TableCell className="font-mono text-xs">{log.id}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.action}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.target_type} #{log.target_id}
                        </TableCell>
                        <TableCell>Admin #{log.admin_id}</TableCell>
                        <TableCell className="text-xs text-gray-400">{formatTimestamp(log.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs text-gray-500 max-w-[100px] truncate">
                          {log.hash?.slice(0, 12)}...
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function GriftAdmin() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-6 w-6 text-amber-400" />
          <div>
            <FieldHintLabel label="Grift Detection System" hint={GRIFT_FIELD_HELP.overview.tooltip} labelClassName="text-xl font-semibold" />
            <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.overview.inline}</p>
          </div>
        </div>

        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
          Investigation controls include hidden <span className="font-medium">Hint</span> explainers on filters, actions, and risk-configuration fields.
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-neutral-700 flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="dashboard" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.dashboard.tooltip}>
              <Activity className="h-3 w-3 mr-1" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="signals" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.signals.tooltip}>
              <AlertTriangle className="h-3 w-3 mr-1" />
              Signals
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.flaggedUsers.tooltip}>
              <Users className="h-3 w-3 mr-1" />
              Users
            </TabsTrigger>
            <TabsTrigger value="pairs" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.pairs.tooltip}>
              <Link2 className="h-3 w-3 mr-1" />
              Pairs
            </TabsTrigger>
            <TabsTrigger value="networks" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.networks.tooltip}>
              <Network className="h-3 w-3 mr-1" />
              Networks
            </TabsTrigger>
            <TabsTrigger value="identities" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.identities.tooltip}>
              <Fingerprint className="h-3 w-3 mr-1" />
              Identities
            </TabsTrigger>
            <TabsTrigger value="cases" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.cases.tooltip}>
              <Briefcase className="h-3 w-3 mr-1" />
              Cases
            </TabsTrigger>
            <TabsTrigger value="exports" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.exports.tooltip}>
              <Download className="h-3 w-3 mr-1" />
              Exports
            </TabsTrigger>
            <TabsTrigger value="config" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.config.tooltip}>
              <Settings className="h-3 w-3 mr-1" />
              Config
            </TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-neutral-600 text-xs" title={GRIFT_FIELD_HELP.audit.tooltip}>
              <FileText className="h-3 w-3 mr-1" />
              Audit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>

          <TabsContent value="signals">
            <SignalsTab />
          </TabsContent>

          <TabsContent value="users">
            <UsersTab />
          </TabsContent>

          <TabsContent value="pairs">
            <PairsTab />
          </TabsContent>

          <TabsContent value="networks">
            <NetworksTab />
          </TabsContent>

          <TabsContent value="identities">
            <IdentitiesTab />
          </TabsContent>

          <TabsContent value="cases">
            <CasesTab />
          </TabsContent>

          <TabsContent value="exports">
            <ExportsTab />
          </TabsContent>

          <TabsContent value="config">
            <ConfigTab />
          </TabsContent>

          <TabsContent value="audit">
            <AuditTab />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
