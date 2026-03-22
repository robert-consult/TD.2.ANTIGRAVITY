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

interface GriftEffectiveConfigState {
  source: "DB" | "DEFAULT";
  engineCaps: {
    configTtlMs: number;
    maxLinkedEdgeWritesPerTrigger: number;
    maxEvidenceLinkedUsers: number;
    maxLinkedEdgeBatchRows: number;
  };
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

export function ConfigTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState<GriftConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [vacuumConfirm, setVacuumConfirm] = useState("");

  const { data, isLoading } = useQuery<{
    config: GriftConfig;
    effective?: GriftEffectiveConfigState;
  }>({
    queryKey: ["/api/admin/grift/config"],
  });

  const {
    data: dbStatsData,
    isLoading: dbStatsLoading,
    refetch: refetchDbStats,
  } = useQuery<{ stats: DbMaintenanceStats }>({
    queryKey: ["/api/admin/grift/maintenance/db-stats"],
  });

  const {
    data: ip2asnStatus,
    isLoading: ip2asnStatusLoading,
    refetch: refetchIp2asnStatus,
  } = useQuery<{
    datasetPath: string | null;
    file: { path: string; name: string; size: number; mtimeMs: number } | null;
    meta: any | null;
    metaMatchesFile: boolean;
    ranges: { total: number; v4: number; v6: number };
    cache: { total: number; missing: number };
  }>({
    queryKey: ["/api/admin/grift/ip2asn/status"],
  });

