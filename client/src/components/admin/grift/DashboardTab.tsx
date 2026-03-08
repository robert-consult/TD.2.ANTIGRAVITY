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

export function DashboardTab() {
  const { data, isLoading, isRefetching, refetch } = useQuery<GriftOverview>({
    queryKey: ["/api/admin/grift/overview"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  const overview = data || {
    openSignalsCount: 0,
    hedgePairs7d: 0,
    linkedAccounts30d: 0,
    geoVelocityHits7d: 0,
    concurrentSessionsHits7d: 0,
    ipChurnHits7d: 0,
    uaChurnHits7d: 0,
    deviceChurnHits7d: 0,
    tierCounts: { LOW: 0, MED: 0, HIGH: 0, CRITICAL: 0 },
    topUsersByScore: [],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel
            label="Grift Detection Overview"
            hint={GRIFT_FIELD_HELP.dashboard.tooltip}
            labelClassName="text-lg font-semibold"
          />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.dashboard.inline}</p>
        </div>
        <GriftRefreshButton disabled={isLoading || isRefetching} onClick={() => refetch()} title={GRIFT_FIELD_HELP.refresh.tooltip}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </GriftRefreshButton>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Open Signals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-400">{overview.openSignalsCount}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Hedge Pairs (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-400">{overview.hedgePairs7d}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Linked Accounts (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-400">{overview.linkedAccounts30d}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Geo Velocity (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400">{overview.geoVelocityHits7d}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Concurrent Sessions (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-400">{overview.concurrentSessionsHits7d}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">IP Churn (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-cyan-400">{overview.ipChurnHits7d}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">UA Churn (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-teal-400">{overview.uaChurnHits7d}</div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Device Churn (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-pink-400">{overview.deviceChurnHits7d}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-neutral-800 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-base">Risk Tier Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge className={getTierColor("LOW")}>LOW</Badge>
              <span className="text-xl font-semibold">{overview.tierCounts?.LOW || 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={getTierColor("MED")}>MEDIUM</Badge>
              <span className="text-xl font-semibold">{overview.tierCounts?.MED || 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={getTierColor("HIGH")}>HIGH</Badge>
              <span className="text-xl font-semibold">{overview.tierCounts?.HIGH || 0}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={getTierColor("CRITICAL")}>CRITICAL</Badge>
              <span className="text-xl font-semibold">{overview.tierCounts?.CRITICAL || 0}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-neutral-800 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-base">Top Users by Risk Score</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-neutral-700">
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.topUsersByScore?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-gray-400">
                    No flagged users
                  </TableCell>
                </TableRow>
              ) : (
                overview.topUsersByScore?.map((user) => (
                  <TableRow key={user.user_id} className="border-neutral-700">
                    <TableCell className="font-mono">{user.username || `User #${user.user_id}`}</TableCell>
                    <TableCell className="text-gray-400">{user.email}</TableCell>
                    <TableCell className="font-bold">{user.score_current}</TableCell>
                    <TableCell>
                      <Badge className={getTierColor(user.tier)}>{user.tier}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