  const updateMutation = useMutation({
    mutationFn: async (config: Partial<GriftConfig>) => {
      await apiRequest("PUT", "/api/admin/grift/config", config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/config"] });
      setHasChanges(false);
      toast({ title: "Configuration saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save configuration",
        description: error?.message ?? undefined,
        variant: "destructive",
      });
    },
  });

  const reimportIp2AsnMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/grift/ip2asn/reimport", {});
      return res.json();
    },
    onSuccess: (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/ip2asn/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/identity-links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/signals"] });
      toast({
        title: "ip2asn dataset reimported",
        description: payload?.result?.imported ? `Rows: ${payload?.result?.rows ?? "?"}` : payload?.result?.reason ?? undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reimport ip2asn dataset",
        description: error?.message ?? undefined,
        variant: "destructive",
      });
    },
  });

  const enrichIp2AsnMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/grift/ip2asn/enrich", { limit: 100, lookbackHours: 24 });
      return res.json();
    },
    onSuccess: (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/ip2asn/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/identity-links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/signals"] });
      toast({
        title: "ASN/Org enrichment completed",
        description: payload?.result?.skipped
          ? payload?.result?.reason ?? "Skipped"
          : `Attempted: ${payload?.result?.attempted ?? 0}, enriched: ${payload?.result?.enriched ?? 0}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to run ASN/Org enrichment",
        description: error?.message ?? undefined,
        variant: "destructive",
      });
    },
  });

  const checkpointMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/grift/maintenance/checkpoint", {});
      return res.json();
    },
    onSuccess: (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/maintenance/db-stats"] });
      toast({
        title: "CHECKPOINT completed",
        description: payload?.skipped?.reason ?? "Checkpoint executed",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to CHECKPOINT",
        description: error?.message ?? undefined,
        variant: "destructive",
      });
    },
  });

  const vacuumMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/grift/maintenance/vacuum", {
        confirm: vacuumConfirm,
        checkpointFirst: true,
      });
      return res.json();
    },
    onSuccess: (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/grift/maintenance/db-stats"] });
      toast({
        title: "VACUUM completed",
        description: payload?.durationMs ? `Duration: ${(payload.durationMs / 1000).toFixed(1)}s` : undefined,
      });
      setVacuumConfirm("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to VACUUM database",
        description: error?.message ?? undefined,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  const config = localConfig || data?.config;

  if (!config) {
    return <p className="text-gray-400">Failed to load configuration</p>;
  }

  const handleChange = (key: string, value: number | boolean) => {
    const updated = { ...config, [key]: value };
    setLocalConfig(updated);
    setHasChanges(true);
  };

  const handleSave = () => {
    if (localConfig) {
      updateMutation.mutate(localConfig);
    }
  };

  const configGroups = [
    {
      title: "General",
      fields: [
        { key: "enabled", label: "Detection Enabled", type: "boolean" },
        { key: "hedgeRequireDeviceMatch", label: "Hedge Requires Device Match", type: "boolean" },
        { key: "hedgeAllowIpMatch", label: "Hedge Allows IP Match", type: "boolean" },
      ],
    },
    {
      title: "Tier Thresholds",
      fields: [
        { key: "tierMed", label: "Medium Tier Threshold", type: "number" },
        { key: "tierHigh", label: "High Tier Threshold", type: "number" },
        { key: "tierCritical", label: "Critical Tier Threshold", type: "number" },
      ],
    },
    {
      title: "Detection Windows",
      fields: [
        { key: "multiAccountWindowDays", label: "Multi-Account Window (days)", type: "number" },
        { key: "churnWindowHours", label: "Churn Window (hours)", type: "number" },
        { key: "hedgeWindowMinutes", label: "Hedge Window (minutes)", type: "number" },
        { key: "concurrentWindowMinutes", label: "Concurrent Window (minutes)", type: "number" },
        { key: "geoVelocityMaxHours", label: "Geo Velocity Max Hours", type: "number" },
        { key: "ladderingWindowDays", label: "Laddering Window (days)", type: "number" },
      ],
    },
    {
      title: "Detection Thresholds",
      fields: [
        { key: "ipUniqueThreshold", label: "IP Unique Threshold", type: "number" },
        { key: "uaUniqueThreshold", label: "UA Unique Threshold", type: "number" },
        { key: "deviceUniqueThreshold", label: "Device Unique Threshold", type: "number" },
        { key: "asnUniqueThreshold", label: "ASN Unique Threshold", type: "number" },
        { key: "geoVelocityKmhThreshold", label: "Geo Velocity Threshold (km/h)", type: "number" },
        { key: "geoVelocityMinDistanceKm", label: "Geo Velocity Min Distance (km)", type: "number" },
        { key: "clusterMinUsersForIpAsn", label: "Min Users For IP+ASN Cluster", type: "number" },
        { key: "ladderingMinSequence", label: "Laddering Min Sequence", type: "number" },
      ],
    },
    {
      title: "Score Weights",
      fields: [
        { key: "scoreMultiAccountDevice", label: "Multi-Account Device (Install ID)", type: "number" },
        { key: "scoreMultiAccountFingerprint", label: "Multi-Account Fingerprint", type: "number" },
        { key: "scoreHedgePair", label: "Hedge Pair", type: "number" },
        { key: "scoreIpChurn", label: "IP Churn", type: "number" },
        { key: "scoreUaChurn", label: "UA Churn", type: "number" },
        { key: "scoreDeviceChurn", label: "Device Churn", type: "number" },
        { key: "scoreGeoVelocity", label: "Geo Velocity", type: "number" },
        { key: "scoreConcurrentSessions", label: "Concurrent Sessions", type: "number" },
        { key: "scoreAsnVolatility", label: "ASN Volatility", type: "number" },
        { key: "scoreSharedIpAsnCluster", label: "Shared IP+ASN Cluster", type: "number" },
        { key: "scoreMultiAccountLaddering", label: "Multi-Account Laddering", type: "number" },
      ],
    },
    {
      title: "Mitigations",
      fields: [
        { key: "mitigationMfa", label: "MFA Mitigation (points)", type: "number" },
        { key: "mitigationKycApproved", label: "KYC Approved Mitigation (points)", type: "number" },
      ],
    },
    {
      title: "Enforcement",
      fields: [
        { key: "enforcementFreezeThreshold", label: "Freeze Threshold", type: "number" },
        { key: "enforcementDisableThreshold", label: "Disable Threshold", type: "number" },
        { key: "enforcementAutoFreeze", label: "Auto Freeze", type: "boolean" },
        { key: "enforcementAutoDisable", label: "Auto Disable", type: "boolean" },
      ],
    },
    {
      title: "Retention",
      fields: [
        { key: "retentionObservationsDays", label: "Retention: Observations (days)", type: "number" },
        { key: "retentionTradeObservationsDays", label: "Retention: Trade Observations (days)", type: "number" },
        { key: "retentionAuthEventsDays", label: "Retention: Auth Events (days)", type: "number" },
        { key: "retentionIpAsnCacheDays", label: "Retention: IP→ASN Cache (days)", type: "number" },
      ],
    },
  ];

  const dbStats = dbStatsData?.stats;
  const dbSizePretty = dbStats?.database?.sizePretty ?? "—";
  const vacuumResult = vacuumMutation.data as any | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <FieldHintLabel
            label="Grift Detection Configuration"
            hint={GRIFT_FIELD_HELP.config.tooltip}
            labelClassName="text-lg font-semibold"
          />
          <p className="text-xs text-gray-400 mt-1">{GRIFT_FIELD_HELP.config.inline}</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          className="bg-blue-600 hover:bg-blue-700"
          title={GRIFT_FIELD_HELP.saveConfig.tooltip}
        >
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {data?.effective ? (
        <Card className="bg-neutral-800 border-neutral-700">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-cyan-400" />
              <div className="flex-1">
                <FieldHintLabel
                  label="Effective Runtime Split"
                  hint="Grift policy remains admin-editable. Engine caps are protective deploy diagnostics and intentionally read-only."
                  labelClassName="text-base"
                />
              </div>
            </div>
            <CardDescription>
              Admin policy and deploy-owned engine caps are separated so high-impact throttles stay visible without becoming editable drift.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5 text-sm">
            <div>
              <div className="text-xs text-gray-400">Policy source</div>
              <div>{data.effective.source}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Config cache TTL</div>
              <div>{data.effective.engineCaps.configTtlMs} ms</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Max linked-edge writes/trigger</div>
              <div>{data.effective.engineCaps.maxLinkedEdgeWritesPerTrigger}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Max evidence-linked users</div>
              <div>{data.effective.engineCaps.maxEvidenceLinkedUsers}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Max linked-edge batch rows</div>
              <div>{data.effective.engineCaps.maxLinkedEdgeBatchRows}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-neutral-800 border-neutral-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5 text-cyan-400" />
            <div className="flex-1">
              <FieldHintLabel label="IP → ASN/Org Dataset (ip2asn)" hint={GRIFT_FIELD_HELP.ip2asnRefresh.tooltip} labelClassName="text-base" />
            </div>
          </div>
          <CardDescription>
            Offline ASN/Org enrichment using `attached_assets/ip2asn-combined.tsv` (fallback when proxy headers are absent).
          </CardDescription>
          <p className="text-xs text-gray-400">{GRIFT_FIELD_HELP.ip2asnRefresh.inline}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <GriftRefreshButton onClick={() => refetchIp2asnStatus()} disabled={ip2asnStatusLoading} title={GRIFT_FIELD_HELP.ip2asnRefresh.tooltip}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Status
            </GriftRefreshButton>
            <Button
              variant="outline"
              size="sm"
              disabled={reimportIp2AsnMutation.isPending}
              onClick={() => {
                const ok = window.confirm(
                  "Reimport ip2asn TSV? This can take a moment and will rebuild the local range table."
                );
                if (!ok) return;
                reimportIp2AsnMutation.mutate();
              }}
              title={GRIFT_FIELD_HELP.ip2asnReimport.tooltip}
            >
              <Download className="h-4 w-4 mr-2" />
              Reimport TSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={enrichIp2AsnMutation.isPending}
              onClick={() => enrichIp2AsnMutation.mutate()}
              title={GRIFT_FIELD_HELP.ip2asnEnrich.tooltip}
            >
              <Activity className="h-4 w-4 mr-2" />
              Enrich Now
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-400">Dataset Path</div>
              <div className="font-mono text-xs break-all">{ip2asnStatus?.datasetPath ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">File</div>
              {ip2asnStatus?.file ? (
                <div className="space-y-1">
                  <div className="font-mono text-xs">{ip2asnStatus.file.name}</div>
                  <div className="text-xs text-gray-400">
                    {Math.round(ip2asnStatus.file.size / (1024 * 1024))} MB • {formatTimestamp(ip2asnStatus.file.mtimeMs)}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-red-400">Missing</div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-400">Imported</div>
              {ip2asnStatus?.meta?.imported_at ? (
                <div className="text-xs">{formatTimestamp(Number(ip2asnStatus.meta.imported_at))}</div>
              ) : (
                <div className="text-xs text-gray-400">—</div>
              )}
              <div className="text-xs text-gray-400">
                Ranges: {ip2asnStatus?.ranges?.total ?? 0} (v4 {ip2asnStatus?.ranges?.v4 ?? 0}, v6 {ip2asnStatus?.ranges?.v6 ?? 0})
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-400">
            Cache: {ip2asnStatus?.cache?.total ?? 0} IPs • missing ASN/Org: {ip2asnStatus?.cache?.missing ?? 0}
          </div>

          {ip2asnStatus?.file && ip2asnStatus?.meta && !ip2asnStatus?.metaMatchesFile ? (
            <div className="text-xs text-amber-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Imported dataset meta does not match the current TSV; reimport recommended.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-neutral-800 border-neutral-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-cyan-400" />
            <div className="flex-1">
              <FieldHintLabel label="Database Maintenance (Manual VACUUM)" hint={GRIFT_FIELD_HELP.vacuumRun.tooltip} labelClassName="text-base" />
            </div>
          </div>
          <CardDescription>
            Postgres VACUUM reclaims table bloat (space reuse) and updates planner stats. Run during low traffic; it can be I/O heavy.
          </CardDescription>
          <p className="text-xs text-gray-400">{GRIFT_FIELD_HELP.vacuumRun.inline}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <GriftRefreshButton onClick={() => refetchDbStats()} disabled={dbStatsLoading} title={GRIFT_FIELD_HELP.refresh.tooltip}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Stats
            </GriftRefreshButton>
            <Button
              variant="outline"
              size="sm"
              disabled={checkpointMutation.isPending}
              onClick={() => {
                const ok = window.confirm("Run database CHECKPOINT? This flushes WAL and can be I/O heavy.");
                if (!ok) return;
                checkpointMutation.mutate();
              }}
              title={GRIFT_FIELD_HELP.checkpoint.tooltip}
            >
              <Activity className="h-4 w-4 mr-2" />
              CHECKPOINT
            </Button>
            <div className="flex items-center gap-2">
              <Input
                value={vacuumConfirm}
                onChange={(e) => setVacuumConfirm(e.target.value)}
                placeholder="Type VACUUM"
                className="w-36"
                title={GRIFT_FIELD_HELP.vacuumConfirm.tooltip}
              />
              <Button
                variant="outline"
                size="sm"
                className="bg-red-600 border-red-500 text-white hover:bg-red-700 hover:border-red-600"
                disabled={vacuumMutation.isPending || vacuumConfirm !== "VACUUM"}
                onClick={() => {
                  const ok = window.confirm("Run VACUUM now? This can be I/O heavy; prefer a maintenance window.");
                  if (!ok) return;
                  vacuumMutation.mutate();
                }}
                title={GRIFT_FIELD_HELP.vacuumRun.tooltip}
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                Run VACUUM
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-400">Database</div>
              <div className="font-mono text-xs">{dbStats?.database?.name ?? "—"}</div>
              <div className="text-xs text-gray-500">engine: {dbStats?.engine ?? "postgres"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Size</div>
              <div className="font-mono text-xs">{dbSizePretty}</div>
              <div className="text-xs text-gray-500">bytes: {formatBytes(dbStats?.database?.sizeBytes ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-400">Activity</div>
              <div className="text-xs text-gray-500">
                connections: {dbStats?.database?.stats?.numbackends ?? "—"} • commits:{" "}
                {dbStats?.database?.stats?.xact_commit ?? "—"}
              </div>
              <div className="text-xs text-gray-500">
                rollbacks: {dbStats?.database?.stats?.xact_rollback ?? "—"} • deadlocks:{" "}
                {dbStats?.database?.stats?.deadlocks ?? "—"}
              </div>
            </div>
          </div>

          {dbStats ? (
            <div className="text-xs text-gray-400">
              Database size: {dbSizePretty} • last checked: {formatTimestamp(dbStats.generatedAt)}
            </div>
          ) : (
            <div className="text-xs text-gray-400">No DB stats loaded yet.</div>
          )}

          <div className="rounded border border-neutral-700 bg-neutral-900 p-3 text-xs text-gray-400 space-y-1">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-300" />
              <span>Recommendation: VACUUM during low-traffic (this runs plain `VACUUM`, not `VACUUM FULL`).</span>
            </div>
            <div>Gold standard: run VACUUM only during a planned maintenance window and after a recent backup.</div>
            <div>CHECKPOINT can be useful after incident-level WAL churn, but it is not a space-reclamation tool.</div>
          </div>

          {vacuumResult?.before?.database?.sizeBytes != null && vacuumResult?.after?.database?.sizeBytes != null ? (
            <div className="rounded border border-neutral-700 bg-neutral-900 p-3 text-xs text-gray-300">
              <div className="font-semibold mb-1">Last VACUUM Result</div>
              <div>
                Before: {formatBytes(Number(vacuumResult.before.database.sizeBytes) || 0)} • After:{" "}
                {formatBytes(Number(vacuumResult.after.database.sizeBytes) || 0)}
              </div>
              <div>
                Reclaimed:{" "}
                {formatBytes(
                  Math.max(
                    0,
                    Number(vacuumResult.before.database.sizeBytes || 0) - Number(vacuumResult.after.database.sizeBytes || 0)
                  )
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {configGroups.map((group) => (
        <Card key={group.title} className="bg-neutral-800 border-neutral-700">
          <CardHeader>
            <FieldHintLabel label={group.title} hint={GRIFT_FIELD_HELP.config.tooltip} labelClassName="text-base" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.fields.map((field) => {
                const fieldHelp = resolveConfigFieldHelp(field.key, field.label);
                return (
                  <div key={field.key}>
                    <FieldHintLabel label={field.label} hint={fieldHelp.tooltip} labelClassName="text-sm" />
                    <p className="text-xs text-gray-400 mt-1">{fieldHelp.inline}</p>
                    {field.type === "boolean" ? (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="checkbox"
                          checked={!!config[field.key]}
                          onChange={(e) => handleChange(field.key, e.target.checked)}
                          className="h-5 w-5"
                          title={fieldHelp.tooltip}
                        />
                        <span className="text-sm text-gray-400">
                          {config[field.key] ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    ) : (
                      <Input
                        type="number"
                        value={config[field.key] as number}
                        onChange={(e) => handleChange(field.key, parseFloat(e.target.value) || 0)}
                        className="bg-neutral-700 border-neutral-600 mt-1"
                        title={fieldHelp.tooltip}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
