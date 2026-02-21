import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  formatUnixSecondsToLocaleString,
  localDateTimeInputToUnixSeconds as localDateTimeInputToUtcSec,
  unixSecondsToLocalDateTimeInput as utcSecToLocalDateTimeInput,
} from "@shared/time/format";

type AnyRow = Record<string, any>;
type InlineTemplateDraft = { profitTargetPct: string; maxDailyLossPct: string; durationDays: string };
const LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL = 100000;

const EMPTY_DRAFT = {
  name: "",
  description: "",
  category: "STANDARD",
  tier: "STARTER",
  slug: "",
  profitTargetPct: 0.1,
  maxDailyLossPct: 0.03,
  maxTotalLossPct: null as number | null,
  durationDays: 30,
  virtualCapitalUsd: LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL,
  capitalMode: "VIRTUAL" as "VIRTUAL" | "SNAPSHOT_EQUITY",
  leverageMultiplier: 1,
  maxRetriesPerTrader: 3,
  retryCooldownHours: 24,
  eligibilityGate: "EMAIL_VERIFIED",
  maxEnrollments: null as number | null,
  maxActiveEnrollments: null as number | null,
  startAt: null as number | null,
  endAt: null as number | null,
  enrollmentStartAt: null as number | null,
  enrollmentEndAt: null as number | null,
  featuredOrder: 0,
  tags: "",
  iconColor: "",
  prizePoolEnabled: false,
  prizePoolUsd: 0,
  prizeDistributionJson: "{}",
  prizeMinCompletions: 0,
  prizeAwardTiming: "ON_COMPLETE",
  badgesEnabled: false,
  badgeOnPass: "",
  badgeOnTop3: "",
  certificateEnabled: false,
  certificateDownloadable: true,
  certificateShareable: true,
  certificateTemplateId: null as number | null,
  certificateIncludeMetrics: true,
  selectionBoostEnabled: false,
  selectionBoostPoints: 0,
  partnerVisibilityOnPass: true,
  autoWatchlistTier: "",
  progressionTierId: null as number | null,
  customRewardJson: "{}",
  leaderboardEnabled: true,
  leaderboardAnonymize: false,
  leaderboardMaxVisible: 100,
  visibleToTraders: true,
  isActive: false,
  phases: [
    {
      phaseName: "Phase 1",
      profitTargetPct: 0.1,
      maxDailyLossPct: 0.03,
      maxTotalLossPct: null as number | null,
      drawdownType: "STATIC" as "STATIC" | "TRAILING",
      durationDays: 30,
      minTradingDays: 0,
    },
  ],
};

const EMPTY_BADGE = {
  id: 0,
  key: "",
  name: "",
  description: "",
  category: "CHALLENGE",
  iconEmoji: "",
  iconUrl: "",
  criteriaJson: "{}",
  isActive: true,
};

const EMPTY_CERT = {
  id: 0,
  name: "",
  headerText: "",
  bodyText: "",
  brandColor: "",
  logoUrl: "",
  includeMetrics: true,
  includeVerificationCode: true,
  isDownloadable: true,
  isShareable: true,
  isActive: true,
};

const EMPTY_TIER = {
  id: 0,
  name: "",
  description: "",
  tiersJson: "[]",
  isActive: true,
};

const DEFAULT_SETTINGS: Record<string, any> = {
  traderCompeteEnabled: false,
  challengeAutoAdvancePhase: true,
  challengeEvalIntervalMin: 60,
  challengeEvalMaxRows: 500,
  challengeEvaluationIntervalSec: 3600,
  challengeWarningThresholdPct: 0.8,
  challengeDefaultDrawdownType: "STATIC",
  challengeDefaultCapitalMode: "VIRTUAL",
  challengeDefaultMaxRetries: 3,
  challengeDefaultRetryCooldownHours: 24,
  challengeDefaultEligibility: "EMAIL_VERIFIED",
  challengeDefaultCategory: "STANDARD",
  challengeDefaultTier: "STARTER",
  challengeRewardsEnabled: true,
  challengePrizePoolsEnabled: true,
  challengeBadgesEnabled: true,
  challengeCertificatesEnabled: true,
  challengeCertificatesDownloadable: true,
  challengeCertificatesShareable: true,
  challengeSelectionBoostEnabled: true,
  challengeDefaultSelectionBoost: 0,
  challengeProgressionEnabled: true,
  challengeCustomRewardsEnabled: false,
  challengeNotifyOnEnroll: true,
  challengeNotifyOnPhaseWarning: true,
  challengeNotifyOnBreach: true,
  challengeNotifyOnPhasePass: true,
  challengeNotifyOnFail: true,
  challengeNotifyOnComplete: true,
  challengeNotifyOnBadgeAward: true,
  challengeNotifyOnPrizeAward: true,
  challengeNotifyOnCertIssue: true,
  challengeNotifyOnTierUp: true,
  challengeNotifyOnAdminAction: true,
  challengeNotifyViaMailbox: false,
  challengeMailboxCategory: "SYSTEM",
  challengeLeaderboardEnabled: true,
  challengeLeaderboardRefreshSec: 60,
  challengeLeaderboardSnapshotIntervalSec: 60,
  challengeLeaderboardRankingMetric: "COMPOSITE_SCORE",
  challengePrizeAwardTimingDefault: "ON_COMPLETE",
  challengePrizeCandidatesDefault: "PASSED_ONLY",
  challengeBreachPolicyDefault: "FAIL",
  challengeSingleDayProfitBasis: "PNL_PCT",
  challengeNewsBlackoutWindowsJson: "[]",
  challengeWeekendCutoffHours: 6,
  challengeForceCloseBeforeWeekend: false,
  challengeLeverageMultiplierDefault: 1,
  challengeMaxActiveEnrollmentsUser: 5,
  challengeMaxActiveEnrollmentsPerChallenge: 1,
  challengeCooldownHoursAfterFail: 24,
  challengeCooldownHoursAfterWithdraw: 12,
  challengeCertificateDefaultTemplateId: null as number | null,
  challengeCertificateIncludeMetricsDefault: true,
  challengeCertificateIncludeQrDefault: true,
  challengeCertificateVerificationKeyId: "v1",
  challengeAuditStrictMode: true,
  challengeAnomalyDetectionEnabled: true,
  challengeManualReviewEnabled: false,
  challengeManualReviewSuspiciousThreshold: 3,
};

const SYSTEM_TOGGLES = ["traderCompeteEnabled", "challengeAutoAdvancePhase", "challengeLeaderboardEnabled"];
const REWARD_TOGGLES = [
  "challengeRewardsEnabled",
  "challengePrizePoolsEnabled",
  "challengeBadgesEnabled",
  "challengeCertificatesEnabled",
  "challengeCertificatesDownloadable",
  "challengeCertificatesShareable",
  "challengeSelectionBoostEnabled",
  "challengeProgressionEnabled",
  "challengeCustomRewardsEnabled",
];
const NOTIFY_TOGGLES = [
  "challengeNotifyOnEnroll",
  "challengeNotifyOnPhaseWarning",
  "challengeNotifyOnBreach",
  "challengeNotifyOnPhasePass",
  "challengeNotifyOnFail",
  "challengeNotifyOnComplete",
  "challengeNotifyOnBadgeAward",
  "challengeNotifyOnPrizeAward",
  "challengeNotifyOnCertIssue",
  "challengeNotifyOnTierUp",
  "challengeNotifyOnAdminAction",
  "challengeNotifyViaMailbox",
];
const CONTROL_TOGGLES = [
  "challengeForceCloseBeforeWeekend",
  "challengeCertificateIncludeMetricsDefault",
  "challengeCertificateIncludeQrDefault",
  "challengeAuditStrictMode",
  "challengeAnomalyDetectionEnabled",
  "challengeManualReviewEnabled",
];
const ELIGIBILITY_GATE_MODES = new Set(["NONE", "EMAIL_VERIFIED", "CONTENDER", "ADMIN_APPROVED"]);
const HOVER_HINT_SELECTOR = "input,select,textarea,button,[role='switch']";

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value: unknown, fallback = 0): number {
  return Math.trunc(toNum(value, fallback));
}

function toOptNum(value: string): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function toOptInt(value: string): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isEligibilityGateValid(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return true;
  if (ELIGIBILITY_GATE_MODES.has(text.toUpperCase())) return true;
  try {
    const parsed = JSON.parse(text);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function formatPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function normalizeHintText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isArchivedTemplateRow(row: AnyRow): boolean {
  const isActive = Boolean(row.isActive ?? row.is_active);
  const visibleToTraders = Boolean(row.visibleToTraders ?? row.visible_to_traders);
  return !isActive && !visibleToTraders;
}

function buildInlineTemplateDraft(row: AnyRow): InlineTemplateDraft {
  return {
    profitTargetPct: String(toNum(row.profit_target_pct ?? row.profitTargetPct, 0.1)),
    maxDailyLossPct: String(toNum(row.max_daily_loss_pct ?? row.maxDailyLossPct, 0.03)),
    durationDays: String(Math.max(1, toInt(row.duration_days ?? row.durationDays, 30))),
  };
}

function isInlineTemplateDraftEqual(left: InlineTemplateDraft, right: InlineTemplateDraft): boolean {
  return (
    left.profitTargetPct === right.profitTargetPct &&
    left.maxDailyLossPct === right.maxDailyLossPct &&
    left.durationDays === right.durationDays
  );
}

function toChallengeListRowPatch(row: AnyRow): AnyRow {
  const profitTargetPct = row.profitTargetPct ?? row.profit_target_pct;
  const maxDailyLossPct = row.maxDailyLossPct ?? row.max_daily_loss_pct;
  const durationDays = row.durationDays ?? row.duration_days;
  const isActive = Boolean(row.isActive ?? row.is_active);
  const visibleToTraders = Boolean(row.visibleToTraders ?? row.visible_to_traders);
  return {
    ...row,
    profitTargetPct,
    profit_target_pct: profitTargetPct,
    maxDailyLossPct,
    max_daily_loss_pct: maxDailyLossPct,
    durationDays,
    duration_days: durationDays,
    isActive,
    is_active: isActive,
    visibleToTraders,
    visible_to_traders: visibleToTraders,
    updatedAt: row.updatedAt ?? row.updated_at,
    updated_at: row.updatedAt ?? row.updated_at,
  };
}

function inferHoverHint(control: HTMLElement): string {
  const explicit = normalizeHintText(control.getAttribute("data-hint"));
  if (explicit) return explicit;

  const ariaLabel = normalizeHintText(control.getAttribute("aria-label"));
  if (ariaLabel) return ariaLabel;

  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    const placeholder = normalizeHintText(control.getAttribute("placeholder"));
    if (placeholder) return placeholder;
  }

  const parentLabel = control.closest("label");
  if (parentLabel) {
    const labelText = normalizeHintText(parentLabel.textContent);
    if (labelText) return labelText;
  }

  if (control instanceof HTMLSelectElement) {
    const currentOption = normalizeHintText(control.selectedOptions?.[0]?.textContent);
    if (currentOption) return `Select value (${currentOption})`;
    return "Select value";
  }

  if (control instanceof HTMLButtonElement) {
    const buttonText = normalizeHintText(control.textContent);
    if (buttonText) return buttonText;
  }

  const groupedLabel = control.parentElement?.querySelector<HTMLElement>(":scope > .text-xs, :scope > .text-sm, :scope > span");
  const groupedLabelText = normalizeHintText(groupedLabel?.textContent);
  if (groupedLabelText) return groupedLabelText;

  return "";
}

function applyHoverHints(root: HTMLElement): void {
  const controls = root.querySelectorAll<HTMLElement>(HOVER_HINT_SELECTOR);
  controls.forEach((control) => {
    if (control.getAttribute("data-skip-auto-hint") === "true") return;
    if (normalizeHintText(control.getAttribute("title"))) return;
    const hint = inferHoverHint(control);
    if (!hint) return;
    control.setAttribute("title", hint);
    if (!control.getAttribute("aria-label")) {
      control.setAttribute("aria-label", hint);
    }
  });
}

function formatUsd(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString()}`;
}

function formatWhen(utcSec: unknown): string {
  return formatUnixSecondsToLocaleString(Number(utcSec));
}

function statusVariant(status: unknown): "default" | "secondary" | "destructive" | "outline" {
  const s = String(status || "").toUpperCase();
  if (s === "PASSED" || s === "COMPLETED") return "default";
  if (s === "FAILED" || s === "DISQUALIFIED") return "destructive";
  if (s === "REVIEW_REQUIRED") return "outline";
  if (s === "ACTIVE") return "secondary";
  return "outline";
}

function daysLeftLabel(endAtSec: number): string {
  const delta = endAtSec - Math.floor(Date.now() / 1000);
  if (delta <= 0) return "Expired";
  const d = Math.floor(delta / 86400);
  const h = Math.floor((delta % 86400) / 3600);
  return `${d}d ${h}h`;
}

function mapDetailToDraft(detail: AnyRow, defaultChallengeVirtualCapitalUsd = LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL): typeof EMPTY_DRAFT {
  const row = detail.row || {};
  const phases = Array.isArray(detail.phases) && detail.phases.length
    ? detail.phases
        .slice()
        .sort((a: AnyRow, b: AnyRow) => toInt(a.phaseNumber, 1) - toInt(b.phaseNumber, 1))
        .map((p: AnyRow) => ({
          phaseName: String(p.phaseName || `Phase ${p.phaseNumber || 1}`),
          profitTargetPct: toNum(p.profitTargetPct, 0.1),
          maxDailyLossPct: toNum(p.maxDailyLossPct, 0.03),
          maxTotalLossPct: p.maxTotalLossPct == null ? null : toNum(p.maxTotalLossPct, 0),
          drawdownType: (String(p.drawdownType || "STATIC") === "TRAILING" ? "TRAILING" : "STATIC") as "STATIC" | "TRAILING",
          durationDays: Math.max(1, toInt(p.durationDays, 30)),
          minTradingDays: Math.max(0, toInt(p.minTradingDays, 0)),
        }))
    : EMPTY_DRAFT.phases;

  return {
    ...EMPTY_DRAFT,
    name: String(row.name || ""),
    description: String(row.description || ""),
    category: String(row.category || "STANDARD"),
    tier: String(row.tier || "STARTER"),
    slug: String(row.slug || ""),
    profitTargetPct: toNum(row.profitTargetPct, 0.1),
    maxDailyLossPct: toNum(row.maxDailyLossPct, 0.03),
    maxTotalLossPct: row.maxTotalLossPct == null ? null : toNum(row.maxTotalLossPct, 0),
    durationDays: Math.max(1, toInt(row.durationDays, 30)),
    virtualCapitalUsd: Math.max(1, toNum(row.virtualCapitalUsd, defaultChallengeVirtualCapitalUsd)),
    capitalMode: String(row.capitalMode) === "SNAPSHOT_EQUITY" ? "SNAPSHOT_EQUITY" : "VIRTUAL",
    leverageMultiplier: Math.max(0.1, toNum(row.leverageMultiplier, 1)),
    maxRetriesPerTrader: Math.max(0, toInt(row.maxRetriesPerTrader, 0)),
    retryCooldownHours: Math.max(0, toInt(row.retryCooldownHours, 0)),
    eligibilityGate: String(row.eligibilityGate || "{}"),
    maxEnrollments: row.maxEnrollments == null ? null : Math.max(1, toInt(row.maxEnrollments, 1)),
    maxActiveEnrollments: row.maxActiveEnrollments == null ? null : Math.max(1, toInt(row.maxActiveEnrollments, 1)),
    startAt: row.startAt == null ? null : Math.max(0, toInt(row.startAt, 0)),
    endAt: row.endAt == null ? null : Math.max(0, toInt(row.endAt, 0)),
    enrollmentStartAt: row.enrollmentStartAt == null ? null : Math.max(0, toInt(row.enrollmentStartAt, 0)),
    enrollmentEndAt: row.enrollmentEndAt == null ? null : Math.max(0, toInt(row.enrollmentEndAt, 0)),
    featuredOrder: Math.max(0, toInt(row.featuredOrder, 0)),
    tags: String(row.tags || ""),
    iconColor: String(row.iconColor || ""),
    prizePoolEnabled: Boolean(row.prizePoolEnabled),
    prizePoolUsd: Math.max(0, toNum(row.prizePoolUsd, 0)),
    prizeDistributionJson: String(row.prizeDistributionJson || "{}"),
    prizeMinCompletions: Math.max(0, toInt(row.prizeMinCompletions, 0)),
    prizeAwardTiming: String(row.prizeAwardTiming || "ON_COMPLETE"),
    badgesEnabled: Boolean(row.badgesEnabled),
    badgeOnPass: String(row.badgeOnPass || ""),
    badgeOnTop3: String(row.badgeOnTop3 || ""),
    certificateEnabled: Boolean(row.certificateEnabled),
    certificateDownloadable: Boolean(row.certificateDownloadable ?? true),
    certificateShareable: Boolean(row.certificateShareable ?? true),
    certificateTemplateId: row.certificateTemplateId == null ? null : toInt(row.certificateTemplateId, 0),
    certificateIncludeMetrics: Boolean(row.certificateIncludeMetrics ?? true),
    selectionBoostEnabled: Boolean(row.selectionBoostEnabled),
    selectionBoostPoints: Math.max(0, toNum(row.selectionBoostPoints, 0)),
    partnerVisibilityOnPass: Boolean(row.partnerVisibilityOnPass ?? true),
    autoWatchlistTier: String(row.autoWatchlistTier || ""),
    progressionTierId: row.progressionTierId == null ? null : toInt(row.progressionTierId, 0),
    customRewardJson: String(row.customRewardJson || "{}"),
    leaderboardEnabled: Boolean(row.leaderboardEnabled ?? true),
    leaderboardAnonymize: Boolean(row.leaderboardAnonymize),
    leaderboardMaxVisible: Math.max(1, toInt(row.leaderboardMaxVisible, 100)),
    visibleToTraders: Boolean(row.visibleToTraders ?? row.visible_to_traders ?? true),
    isActive: Boolean(row.isActive ?? row.is_active),
    phases,
  };
}

export default function ScoutChallengesPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [subTab, setSubTab] = useState("templates");
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [virtualCapitalTouched, setVirtualCapitalTouched] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AnyRow | null>(null);
  const [inlineDraftById, setInlineDraftById] = useState<Record<number, InlineTemplateDraft>>({});
  const [lastArchivedId, setLastArchivedId] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [enrollFilters, setEnrollFilters] = useState({ challengeId: "", status: "", phase: "", userId: "", fromDate: "" });
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | null>(null);
  const [overrideStatus, setOverrideStatus] = useState("ACTIVE");
  const [overrideReason, setOverrideReason] = useState("");
  const [overridePhase, setOverridePhase] = useState("1");
  const [extendDays, setExtendDays] = useState("3");
  const [extendReason, setExtendReason] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [notifyDraft, setNotifyDraft] = useState({ title: "Challenge update", message: "", severity: "INFO", sendMailbox: true });

  const [settingsDraft, setSettingsDraft] = useState<Record<string, any>>({ ...DEFAULT_SETTINGS });
  const [badgeDraft, setBadgeDraft] = useState({ ...EMPTY_BADGE });
  const [certDraft, setCertDraft] = useState({ ...EMPTY_CERT });
  const [tierDraft, setTierDraft] = useState({ ...EMPTY_TIER });
  const [prizeChallengeFilter, setPrizeChallengeFilter] = useState("");

  const templatesQuery = useQuery<{ rows: AnyRow[] }>({
    queryKey: ["/api/admin/challenges"],
    queryFn: () => axios.get("/api/admin/challenges").then((r) => r.data),
    refetchOnWindowFocus: false,
  });

  const templateDetailQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/detail", expandedId],
    queryFn: () => axios.get(`/api/admin/challenges/${expandedId}`).then((r) => r.data),
    enabled: expandedId != null,
    refetchOnWindowFocus: false,
  });

  const globalSettingsQuery = useQuery<any>({
    queryKey: ["/api/admin/global-settings"],
    queryFn: () => axios.get("/api/admin/global-settings").then((r) => r.data),
    refetchOnWindowFocus: false,
  });

  const defaultChallengeVirtualCapitalUsd = useMemo(() => {
    const raw = Number(globalSettingsQuery.data?.defaultChallengeVirtualCapitalUsd);
    if (!Number.isFinite(raw) || raw <= 0) return LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL;
    return raw;
  }, [globalSettingsQuery.data?.defaultChallengeVirtualCapitalUsd]);

  const enrollmentsQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/enrollments", enrollFilters.challengeId, enrollFilters.status, enrollFilters.phase, enrollFilters.userId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "200");
      params.set("offset", "0");
      if (enrollFilters.challengeId.trim()) params.set("challengeId", enrollFilters.challengeId.trim());
      if (enrollFilters.status.trim()) params.set("status", enrollFilters.status.trim().toUpperCase());
      if (enrollFilters.phase.trim()) params.set("phase", enrollFilters.phase.trim());
      if (enrollFilters.userId.trim()) params.set("userId", enrollFilters.userId.trim());
      return axios.get(`/api/admin/challenges/enrollments?${params.toString()}`).then((r) => r.data);
    },
    enabled: subTab === "enrollments",
    refetchOnWindowFocus: false,
  });

  const enrollmentDetailQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/enrollment/detail", selectedEnrollmentId],
    queryFn: () => axios.get(`/api/admin/challenges/enrollments/${selectedEnrollmentId}`).then((r) => r.data),
    enabled: subTab === "enrollments" && selectedEnrollmentId != null,
    refetchOnWindowFocus: false,
  });

  const summaryQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/summary"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/summary").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const funnelQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/funnel"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/funnel").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const passFailTrendQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/pass-fail-trend"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/pass-fail-trend").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const breachDistributionQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/breach-distribution"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/breach-distribution").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const topPerformersQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/top-performers"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/top-performers").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const popularityQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/popularity"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/popularity").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const rewardDistributionQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/analytics/reward-distribution"],
    queryFn: () => axios.get("/api/admin/challenges/analytics/reward-distribution").then((r) => r.data),
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const prizesQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/prizes", prizeChallengeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (prizeChallengeFilter.trim()) params.set("challengeId", prizeChallengeFilter.trim());
      return axios.get(`/api/admin/challenges/prizes?${params.toString()}`).then((r) => r.data);
    },
    enabled: subTab === "analytics",
    refetchOnWindowFocus: false,
  });

  const settingsQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/settings"],
    queryFn: () => axios.get("/api/admin/challenges/settings").then((r) => r.data),
    enabled: subTab === "settings",
    refetchOnWindowFocus: false,
  });

  const badgesQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/badges"],
    queryFn: () => axios.get("/api/admin/challenges/badges").then((r) => r.data),
    enabled: subTab === "settings",
    refetchOnWindowFocus: false,
  });

  const certTemplatesQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/certificate-templates"],
    queryFn: () => axios.get("/api/admin/challenges/certificate-templates").then((r) => r.data),
    enabled: subTab === "settings",
    refetchOnWindowFocus: false,
  });

  const tiersQuery = useQuery<any>({
    queryKey: ["/api/admin/challenges/progression-tiers"],
    queryFn: () => axios.get("/api/admin/challenges/progression-tiers").then((r) => r.data),
    enabled: subTab === "settings",
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!settingsQuery.data?.settings) return;
    setSettingsDraft({ ...DEFAULT_SETTINGS, ...settingsQuery.data.settings });
  }, [settingsQuery.data?.settings]);

  useEffect(() => {
    if (!editingId || !templateDetailQuery.data?.row) return;
    setDraft(mapDetailToDraft(templateDetailQuery.data, defaultChallengeVirtualCapitalUsd));
    setVirtualCapitalTouched(true);
  }, [editingId, templateDetailQuery.data?.row, templateDetailQuery.data?.phases, defaultChallengeVirtualCapitalUsd]);

  useEffect(() => {
    if (editingId) return;
    if (virtualCapitalTouched) return;
    if (Number(draft.virtualCapitalUsd) !== LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL) return;
    if (defaultChallengeVirtualCapitalUsd === LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL) return;
    setDraft((prev) => ({ ...prev, virtualCapitalUsd: defaultChallengeVirtualCapitalUsd }));
  }, [
    draft.virtualCapitalUsd,
    editingId,
    virtualCapitalTouched,
    defaultChallengeVirtualCapitalUsd,
  ]);

  useEffect(() => {
    if (selectedEnrollmentId) return;
    const first = enrollmentsQuery.data?.rows?.[0]?.id;
    if (Number(first) > 0) setSelectedEnrollmentId(Number(first));
  }, [selectedEnrollmentId, enrollmentsQuery.data?.rows]);

  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    const syncHints = () => applyHoverHints(root);
    syncHints();
    const observer = new MutationObserver(() => syncHints());
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const createTemplateMutation = useMutation({
    mutationFn: (payload: AnyRow) => axios.post("/api/admin/challenges", payload).then((r) => r.data),
    onSuccess: () => {
      setDraft({ ...EMPTY_DRAFT, virtualCapitalUsd: defaultChallengeVirtualCapitalUsd });
      setVirtualCapitalTouched(false);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges"] });
      toast({ title: "Challenge template created" });
    },
    onError: (error: any) => toast({ title: "Failed to create challenge", description: error?.response?.data?.message || "Unknown error", variant: "destructive" }),
  });

  const updateTemplateMutation = useMutation({
    mutationFn: (payload: { id: number; patch: AnyRow }) => axios.put(`/api/admin/challenges/${payload.id}`, payload.patch).then((r) => r.data),
    onSuccess: (data, vars) => {
      const updatedRow = data?.row ? toChallengeListRowPatch(data.row) : null;
      const patchedPhases = Array.isArray(vars.patch?.phases) ? vars.patch.phases : null;
      if (updatedRow) {
        queryClient.setQueryData(["/api/admin/challenges"], (prev: any) => {
          if (!prev || !Array.isArray(prev.rows)) return prev;
          return {
            ...prev,
            rows: prev.rows.map((row: AnyRow) =>
              Number(row.id) === Number(vars.id) ? { ...row, ...updatedRow } : row,
            ),
          };
        });
        queryClient.setQueryData(["/api/admin/challenges/detail", vars.id], (prev: any) => {
          if (!prev || typeof prev !== "object") return prev;
          return {
            ...prev,
            row: { ...(prev.row ?? {}), ...updatedRow, ...data.row },
            phases: patchedPhases ?? prev.phases,
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/detail", vars.id] });
      toast({ title: "Challenge template updated" });
    },
  });

  const duplicateTemplateMutation = useMutation({
    mutationFn: (id: number) => axios.post(`/api/admin/challenges/${id}/duplicate`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges"] });
      toast({ title: "Challenge duplicated" });
    },
  });

  const archiveTemplateMutation = useMutation({
    mutationFn: (id: number) => axios.put(`/api/admin/challenges/${id}/archive`).then((r) => r.data),
    onSuccess: (_data, id) => {
      setLastArchivedId(id);
      setSubTab("archive");
      setExpandedId((prev) => (prev === id ? null : prev));
      setEditingId((prev) => (prev === id ? null : prev));
      setInlineDraftById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges"] });
      toast({ title: "Challenge archived and moved to Archive tab" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/admin/challenges/${id}`).then((r) => r.data),
    onSuccess: (_data, id) => {
      setDeleteTarget(null);
      setExpandedId((prev) => (prev === id ? null : prev));
      setEditingId((prev) => (prev === id ? null : prev));
      setInlineDraftById((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges"] });
      toast({ title: "Challenge deleted" });
    },
  });

  const enrollmentActionMutation = useMutation({
    mutationFn: async (input: { type: string; enrollmentId: number; data: AnyRow }) => {
      if (input.type === "OVERRIDE") return axios.put(`/api/admin/challenges/enrollments/${input.enrollmentId}/override`, input.data).then((r) => r.data);
      if (input.type === "EXTEND") return axios.put(`/api/admin/challenges/enrollments/${input.enrollmentId}/extend`, input.data).then((r) => r.data);
      if (input.type === "ADVANCE") return axios.put(`/api/admin/challenges/enrollments/${input.enrollmentId}/advance`, input.data).then((r) => r.data);
      if (input.type === "RESET") return axios.put(`/api/admin/challenges/enrollments/${input.enrollmentId}/reset`, input.data).then((r) => r.data);
      if (input.type === "DISQUALIFY") return axios.put(`/api/admin/challenges/enrollments/${input.enrollmentId}/disqualify`, input.data).then((r) => r.data);
      return axios.post(`/api/admin/challenges/enrollments/${input.enrollmentId}/action`, input.data).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/enrollments"] });
      if (selectedEnrollmentId) queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/enrollment/detail", selectedEnrollmentId] });
      toast({ title: "Enrollment action applied" });
    },
  });

  const enrollmentNotifyMutation = useMutation({
    mutationFn: (input: { enrollmentId: number; title: string; message: string; severity: string; sendMailbox: boolean }) =>
      axios.post(`/api/admin/challenges/enrollments/${input.enrollmentId}/notify`, input).then((r) => r.data),
    onSuccess: () => toast({ title: "Trader notification sent" }),
  });

  const prizeActionMutation = useMutation({
    mutationFn: (input: { id: number; action: "APPROVE" | "PAID" | "CANCEL"; note?: string }) =>
      axios.put(`/api/admin/challenges/prizes/${input.id}/approve`, input).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/prizes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/analytics/summary"] });
      toast({ title: "Prize updated" });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: AnyRow) => axios.put("/api/admin/challenges/settings", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/settings"] });
      toast({ title: "Challenge settings saved" });
    },
  });

  const upsertBadgeMutation = useMutation({
    mutationFn: (payload: AnyRow) => {
      const body = {
        key: payload.key.trim(),
        name: payload.name.trim(),
        description: payload.description.trim() || null,
        category: payload.category.trim() || "CHALLENGE",
        iconEmoji: payload.iconEmoji.trim() || null,
        iconUrl: payload.iconUrl.trim() || null,
        criteriaJson: payload.criteriaJson.trim() || "{}",
        isActive: Boolean(payload.isActive),
      };
      return payload.id > 0
        ? axios.put(`/api/admin/challenges/badges/${payload.id}`, body).then((r) => r.data)
        : axios.post("/api/admin/challenges/badges", body).then((r) => r.data);
    },
    onSuccess: () => {
      setBadgeDraft({ ...EMPTY_BADGE });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/badges"] });
    },
  });

  const deleteBadgeMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/admin/challenges/badges/${id}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/badges"] }),
  });

  const upsertCertMutation = useMutation({
    mutationFn: (payload: AnyRow) => {
      const body = {
        name: payload.name.trim(),
        headerText: payload.headerText,
        bodyText: payload.bodyText,
        brandColor: payload.brandColor.trim() || null,
        logoUrl: payload.logoUrl.trim() || null,
        includeMetrics: Boolean(payload.includeMetrics),
        includeVerificationCode: Boolean(payload.includeVerificationCode),
        isDownloadable: Boolean(payload.isDownloadable),
        isShareable: Boolean(payload.isShareable),
        isActive: Boolean(payload.isActive),
      };
      return payload.id > 0
        ? axios.put(`/api/admin/challenges/certificate-templates/${payload.id}`, body).then((r) => r.data)
        : axios.post("/api/admin/challenges/certificate-templates", body).then((r) => r.data);
    },
    onSuccess: () => {
      setCertDraft({ ...EMPTY_CERT });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/certificate-templates"] });
    },
  });

  const deleteCertMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/admin/challenges/certificate-templates/${id}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/certificate-templates"] }),
  });

  const upsertTierMutation = useMutation({
    mutationFn: (payload: AnyRow) => {
      const body = {
        name: payload.name.trim(),
        description: payload.description.trim() || null,
        tiersJson: payload.tiersJson.trim() || "[]",
        isActive: Boolean(payload.isActive),
      };
      return payload.id > 0
        ? axios.put(`/api/admin/challenges/progression-tiers/${payload.id}`, body).then((r) => r.data)
        : axios.post("/api/admin/challenges/progression-tiers", body).then((r) => r.data);
    },
    onSuccess: () => {
      setTierDraft({ ...EMPTY_TIER });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/progression-tiers"] });
    },
  });

  const deleteTierMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/admin/challenges/progression-tiers/${id}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/progression-tiers"] }),
  });

  const challengeRows = useMemo(() => (templatesQuery.data?.rows ?? []) as AnyRow[], [templatesQuery.data?.rows]);
  const templates = useMemo(() => challengeRows.filter((row) => !isArchivedTemplateRow(row)), [challengeRows]);
  const archivedTemplates = useMemo(() => challengeRows.filter((row) => isArchivedTemplateRow(row)), [challengeRows]);
  const challengeMap = useMemo(() => new Map(challengeRows.map((row) => [Number(row.id), row])), [challengeRows]);

  useEffect(() => {
    const validIds = new Set(challengeRows.map((row) => Number(row.id)));
    setInlineDraftById((prev) => {
      let changed = false;
      const next: Record<number, InlineTemplateDraft> = {};
      for (const [rawId, draftRow] of Object.entries(prev)) {
        const id = Number(rawId);
        if (validIds.has(id)) {
          next[id] = draftRow;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [challengeRows]);

  const rows = (enrollmentsQuery.data?.rows ?? []) as AnyRow[];
  const fromUtc = enrollFilters.fromDate ? Math.floor(Date.parse(`${enrollFilters.fromDate}T00:00:00Z`) / 1000) : 0;
  const enrollmentRows = fromUtc > 0 ? rows.filter((row) => toInt(row.enrolled_at, 0) >= fromUtc) : rows;

  const selectedEnrollment = enrollmentDetailQuery.data?.enrollment as AnyRow | undefined;
  const selectedChallenge = enrollmentDetailQuery.data?.challenge as AnyRow | undefined;
  const selectedPhases = (enrollmentDetailQuery.data?.phases ?? []) as AnyRow[];
  const selectedEvents = (enrollmentDetailQuery.data?.events ?? []) as AnyRow[];
  const selectedTrades = (enrollmentDetailQuery.data?.trades ?? []) as AnyRow[];

  const payload = {
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    category: draft.category.trim() || "STANDARD",
    tier: draft.tier.trim() || "STARTER",
    slug: draft.slug.trim() || null,
    maxTotalLossPct: draft.maxTotalLossPct,
    eligibilityGate: draft.eligibilityGate.trim() || "{}",
    maxEnrollments: draft.maxEnrollments,
    maxActiveEnrollments: draft.maxActiveEnrollments,
    startAt: draft.startAt,
    endAt: draft.endAt,
    enrollmentStartAt: draft.enrollmentStartAt,
    enrollmentEndAt: draft.enrollmentEndAt,
    featuredOrder: Math.max(0, toInt(draft.featuredOrder, 0)),
    tags: draft.tags.trim(),
    iconColor: draft.iconColor.trim() || null,
    badgeOnPass: draft.badgeOnPass.trim() || null,
    badgeOnTop3: draft.badgeOnTop3.trim() || null,
    prizeMinCompletions: Math.max(0, toInt(draft.prizeMinCompletions, 0)),
    prizeAwardTiming: draft.prizeAwardTiming,
    certificateTemplateId: draft.certificateTemplateId,
    certificateIncludeMetrics: Boolean(draft.certificateIncludeMetrics),
    progressionTierId: draft.progressionTierId,
    partnerVisibilityOnPass: Boolean(draft.partnerVisibilityOnPass),
    autoWatchlistTier: draft.autoWatchlistTier ? draft.autoWatchlistTier : null,
    customRewardJson: draft.customRewardJson.trim() || "{}",
    prizeDistributionJson: draft.prizeDistributionJson.trim() || "{}",
    phases: draft.phases.slice(0, 3).map((phase, idx) => ({
      phaseNumber: idx + 1,
      phaseName: phase.phaseName.trim() || `Phase ${idx + 1}`,
      profitTargetPct: toNum(phase.profitTargetPct, draft.profitTargetPct),
      maxDailyLossPct: toNum(phase.maxDailyLossPct, draft.maxDailyLossPct),
      maxTotalLossPct: phase.maxTotalLossPct == null ? null : toNum(phase.maxTotalLossPct, 0),
      drawdownType: phase.drawdownType,
      durationDays: Math.max(1, toInt(phase.durationDays, draft.durationDays)),
      minTradingDays: Math.max(0, toInt(phase.minTradingDays, 0)),
    })),
  };

  const saveTemplate = async () => {
    if (!payload.name || payload.name.length < 3) {
      toast({ title: "Challenge name must be at least 3 chars", variant: "destructive" });
      return;
    }
    if (!isEligibilityGateValid(payload.eligibilityGate || "")) {
      toast({ title: "Eligibility gate must be a valid mode or JSON object", variant: "destructive" });
      return;
    }
    try {
      JSON.parse(payload.prizeDistributionJson || "{}");
      JSON.parse(payload.customRewardJson || "{}");
    } catch {
      toast({ title: "JSON field is invalid", variant: "destructive" });
      return;
    }
    if (editingId) {
      await updateTemplateMutation.mutateAsync({ id: editingId, patch: payload });
    } else {
      await createTemplateMutation.mutateAsync(payload);
    }
  };

  const setInlineField = (row: AnyRow, field: keyof InlineTemplateDraft, value: string) => {
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) return;
    const baseline = buildInlineTemplateDraft(row);
    setInlineDraftById((prev) => {
      const nextDraft = { ...(prev[id] ?? baseline), [field]: value };
      if (isInlineTemplateDraftEqual(nextDraft, baseline)) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: nextDraft };
    });
  };

  const resetInlineDraft = (id: number) => {
    setInlineDraftById((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const saveInlineDraft = async (row: AnyRow) => {
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) return;
    const baseline = buildInlineTemplateDraft(row);
    const input = inlineDraftById[id] ?? baseline;
    const patch: AnyRow = {
      profitTargetPct: Math.max(0, Math.min(10, toNum(input.profitTargetPct, toNum(baseline.profitTargetPct, 0.1)))),
      maxDailyLossPct: Math.max(0, Math.min(10, toNum(input.maxDailyLossPct, toNum(baseline.maxDailyLossPct, 0.03)))),
      durationDays: Math.max(1, Math.min(365, toInt(input.durationDays, toInt(baseline.durationDays, 30)))),
    };

    const detailCache = queryClient.getQueryData(["/api/admin/challenges/detail", id]) as AnyRow | undefined;
    const existingPhases = Array.isArray(detailCache?.phases) ? detailCache.phases : [];
    if (existingPhases.length > 0) {
      const normalized = existingPhases
        .map((phase: AnyRow, idx: number) => ({
          phaseNumber: Math.max(1, toInt(phase.phaseNumber ?? phase.phase_number, idx + 1)),
          phaseName: String(phase.phaseName ?? phase.phase_name ?? `Phase ${idx + 1}`),
          profitTargetPct: toNum(phase.profitTargetPct ?? phase.profit_target_pct, patch.profitTargetPct),
          maxDailyLossPct: toNum(phase.maxDailyLossPct ?? phase.max_daily_loss_pct, patch.maxDailyLossPct),
          maxTotalLossPct: phase.maxTotalLossPct ?? phase.max_total_loss_pct ?? null,
          drawdownType: String(phase.drawdownType ?? phase.drawdown_type ?? "STATIC"),
          durationDays: Math.max(1, toInt(phase.durationDays ?? phase.duration_days, patch.durationDays)),
          minTradingDays: phase.minTradingDays ?? phase.min_trading_days ?? null,
          maxSingleDayProfitPct: phase.maxSingleDayProfitPct ?? phase.max_single_day_profit_pct ?? null,
          allowWeekendHolding: phase.allowWeekendHolding ?? phase.allow_weekend_holding ?? true,
          allowNewsTrading: phase.allowNewsTrading ?? phase.allow_news_trading ?? true,
          restrictedSymbolsCsv: String(phase.restrictedSymbolsCsv ?? phase.restricted_symbols_csv ?? ""),
          maxConcurrentPositions: phase.maxConcurrentPositions ?? phase.max_concurrent_positions ?? null,
          maxLotSize: phase.maxLotSize ?? phase.max_lot_size ?? null,
        }))
        .sort((a, b) => a.phaseNumber - b.phaseNumber);

      const firstPhaseIdx = normalized.findIndex((phase) => phase.phaseNumber === 1);
      const phaseIndex = firstPhaseIdx >= 0 ? firstPhaseIdx : 0;
      if (normalized[phaseIndex]) {
        normalized[phaseIndex] = {
          ...normalized[phaseIndex],
          profitTargetPct: patch.profitTargetPct,
          maxDailyLossPct: patch.maxDailyLossPct,
          durationDays: patch.durationDays,
        };
      }
      patch.phases = normalized;
    }

    await updateTemplateMutation.mutateAsync({ id, patch });
    resetInlineDraft(id);

    if (editingId === id) {
      setDraft((prev) => ({
        ...prev,
        profitTargetPct: patch.profitTargetPct,
        maxDailyLossPct: patch.maxDailyLossPct,
        durationDays: patch.durationDays,
      }));
    }
  };

  const currentPhase = toInt(selectedEnrollment?.currentPhase ?? selectedEnrollment?.current_phase, 1);
  const phase = selectedPhases.find((item) => toInt(item.phaseNumber, 0) === currentPhase);
  const pnlTarget = toNum(phase?.profitTargetPct ?? selectedChallenge?.profitTargetPct, 0.1);
  const dailyTarget = toNum(phase?.maxDailyLossPct ?? selectedChallenge?.maxDailyLossPct, 0.03);
  const totalTarget = toNum(phase?.maxTotalLossPct ?? selectedChallenge?.maxTotalLossPct, 0);

  return (
    <Card className="bg-neutral-800 border-gray-700" data-testid="admin-challenges-panel">
      <CardHeader>
        <CardTitle className="text-base">Challenges System</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" ref={panelRef}>
        <Tabs value={subTab} onValueChange={setSubTab} className="space-y-3">
          <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-5 gap-1">
            <TabsTrigger value="templates" className="data-[state=active]:bg-neutral-600 text-xs">Templates</TabsTrigger>
            <TabsTrigger value="enrollments" className="data-[state=active]:bg-neutral-600 text-xs">Enrollments</TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-neutral-600 text-xs">Analytics</TabsTrigger>
            <TabsTrigger value="archive" className="data-[state=active]:bg-neutral-600 text-xs">Archive</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-neutral-600 text-xs">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-3">
            <Card className="bg-neutral-900/50 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{editingId ? `Edit Template #${editingId}` : "Create Template"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                  <Input
                    placeholder="Name"
                    value={draft.name}
                    onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600 md:col-span-2"
                  />
                  <Input
                    placeholder="Slug"
                    value={draft.slug}
                    onChange={(e) => setDraft((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Input
                    placeholder="Category"
                    value={draft.category}
                    onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Input
                    placeholder="Tier"
                    value={draft.tier}
                    onChange={(e) => setDraft((p) => ({ ...p, tier: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Input
                    placeholder="Icon Color (#hex)"
                    value={draft.iconColor}
                    onChange={(e) => setDraft((p) => ({ ...p, iconColor: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input
                    placeholder="Tags (csv)"
                    value={draft.tags}
                    onChange={(e) => setDraft((p) => ({ ...p, tags: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600 md:col-span-2"
                  />
                  <select
                    value={draft.capitalMode}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, capitalMode: e.target.value === "SNAPSHOT_EQUITY" ? "SNAPSHOT_EQUITY" : "VIRTUAL" }))
                    }
                    data-hint="Capital mode"
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="VIRTUAL">VIRTUAL</option>
                    <option value="SNAPSHOT_EQUITY">TRADER_EQUITY</option>
                  </select>
                  <Input
                    type="number"
                    step="0.1"
                    value={draft.leverageMultiplier}
                    onChange={(e) => setDraft((p) => ({ ...p, leverageMultiplier: Math.max(0.1, toNum(e.target.value, p.leverageMultiplier)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Leverage multiplier"
                  />
                </div>
                <Textarea
                  placeholder="Description"
                  value={draft.description}
                  onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                  className="bg-neutral-700 border-neutral-600 min-h-[70px]"
                />
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                  <Input type="number" step="0.01" value={draft.profitTargetPct} onChange={(e) => setDraft((p) => ({ ...p, profitTargetPct: toNum(e.target.value, p.profitTargetPct) }))} className="bg-neutral-700 border-neutral-600" placeholder="Profit target %" />
                  <Input type="number" step="0.01" value={draft.maxDailyLossPct} onChange={(e) => setDraft((p) => ({ ...p, maxDailyLossPct: toNum(e.target.value, p.maxDailyLossPct) }))} className="bg-neutral-700 border-neutral-600" placeholder="Max daily loss %" />
                  <Input type="number" step="0.01" value={draft.maxTotalLossPct ?? ""} onChange={(e) => setDraft((p) => ({ ...p, maxTotalLossPct: toOptNum(e.target.value) }))} className="bg-neutral-700 border-neutral-600" placeholder="Max total loss %" />
                  <Input type="number" value={draft.durationDays} onChange={(e) => setDraft((p) => ({ ...p, durationDays: Math.max(1, toInt(e.target.value, p.durationDays)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Duration (days)" />
                  <Input
                    type="number"
                    value={draft.virtualCapitalUsd}
                    onChange={(e) => {
                      setVirtualCapitalTouched(true);
                      setDraft((p) => ({ ...p, virtualCapitalUsd: Math.max(1, toNum(e.target.value, p.virtualCapitalUsd)) }));
                    }}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Virtual capital USD"
                  />
                  <Input type="number" value={draft.featuredOrder} onChange={(e) => setDraft((p) => ({ ...p, featuredOrder: Math.max(0, toInt(e.target.value, p.featuredOrder)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Featured order" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input type="number" value={draft.maxEnrollments ?? ""} onChange={(e) => setDraft((p) => ({ ...p, maxEnrollments: toOptInt(e.target.value) }))} className="bg-neutral-700 border-neutral-600" placeholder="Max enrollments" />
                  <Input type="number" value={draft.maxActiveEnrollments ?? ""} onChange={(e) => setDraft((p) => ({ ...p, maxActiveEnrollments: toOptInt(e.target.value) }))} className="bg-neutral-700 border-neutral-600" placeholder="Max active" />
                  <Input type="number" value={draft.maxRetriesPerTrader} onChange={(e) => setDraft((p) => ({ ...p, maxRetriesPerTrader: Math.max(0, toInt(e.target.value, p.maxRetriesPerTrader)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Max retries" />
                  <Input type="number" value={draft.retryCooldownHours} onChange={(e) => setDraft((p) => ({ ...p, retryCooldownHours: Math.max(0, toInt(e.target.value, p.retryCooldownHours)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Retry cooldown hours" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input
                    type="datetime-local"
                    step={60}
                    value={utcSecToLocalDateTimeInput(draft.startAt)}
                    onChange={(e) => setDraft((p) => ({ ...p, startAt: localDateTimeInputToUtcSec(e.target.value) }))}
                    className="bg-neutral-700 border-neutral-600"
                    data-hint="Challenge start date/time (local)"
                    aria-label="Challenge start date/time (local)"
                  />
                  <Input
                    type="datetime-local"
                    step={60}
                    value={utcSecToLocalDateTimeInput(draft.endAt)}
                    onChange={(e) => setDraft((p) => ({ ...p, endAt: localDateTimeInputToUtcSec(e.target.value) }))}
                    className="bg-neutral-700 border-neutral-600"
                    data-hint="Challenge end date/time (local)"
                    aria-label="Challenge end date/time (local)"
                  />
                  <Input
                    type="datetime-local"
                    step={60}
                    value={utcSecToLocalDateTimeInput(draft.enrollmentStartAt)}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, enrollmentStartAt: localDateTimeInputToUtcSec(e.target.value) }))
                    }
                    className="bg-neutral-700 border-neutral-600"
                    data-hint="Enrollment start date/time (local)"
                    aria-label="Enrollment start date/time (local)"
                  />
                  <Input
                    type="datetime-local"
                    step={60}
                    value={utcSecToLocalDateTimeInput(draft.enrollmentEndAt)}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, enrollmentEndAt: localDateTimeInputToUtcSec(e.target.value) }))
                    }
                    className="bg-neutral-700 border-neutral-600"
                    data-hint="Enrollment end date/time (local)"
                    aria-label="Enrollment end date/time (local)"
                  />
                  <Input value={draft.eligibilityGate} onChange={(e) => setDraft((p) => ({ ...p, eligibilityGate: e.target.value }))} className="bg-neutral-700 border-neutral-600" placeholder="eligibility gate json/mode" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input type="number" value={draft.prizePoolUsd} onChange={(e) => setDraft((p) => ({ ...p, prizePoolUsd: Math.max(0, toNum(e.target.value, p.prizePoolUsd)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Prize pool USD" />
                  <Input type="number" value={draft.prizeMinCompletions} onChange={(e) => setDraft((p) => ({ ...p, prizeMinCompletions: Math.max(0, toInt(e.target.value, p.prizeMinCompletions)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Prize min completions" />
                  <select value={draft.prizeAwardTiming} onChange={(e) => setDraft((p) => ({ ...p, prizeAwardTiming: e.target.value }))} data-hint="Prize award timing" className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm">
                    <option value="ON_COMPLETE">ON_COMPLETE</option>
                    <option value="ON_CHALLENGE_END">ON_CHALLENGE_END</option>
                    <option value="MANUAL">MANUAL</option>
                  </select>
                  <Input value={draft.prizeDistributionJson} onChange={(e) => setDraft((p) => ({ ...p, prizeDistributionJson: e.target.value }))} className="bg-neutral-700 border-neutral-600" placeholder="Prize distribution JSON" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input value={draft.badgeOnPass} onChange={(e) => setDraft((p) => ({ ...p, badgeOnPass: e.target.value }))} className="bg-neutral-700 border-neutral-600" placeholder="Badge on pass (id/key)" />
                  <Input value={draft.badgeOnTop3} onChange={(e) => setDraft((p) => ({ ...p, badgeOnTop3: e.target.value }))} className="bg-neutral-700 border-neutral-600" placeholder="Badge on top3 (id/key)" />
                  <Input type="number" value={draft.certificateTemplateId ?? ""} onChange={(e) => setDraft((p) => ({ ...p, certificateTemplateId: toOptInt(e.target.value) }))} className="bg-neutral-700 border-neutral-600" placeholder="Certificate template id" />
                  <Input type="number" value={draft.progressionTierId ?? ""} onChange={(e) => setDraft((p) => ({ ...p, progressionTierId: toOptInt(e.target.value) }))} className="bg-neutral-700 border-neutral-600" placeholder="Progression tier id" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input value={draft.autoWatchlistTier} onChange={(e) => setDraft((p) => ({ ...p, autoWatchlistTier: e.target.value }))} className="bg-neutral-700 border-neutral-600" placeholder="Auto watchlist tier (A_LIST/B_LIST/INCUBATOR)" />
                  <Input type="number" value={draft.selectionBoostPoints} onChange={(e) => setDraft((p) => ({ ...p, selectionBoostPoints: Math.max(0, toNum(e.target.value, p.selectionBoostPoints)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Selection boost points" />
                  <Input value={draft.customRewardJson} onChange={(e) => setDraft((p) => ({ ...p, customRewardJson: e.target.value }))} className="bg-neutral-700 border-neutral-600" placeholder="Custom reward JSON" />
                  <Input type="number" value={draft.leaderboardMaxVisible} onChange={(e) => setDraft((p) => ({ ...p, leaderboardMaxVisible: Math.max(1, toInt(e.target.value, p.leaderboardMaxVisible)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Leaderboard max visible" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Visible</span><Switch checked={draft.visibleToTraders} onCheckedChange={(c) => setDraft((p) => ({ ...p, visibleToTraders: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Active</span><Switch checked={draft.isActive} onCheckedChange={(c) => setDraft((p) => ({ ...p, isActive: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Prize Pool</span><Switch checked={draft.prizePoolEnabled} onCheckedChange={(c) => setDraft((p) => ({ ...p, prizePoolEnabled: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Badges</span><Switch checked={draft.badgesEnabled} onCheckedChange={(c) => setDraft((p) => ({ ...p, badgesEnabled: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Certificates</span><Switch checked={draft.certificateEnabled} onCheckedChange={(c) => setDraft((p) => ({ ...p, certificateEnabled: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Leaderboard</span><Switch checked={draft.leaderboardEnabled} onCheckedChange={(c) => setDraft((p) => ({ ...p, leaderboardEnabled: Boolean(c) }))} /></label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-xs">
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Cert Download</span><Switch checked={draft.certificateDownloadable} onCheckedChange={(c) => setDraft((p) => ({ ...p, certificateDownloadable: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Cert Share</span><Switch checked={draft.certificateShareable} onCheckedChange={(c) => setDraft((p) => ({ ...p, certificateShareable: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Cert Metrics</span><Switch checked={draft.certificateIncludeMetrics} onCheckedChange={(c) => setDraft((p) => ({ ...p, certificateIncludeMetrics: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Selection Boost</span><Switch checked={draft.selectionBoostEnabled} onCheckedChange={(c) => setDraft((p) => ({ ...p, selectionBoostEnabled: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Partner Visible</span><Switch checked={draft.partnerVisibilityOnPass} onCheckedChange={(c) => setDraft((p) => ({ ...p, partnerVisibilityOnPass: Boolean(c) }))} /></label>
                  <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2"><span>Anonymize LB</span><Switch checked={draft.leaderboardAnonymize} onCheckedChange={(c) => setDraft((p) => ({ ...p, leaderboardAnonymize: Boolean(c) }))} /></label>
                </div>
                <div className="rounded border border-neutral-700 p-2 space-y-2">
                  <div className="flex items-center justify-between text-xs"><span>Phase Configuration</span><Button size="sm" variant="outline" className="border-neutral-600" disabled={draft.phases.length >= 3} onClick={() => setDraft((p) => ({ ...p, phases: [...p.phases, { ...p.phases[p.phases.length - 1], phaseName: `Phase ${p.phases.length + 1}` }] }))}>Add Phase</Button></div>
                  {draft.phases.map((item, idx) => (
                    <div key={idx} className="rounded border border-neutral-700 p-2 grid grid-cols-1 md:grid-cols-7 gap-2">
                      <Input value={item.phaseName} onChange={(e) => setDraft((p) => ({ ...p, phases: p.phases.map((x, i) => (i === idx ? { ...x, phaseName: e.target.value } : x)) }))} className="bg-neutral-700 border-neutral-600 md:col-span-2" placeholder={`Phase ${idx + 1} name`} />
                      <Input type="number" step="0.01" value={item.profitTargetPct} onChange={(e) => setDraft((p) => ({ ...p, phases: p.phases.map((x, i) => (i === idx ? { ...x, profitTargetPct: toNum(e.target.value, x.profitTargetPct) } : x)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Phase target %" />
                      <Input type="number" step="0.01" value={item.maxDailyLossPct} onChange={(e) => setDraft((p) => ({ ...p, phases: p.phases.map((x, i) => (i === idx ? { ...x, maxDailyLossPct: toNum(e.target.value, x.maxDailyLossPct) } : x)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Phase max daily %" />
                      <Input type="number" value={item.durationDays} onChange={(e) => setDraft((p) => ({ ...p, phases: p.phases.map((x, i) => (i === idx ? { ...x, durationDays: Math.max(1, toInt(e.target.value, x.durationDays)) } : x)) }))} className="bg-neutral-700 border-neutral-600" placeholder="Phase duration days" />
                      <select value={item.drawdownType} onChange={(e) => setDraft((p) => ({ ...p, phases: p.phases.map((x, i) => (i === idx ? { ...x, drawdownType: e.target.value === "TRAILING" ? "TRAILING" : "STATIC" } : x)) }))} data-hint={`Phase ${idx + 1} drawdown type`} className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"><option value="STATIC">STATIC</option><option value="TRAILING">TRAILING</option></select>
                      <Button size="sm" variant="destructive" disabled={draft.phases.length <= 1} onClick={() => setDraft((p) => ({ ...p, phases: p.phases.filter((_, i) => i !== idx) }))}>Remove</Button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="border-neutral-600"
                    onClick={() => {
                      setDraft({ ...EMPTY_DRAFT, virtualCapitalUsd: defaultChallengeVirtualCapitalUsd });
                      setVirtualCapitalTouched(false);
                      setEditingId(null);
                    }}
                  >
                    Reset
                  </Button>
                  <Button onClick={() => void saveTemplate()} disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending}>{editingId ? "Save" : "Create"}</Button>
                </div>
              </CardContent>
            </Card>

            <div className="overflow-x-auto rounded border border-neutral-700">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-700 text-gray-300"><th className="py-2 px-2 text-left">Name</th><th className="py-2 px-2 text-right">Target</th><th className="py-2 px-2 text-right">Max DD</th><th className="py-2 px-2 text-right">Duration</th><th className="py-2 px-2 text-right">Enrollments</th><th className="py-2 px-2 text-right">Pass Rate</th><th className="py-2 px-2 text-right">Actions</th></tr></thead>
                <tbody>
                  {templates.map((row) => {
                    const rowId = Number(row.id);
                    const open = Number(expandedId) === rowId;
                    const detail = open ? templateDetailQuery.data : null;
                    const inlineBase = buildInlineTemplateDraft(row);
                    const inlineDraft = inlineDraftById[rowId] ?? inlineBase;
                    const inlineDirty = !isInlineTemplateDraftEqual(inlineDraft, inlineBase);
                    const rowIsActive = Boolean(row.is_active ?? row.isActive);
                    const rowIsVisible = Boolean(row.visible_to_traders ?? row.visibleToTraders);

                    return [
                      <tr key={`template-row-${rowId}`} className="border-b border-neutral-800/90">
                        <td className="py-2 px-2">
                          <div className="font-medium text-white">{row.name}</div>
                          <div className="flex gap-1 mt-1">
                            <Badge variant={rowIsActive ? "default" : "outline"}>{rowIsActive ? "ACTIVE" : "INACTIVE"}</Badge>
                            <Badge variant={rowIsVisible ? "secondary" : "outline"}>{rowIsVisible ? "VISIBLE" : "HIDDEN"}</Badge>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={inlineDraft.profitTargetPct}
                            onChange={(e) => setInlineField(row, "profitTargetPct", e.target.value)}
                            className="h-8 w-24 ml-auto text-right bg-neutral-900 border-neutral-700"
                            data-hint="Inline edit: challenge target percentage"
                          />
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={inlineDraft.maxDailyLossPct}
                            onChange={(e) => setInlineField(row, "maxDailyLossPct", e.target.value)}
                            className="h-8 w-24 ml-auto text-right bg-neutral-900 border-neutral-700"
                            data-hint="Inline edit: max daily drawdown percentage"
                          />
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Input
                            type="number"
                            value={inlineDraft.durationDays}
                            onChange={(e) => setInlineField(row, "durationDays", e.target.value)}
                            className="h-8 w-24 ml-auto text-right bg-neutral-900 border-neutral-700"
                            data-hint="Inline edit: challenge duration in days"
                          />
                        </td>
                        <td className="py-2 px-2 text-right">
                          {toInt(row.active_enrollment_count ?? row.activeEnrollmentCount, 0)}/{toInt(row.enrollment_count ?? row.enrollmentCount, 0)}
                        </td>
                        <td className="py-2 px-2 text-right">{formatPct(row.pass_rate ?? row.passRate)}</td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          {inlineDirty ? (
                            <>
                              <Button
                                size="sm"
                                className="ml-1"
                                disabled={updateTemplateMutation.isPending}
                                onClick={() => void saveInlineDraft(row)}
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-neutral-600 ml-1"
                                disabled={updateTemplateMutation.isPending}
                                onClick={() => resetInlineDraft(rowId)}
                              >
                                Reset
                              </Button>
                            </>
                          ) : null}
                          <Button size="sm" variant="ghost" onClick={() => setExpandedId(open ? null : rowId)}>
                            {open ? "Collapse" : "Expand"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600 ml-1"
                            onClick={() => {
                              setExpandedId(rowId);
                              setEditingId(rowId);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600 ml-1"
                            onClick={() => duplicateTemplateMutation.mutate(rowId)}
                          >
                            Duplicate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600 ml-1"
                            onClick={() => archiveTemplateMutation.mutate(rowId)}
                          >
                            Archive
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="ml-1"
                            onClick={() => setDeleteTarget(row)}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>,
                      open ? (
                        <tr key={`template-row-detail-${rowId}`} className="border-b border-neutral-800/90">
                          <td colSpan={7} className="p-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="rounded border border-neutral-700 p-2 text-xs space-y-1">
                                <div className="text-gray-400">Phase Breakdown</div>
                                {(detail?.phases ?? []).map((p: AnyRow, phaseIdx: number) => {
                                  const phaseNumber = Math.max(1, toInt(p.phaseNumber ?? p.phase_number, phaseIdx + 1));
                                  const isPhaseOne = phaseNumber === 1;
                                  const phaseTarget = isPhaseOne
                                    ? toNum(inlineDraft.profitTargetPct, toNum(p.profitTargetPct ?? p.profit_target_pct, toNum(row.profitTargetPct ?? row.profit_target_pct, 0.1)))
                                    : toNum(p.profitTargetPct ?? p.profit_target_pct, 0.1);
                                  const phaseDaily = isPhaseOne
                                    ? toNum(inlineDraft.maxDailyLossPct, toNum(p.maxDailyLossPct ?? p.max_daily_loss_pct, toNum(row.maxDailyLossPct ?? row.max_daily_loss_pct, 0.03)))
                                    : toNum(p.maxDailyLossPct ?? p.max_daily_loss_pct, 0.03);
                                  const phaseDuration = isPhaseOne
                                    ? Math.max(1, toInt(inlineDraft.durationDays, toInt(p.durationDays ?? p.duration_days, toInt(row.durationDays ?? row.duration_days, 30))))
                                    : Math.max(1, toInt(p.durationDays ?? p.duration_days, 30));
                                  return (
                                    <div key={p.id ?? `${rowId}-${phaseNumber}`} className="rounded border border-neutral-700 p-2">
                                      {p.phaseName || p.phase_name || `Phase ${phaseNumber}`}: {formatPct(phaseTarget)} target | {formatPct(phaseDaily)} daily | {phaseDuration}d
                                    </div>
                                  );
                                })}
                                {!(detail?.phases ?? []).length ? <div className="text-gray-500">No phases loaded.</div> : null}
                              </div>
                              <div className="rounded border border-neutral-700 p-2 text-xs space-y-1">
                                <div>Prize Pool: {detail?.row?.prizePoolEnabled ? formatUsd(detail?.row?.prizePoolUsd) : "Disabled"}</div>
                                <div>Badges: {detail?.row?.badgesEnabled ? "Enabled" : "Disabled"}</div>
                                <div>Certificates: {detail?.row?.certificateEnabled ? "Enabled" : "Disabled"}</div>
                                <div>Selection Boost: {detail?.row?.selectionBoostEnabled ? `${toNum(detail?.row?.selectionBoostPoints, 0)} pts` : "Disabled"}</div>
                                <div>Leaderboard: {detail?.row?.leaderboardEnabled ? "Enabled" : "Disabled"}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                  {!templatesQuery.isLoading && templates.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-gray-400">No challenge templates found.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="enrollments" className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <select
                value={enrollFilters.challengeId}
                onChange={(e) => setEnrollFilters((p) => ({ ...p, challengeId: e.target.value }))}
                data-hint="Enrollment challenge filter"
                className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
              >
                <option value="">All challenges</option>
                {challengeRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    #{row.id} {row.name}
                  </option>
                ))}
              </select>
              <select
                value={enrollFilters.status}
                onChange={(e) => setEnrollFilters((p) => ({ ...p, status: e.target.value }))}
                data-hint="Enrollment status filter"
                className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="PASSED">PASSED</option>
                <option value="FAILED">FAILED</option>
                <option value="WITHDRAWN">WITHDRAWN</option>
                <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
                <option value="DISQUALIFIED">DISQUALIFIED</option>
              </select>
              <Input
                value={enrollFilters.phase}
                onChange={(e) => setEnrollFilters((p) => ({ ...p, phase: e.target.value }))}
                className="bg-neutral-700 border-neutral-600"
                placeholder="Phase"
              />
              <Input
                value={enrollFilters.userId}
                onChange={(e) => setEnrollFilters((p) => ({ ...p, userId: e.target.value }))}
                className="bg-neutral-700 border-neutral-600"
                placeholder="Trader user ID"
              />
              <Input
                type="date"
                value={enrollFilters.fromDate}
                onChange={(e) => setEnrollFilters((p) => ({ ...p, fromDate: e.target.value }))}
                className="bg-neutral-700 border-neutral-600"
                data-hint="Enrollment date filter (from day)"
              />
            </div>

            <div className="overflow-x-auto rounded border border-neutral-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 text-gray-300">
                    <th className="py-2 px-2 text-left">Trader</th>
                    <th className="py-2 px-2 text-left">Challenge</th>
                    <th className="py-2 px-2 text-right">Phase</th>
                    <th className="py-2 px-2 text-right">Status</th>
                    <th className="py-2 px-2 text-right">Progress</th>
                    <th className="py-2 px-2 text-right">PnL</th>
                    <th className="py-2 px-2 text-right">Daily Loss</th>
                    <th className="py-2 px-2 text-right">Days</th>
                    <th className="py-2 px-2 text-right">Time Left</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollmentRows.map((row) => {
                    const challenge = challengeMap.get(Number(row.challenge_id));
                    const target = toNum(challenge?.profit_target_pct ?? row.profit_target_pct, 0.1);
                    const pnl = toNum(row.current_pnl_pct ?? row.currentPnlPct, 0);
                    const pct = target > 0 ? Math.max(0, Math.min(100, (pnl / target) * 100)) : Math.max(0, Math.min(100, pnl * 100));
                    const start = toInt(row.phase_started_at ?? row.phaseStartedAt ?? row.enrolled_at ?? row.enrolledAt, 0);
                    const duration = toInt(challenge?.duration_days ?? row.duration_days, 0);
                    const label = duration > 0 ? daysLeftLabel(start + duration * 86400) : "-";
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-neutral-800/90 cursor-pointer ${Number(selectedEnrollmentId) === Number(row.id) ? "bg-neutral-700/20" : ""}`}
                        onClick={() => setSelectedEnrollmentId(Number(row.id))}
                      >
                        <td className="py-2 px-2">
                          <div className="text-white">{row.user_username || `User #${row.user_id}`}</div>
                          <div className="text-xs text-gray-400">{row.user_email || "-"}</div>
                        </td>
                        <td className="py-2 px-2">{row.challenge_name || challenge?.name || `#${row.challenge_id}`}</td>
                        <td className="py-2 px-2 text-right">{toInt(row.current_phase ?? row.currentPhase, 1)}</td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                        </td>
                        <td className="py-2 px-2 min-w-[140px]">
                          <Progress className="h-2" value={pct} />
                        </td>
                        <td className="py-2 px-2 text-right">{formatPct(row.current_pnl_pct ?? row.currentPnlPct)}</td>
                        <td className="py-2 px-2 text-right">{formatPct(row.max_daily_loss_hit ?? row.maxDailyLossHit)}</td>
                        <td className="py-2 px-2 text-right">{toInt(row.trading_days ?? row.tradingDays, 0)}</td>
                        <td className="py-2 px-2 text-right">{label}</td>
                      </tr>
                    );
                  })}
                  {!enrollmentsQuery.isLoading && enrollmentRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-400">
                        No enrollment rows found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {selectedEnrollment ? (
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Enrollment #{selectedEnrollment.id}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                    <div className="rounded border border-neutral-700 p-2">
                      <div className="text-xs text-gray-400">Trader</div>
                      <div>{enrollmentDetailQuery.data?.user?.username || `User #${enrollmentDetailQuery.data?.user?.id || "-"}`}</div>
                      <div className="text-xs text-gray-500">{enrollmentDetailQuery.data?.user?.email || "-"}</div>
                    </div>
                    <div className="rounded border border-neutral-700 p-2">
                      <div className="text-xs text-gray-400">Challenge</div>
                      <div>{selectedChallenge?.name || "-"}</div>
                      <div className="text-xs text-gray-500">Attempt #{toInt(selectedEnrollment.attemptNumber ?? selectedEnrollment.attempt_number, 1)}</div>
                    </div>
                    <div className="rounded border border-neutral-700 p-2">
                      <div className="text-xs text-gray-400">Status</div>
                      <Badge variant={statusVariant(selectedEnrollment.status)}>{String(selectedEnrollment.status || "-")}</Badge>
                      <div className="text-xs text-gray-500">Phase {currentPhase}</div>
                    </div>
                    <div className="rounded border border-neutral-700 p-2">
                      <div className="text-xs text-gray-400">Window</div>
                      <div className="text-xs">Enrolled: {formatWhen(selectedEnrollment.enrolledAt ?? selectedEnrollment.enrolled_at)}</div>
                      <div className="text-xs">Completed: {formatWhen(selectedEnrollment.completedAt ?? selectedEnrollment.completed_at)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded border border-neutral-700 p-2 space-y-2">
                      <div className="text-xs text-gray-400">Performance Gauges</div>
                      <div>
                        <div className="text-xs flex justify-between">
                          <span>PnL Progress</span>
                          <span>{formatPct(selectedEnrollment.currentPnlPct ?? selectedEnrollment.current_pnl_pct)}</span>
                        </div>
                        <Progress
                          className="h-2"
                          value={Math.max(
                            0,
                            Math.min(100, (toNum(selectedEnrollment.currentPnlPct ?? selectedEnrollment.current_pnl_pct, 0) / Math.max(pnlTarget, 0.000001)) * 100),
                          )}
                        />
                      </div>
                      <div>
                        <div className="text-xs flex justify-between">
                          <span>Daily Loss</span>
                          <span>
                            {formatPct(selectedEnrollment.maxDailyLossHit ?? selectedEnrollment.max_daily_loss_hit)} / {formatPct(dailyTarget)}
                          </span>
                        </div>
                        <Progress
                          className="h-2"
                          value={
                            dailyTarget > 0
                              ? Math.max(0, Math.min(100, (toNum(selectedEnrollment.maxDailyLossHit ?? selectedEnrollment.max_daily_loss_hit, 0) / dailyTarget) * 100))
                              : 0
                          }
                        />
                      </div>
                      <div>
                        <div className="text-xs flex justify-between">
                          <span>Total DD</span>
                          <span>
                            {formatPct(selectedEnrollment.maxTotalLossHit ?? selectedEnrollment.max_total_loss_hit)} / {formatPct(totalTarget)}
                          </span>
                        </div>
                        <Progress
                          className="h-2"
                          value={
                            totalTarget > 0
                              ? Math.max(0, Math.min(100, (toNum(selectedEnrollment.maxTotalLossHit ?? selectedEnrollment.max_total_loss_hit, 0) / totalTarget) * 100))
                              : 0
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded border border-neutral-700 p-2 space-y-2">
                      <div className="text-xs text-gray-400">Admin Actions</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-neutral-600"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "ADVANCE",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: { reason: "Manual advance" },
                            })
                          }
                        >
                          Advance
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-neutral-600"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "RESET",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: { reason: "Manual reset" },
                            })
                          }
                        >
                          Reset
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-neutral-600"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "ACTION",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: { action: "WITHDRAW", note: "Admin withdrawal" },
                            })
                          }
                        >
                          Withdraw
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "DISQUALIFY",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: { reason: "Manual disqualification" },
                            })
                          }
                        >
                          Disqualify
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <select
                          value={overrideStatus}
                          onChange={(e) => setOverrideStatus(e.target.value)}
                          data-hint="Override enrollment status"
                          className="h-9 rounded-md border border-neutral-600 bg-neutral-700 px-2 text-xs"
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="PASSED">PASSED</option>
                          <option value="FAILED">FAILED</option>
                          <option value="WITHDRAWN">WITHDRAWN</option>
                          <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
                        </select>
                        <Input
                          value={overridePhase}
                          onChange={(e) => setOverridePhase(e.target.value)}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Phase"
                        />
                        <Input
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Override reason"
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "OVERRIDE",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: {
                                status: overrideStatus,
                                reason: overrideReason || "Admin override",
                                currentPhase: Math.max(1, toInt(overridePhase, currentPhase)),
                              },
                            })
                          }
                        >
                          Apply Override
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <Input
                          value={extendDays}
                          onChange={(e) => setExtendDays(e.target.value)}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Extend days"
                        />
                        <Input
                          value={extendReason}
                          onChange={(e) => setExtendReason(e.target.value)}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Extension reason"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-neutral-600"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "EXTEND",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: {
                                extendDays: Math.max(1, toInt(extendDays, 1)),
                                reason: extendReason || "Admin extension",
                              },
                            })
                          }
                        >
                          Extend Phase
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <Input
                          value={adminNote}
                          onChange={(e) => setAdminNote(e.target.value)}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Admin note"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-neutral-600"
                          onClick={() =>
                            enrollmentActionMutation.mutate({
                              type: "ACTION",
                              enrollmentId: Number(selectedEnrollment.id),
                              data: { action: "ADD_NOTE", note: adminNote || "Admin note" },
                            })
                          }
                        >
                          Add Note
                        </Button>
                      </div>

                      <div className="rounded border border-neutral-700 p-2 space-y-2">
                        <div className="text-xs text-gray-400">Manual Trader Notification</div>
                        <Input
                          value={notifyDraft.title}
                          onChange={(e) => setNotifyDraft((p) => ({ ...p, title: e.target.value }))}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Title"
                        />
                        <Input
                          value={notifyDraft.message}
                          onChange={(e) => setNotifyDraft((p) => ({ ...p, message: e.target.value }))}
                          className="h-9 bg-neutral-700 border-neutral-600 text-xs"
                          placeholder="Message"
                        />
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <select
                            value={notifyDraft.severity}
                            onChange={(e) => setNotifyDraft((p) => ({ ...p, severity: e.target.value }))}
                            data-hint="Notification severity"
                            className="h-9 rounded-md border border-neutral-600 bg-neutral-700 px-2 text-xs"
                          >
                            <option value="INFO">INFO</option>
                            <option value="SUCCESS">SUCCESS</option>
                            <option value="WARNING">WARNING</option>
                            <option value="CRITICAL">CRITICAL</option>
                          </select>
                          <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2 text-xs">
                            <span>Mailbox</span>
                            <Switch
                              checked={Boolean(notifyDraft.sendMailbox)}
                              onCheckedChange={(value) => setNotifyDraft((p) => ({ ...p, sendMailbox: Boolean(value) }))}
                            />
                          </label>
                          <Button
                            size="sm"
                            onClick={() =>
                              enrollmentNotifyMutation.mutate({
                                enrollmentId: Number(selectedEnrollment.id),
                                title: notifyDraft.title,
                                message: notifyDraft.message,
                                severity: notifyDraft.severity,
                                sendMailbox: Boolean(notifyDraft.sendMailbox),
                              })
                            }
                          >
                            Send Notice
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded border border-neutral-700 p-2 space-y-2">
                      <div className="text-xs text-gray-400">Event Ledger</div>
                      <div className="max-h-64 overflow-auto space-y-1 text-xs">
                        {selectedEvents.map((event) => (
                          <div key={event.id} className="rounded border border-neutral-700 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{event.eventType || event.event_type}</span>
                              <span className="text-gray-500">{formatWhen(event.occurredAt ?? event.occurred_at ?? event.createdAt ?? event.created_at)}</span>
                            </div>
                            <div className="text-gray-500">
                              Actor: {event.actorType || event.actor_type || "SYSTEM"}
                              {event.actorUserId || event.actor_user_id ? ` #${event.actorUserId || event.actor_user_id}` : ""}
                            </div>
                            {event.note ? <div className="text-gray-300">{event.note}</div> : null}
                          </div>
                        ))}
                        {selectedEvents.length === 0 ? <div className="text-gray-500">No events.</div> : null}
                      </div>
                    </div>

                    <div className="rounded border border-neutral-700 p-2 space-y-2">
                      <div className="text-xs text-gray-400">Challenge Trades</div>
                      <div className="max-h-64 overflow-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-neutral-700 text-gray-400">
                              <th className="px-2 py-1 text-left">Trade</th>
                              <th className="px-2 py-1 text-left">Status</th>
                              <th className="px-2 py-1 text-right">Net</th>
                              <th className="px-2 py-1 text-right">Opened</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedTrades.map((trade) => (
                              <tr key={trade.id} className="border-b border-neutral-800/80">
                                <td className="px-2 py-1">#{trade.id}</td>
                                <td className="px-2 py-1">{trade.status || "-"}</td>
                                <td className="px-2 py-1 text-right">{formatUsd(trade.netProfitUsd ?? trade.net_profit_usd)}</td>
                                <td className="px-2 py-1 text-right">{formatWhen(trade.openedAt ?? trade.opened_at)}</td>
                              </tr>
                            ))}
                            {selectedTrades.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-2 py-4 text-center text-gray-500">
                                  No trades in this enrollment window.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
          <TabsContent value="analytics" className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardContent className="pt-4">
                  <div className="text-xs text-gray-400">Total Enrollments</div>
                  <div className="text-xl font-semibold">{toInt(summaryQuery.data?.cards?.totalEnrollments, 0)}</div>
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardContent className="pt-4">
                  <div className="text-xs text-gray-400">Active</div>
                  <div className="text-xl font-semibold">{toInt(summaryQuery.data?.cards?.activeEnrollments, 0)}</div>
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardContent className="pt-4">
                  <div className="text-xs text-gray-400">Pass Rate</div>
                  <div className="text-xl font-semibold">{formatPct(summaryQuery.data?.cards?.passRate)}</div>
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardContent className="pt-4">
                  <div className="text-xs text-gray-400">Avg Time To Complete</div>
                  <div className="text-xl font-semibold">{toInt(summaryQuery.data?.cards?.avgTimeToCompleteSec, 0)}s</div>
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardContent className="pt-4">
                  <div className="text-xs text-gray-400">Prize Awarded</div>
                  <div className="text-xl font-semibold">{formatUsd(summaryQuery.data?.cards?.prizeMoneyAwardedUsd)}</div>
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardContent className="pt-4">
                  <div className="text-xs text-gray-400">Selection Conversions</div>
                  <div className="text-xl font-semibold">{toInt(summaryQuery.data?.cards?.selectionConversions, 0)}</div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Enrollment Funnel</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {(funnelQuery.data?.rows ?? []).map((row: AnyRow) => {
                    const total = Math.max(1, toInt(row.enrollments, 0));
                    return (
                      <div key={row.challenge_id} className="rounded border border-neutral-700 p-2">
                        <div className="font-semibold">{row.challenge_name}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <div>Enrolled: {toInt(row.enrollments, 0)}</div>
                          <div>Active: {toInt(row.active_count, 0)}</div>
                          <div>Passed: {toInt(row.passed_count, 0)}</div>
                          <div>Failed: {toInt(row.failed_count, 0)}</div>
                          <div>Withdrawn: {toInt(row.withdrawn_count, 0)}</div>
                          <div>Pass Rate: {formatPct(toNum(row.passed_count, 0) / total)}</div>
                        </div>
                      </div>
                    );
                  })}
                  {!funnelQuery.isLoading && (funnelQuery.data?.rows?.length ?? 0) === 0 ? (
                    <div className="text-gray-500">No funnel data yet.</div>
                  ) : null}
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Prize Queue</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex gap-2">
                    <select
                      value={prizeChallengeFilter}
                      onChange={(e) => setPrizeChallengeFilter(e.target.value)}
                      data-hint="Prize queue challenge filter"
                      className="h-9 rounded-md border border-neutral-600 bg-neutral-700 px-2 text-xs"
                    >
                      <option value="">All challenges</option>
                      {challengeRows.map((row) => (
                        <option key={row.id} value={row.id}>
                          #{row.id} {row.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-neutral-600"
                      onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/challenges/prizes"] })}
                    >
                      Refresh
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-auto space-y-2">
                    {(prizesQuery.data?.rows ?? []).map((row: AnyRow) => (
                      <div key={row.id} className="rounded border border-neutral-700 p-2">
                        <div className="flex justify-between">
                          <span>{row.challenge_name}</span>
                          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                        </div>
                        <div>
                          Trader: {row.username || `User #${row.user_id}`} | Rank #{toInt(row.rank, 0)} |{" "}
                          {formatUsd(row.prize_amount_usd)}
                        </div>
                        <div className="text-gray-500">Created {formatWhen(row.created_at)}</div>
                        <div className="flex gap-2 mt-1">
                          <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => prizeActionMutation.mutate({ id: Number(row.id), action: "APPROVE" })}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => prizeActionMutation.mutate({ id: Number(row.id), action: "PAID" })}>
                            Mark Paid
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => prizeActionMutation.mutate({ id: Number(row.id), action: "CANCEL" })}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!prizesQuery.isLoading && (prizesQuery.data?.rows?.length ?? 0) === 0 ? (
                      <div className="text-gray-500">No prize rows.</div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Pass/Fail Trend</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs max-h-60 overflow-auto">
                  {(passFailTrendQuery.data?.rows ?? []).map((row: AnyRow) => (
                    <div key={row.day} className="rounded border border-neutral-700 p-2">
                      <div className="font-semibold">{row.day}</div>
                      <div>Passed: {toInt(row.passed_count, 0)}</div>
                      <div>Failed: {toInt(row.failed_count, 0)}</div>
                      <div>Withdrawn: {toInt(row.withdrawn_count, 0)}</div>
                    </div>
                  ))}
                  {!passFailTrendQuery.isLoading && (passFailTrendQuery.data?.rows?.length ?? 0) === 0 ? (
                    <div className="text-gray-500">No trend data.</div>
                  ) : null}
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Breach Distribution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs max-h-60 overflow-auto">
                  {(breachDistributionQuery.data?.rows ?? []).map((row: AnyRow) => (
                    <div key={row.event_type} className="rounded border border-neutral-700 p-2 flex items-center justify-between">
                      <span>{row.event_type}</span>
                      <span className="font-semibold">{toInt(row.c, 0)}</span>
                    </div>
                  ))}
                  {!breachDistributionQuery.isLoading && (breachDistributionQuery.data?.rows?.length ?? 0) === 0 ? (
                    <div className="text-gray-500">No breach events yet.</div>
                  ) : null}
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Top Performers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs max-h-60 overflow-auto">
                  {(topPerformersQuery.data?.rows ?? []).map((row: AnyRow) => (
                    <div key={row.enrollment_id} className="rounded border border-neutral-700 p-2">
                      <div className="font-semibold">
                        {row.username} · {row.challenge_name}
                      </div>
                      <div>PnL: {formatPct(row.pnl_pct)} · Days: {toInt(row.trading_days, 0)} · Phase {toInt(row.current_phase, 1)}</div>
                    </div>
                  ))}
                  {!topPerformersQuery.isLoading && (topPerformersQuery.data?.rows?.length ?? 0) === 0 ? (
                    <div className="text-gray-500">No active/passed performers.</div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Challenge Popularity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs max-h-60 overflow-auto">
                  {(popularityQuery.data?.rows ?? []).map((row: AnyRow) => (
                    <div key={row.challenge_id} className="rounded border border-neutral-700 p-2 flex items-center justify-between">
                      <span>{row.challenge_name}</span>
                      <span>{toInt(row.enrollment_count, 0)} enrollments</span>
                    </div>
                  ))}
                  {!popularityQuery.isLoading && (popularityQuery.data?.rows?.length ?? 0) === 0 ? (
                    <div className="text-gray-500">No popularity data.</div>
                  ) : null}
                </CardContent>
              </Card>
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Reward Distribution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs max-h-60 overflow-auto">
                  {(rewardDistributionQuery.data?.rows ?? []).map((row: AnyRow) => (
                    <div key={row.challenge_id} className="rounded border border-neutral-700 p-2">
                      <div className="font-semibold">{row.challenge_name}</div>
                      <div>
                        Prizes: {toInt(row.prize_count, 0)} ({formatUsd(row.prize_sum_usd)})
                      </div>
                      <div>Badges: {toInt(row.badge_count, 0)} · Certificates: {toInt(row.cert_count, 0)} · Boosts: {toInt(row.boost_count, 0)}</div>
                    </div>
                  ))}
                  {!rewardDistributionQuery.isLoading && (rewardDistributionQuery.data?.rows?.length ?? 0) === 0 ? (
                    <div className="text-gray-500">No reward data.</div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="archive" className="space-y-3">
            <Card className="bg-neutral-900/50 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Archived Challenges</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-gray-300">
                Archived challenges are hidden from traders and kept here for audit/history. Open any item in the editor if you need to re-activate it later.
              </CardContent>
            </Card>

            <div className="overflow-x-auto rounded border border-neutral-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 text-gray-300">
                    <th className="py-2 px-2 text-left">Name</th>
                    <th className="py-2 px-2 text-right">Enrollments</th>
                    <th className="py-2 px-2 text-right">Pass Rate</th>
                    <th className="py-2 px-2 text-right">Updated</th>
                    <th className="py-2 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedTemplates.map((row) => {
                    const id = Number(row.id);
                    const isRecentlyArchived = lastArchivedId === id;
                    return (
                      <tr
                        key={id}
                        className={`border-b border-neutral-800/90 ${isRecentlyArchived ? "bg-cyan-500/10" : ""}`}
                      >
                        <td className="py-2 px-2">
                          <div className="font-medium text-white">{row.name}</div>
                          <div className="flex gap-1 mt-1">
                            <Badge variant="outline">ARCHIVED</Badge>
                            <Badge variant="outline">HIDDEN</Badge>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right">
                          {toInt(row.active_enrollment_count, 0)}/{toInt(row.enrollment_count, 0)}
                        </td>
                        <td className="py-2 px-2 text-right">{formatPct(row.pass_rate)}</td>
                        <td className="py-2 px-2 text-right">{formatWhen(row.updated_at ?? row.updatedAt)}</td>
                        <td className="py-2 px-2 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            onClick={() => {
                              setSubTab("templates");
                              setEditingId(id);
                              setExpandedId(id);
                            }}
                          >
                            Open In Editor
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!templatesQuery.isLoading && archivedTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-400">
                        No archived challenges found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-3">
            <Card className="bg-neutral-900/50 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Global Challenge Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  {SYSTEM_TOGGLES.map((key) => (
                    <label key={key} className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>{key}</span>
                      <Switch checked={Boolean(settingsDraft[key])} onCheckedChange={(c) => setSettingsDraft((p) => ({ ...p, [key]: Boolean(c) }))} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  {REWARD_TOGGLES.map((key) => (
                    <label key={key} className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>{key}</span>
                      <Switch checked={Boolean(settingsDraft[key])} onCheckedChange={(c) => setSettingsDraft((p) => ({ ...p, [key]: Boolean(c) }))} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  {NOTIFY_TOGGLES.map((key) => (
                    <label key={key} className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>{key}</span>
                      <Switch checked={Boolean(settingsDraft[key])} onCheckedChange={(c) => setSettingsDraft((p) => ({ ...p, [key]: Boolean(c) }))} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input
                    type="number"
                    value={settingsDraft.challengeEvalIntervalMin}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeEvalIntervalMin: Math.max(1, toInt(e.target.value, p.challengeEvalIntervalMin)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Eval interval (minutes)"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeEvalMaxRows}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeEvalMaxRows: Math.max(1, toInt(e.target.value, p.challengeEvalMaxRows)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Eval max rows per run"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={settingsDraft.challengeWarningThresholdPct}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeWarningThresholdPct: toNum(e.target.value, p.challengeWarningThresholdPct) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Warning threshold %"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeLeaderboardRefreshSec}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeLeaderboardRefreshSec: Math.max(10, toInt(e.target.value, p.challengeLeaderboardRefreshSec)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Leaderboard refresh (sec)"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeDefaultSelectionBoost}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultSelectionBoost: Math.max(0, toNum(e.target.value, p.challengeDefaultSelectionBoost)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default selection boost"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input
                    type="number"
                    value={settingsDraft.challengeDefaultMaxRetries}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultMaxRetries: Math.max(0, toInt(e.target.value, p.challengeDefaultMaxRetries)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default max retries"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeDefaultRetryCooldownHours}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultRetryCooldownHours: Math.max(0, toInt(e.target.value, p.challengeDefaultRetryCooldownHours)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Retry cooldown (hours)"
                  />
                  <Input
                    value={settingsDraft.challengeDefaultEligibility ?? "EMAIL_VERIFIED"}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultEligibility: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default eligibility gate"
                  />
                  <Input
                    value={settingsDraft.challengeDefaultCategory ?? "STANDARD"}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultCategory: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default challenge category"
                  />
                  <Input
                    value={settingsDraft.challengeDefaultTier ?? "STARTER"}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultTier: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default challenge tier"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {CONTROL_TOGGLES.map((key) => (
                    <label key={key} className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2 text-xs">
                      <span>{key}</span>
                      <Switch checked={Boolean(settingsDraft[key])} onCheckedChange={(c) => setSettingsDraft((p) => ({ ...p, [key]: Boolean(c) }))} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input
                    type="number"
                    value={settingsDraft.challengeEvaluationIntervalSec}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeEvaluationIntervalSec: Math.max(60, toInt(e.target.value, p.challengeEvaluationIntervalSec)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Evaluation interval (sec)"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeLeaderboardSnapshotIntervalSec}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeLeaderboardSnapshotIntervalSec: Math.max(10, toInt(e.target.value, p.challengeLeaderboardSnapshotIntervalSec)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Leaderboard snapshot (sec)"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    value={settingsDraft.challengeLeverageMultiplierDefault}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeLeverageMultiplierDefault: Math.max(0.01, toNum(e.target.value, p.challengeLeverageMultiplierDefault)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default leverage multiplier"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeWeekendCutoffHours}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeWeekendCutoffHours: Math.max(0, toInt(e.target.value, p.challengeWeekendCutoffHours)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Weekend cutoff (hours)"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input
                    type="number"
                    value={settingsDraft.challengeMaxActiveEnrollmentsUser}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeMaxActiveEnrollmentsUser: Math.max(1, toInt(e.target.value, p.challengeMaxActiveEnrollmentsUser)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Max active enrollments/user"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeMaxActiveEnrollmentsPerChallenge}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeMaxActiveEnrollmentsPerChallenge: Math.max(1, toInt(e.target.value, p.challengeMaxActiveEnrollmentsPerChallenge)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Max active enrollments/challenge"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeCooldownHoursAfterFail}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeCooldownHoursAfterFail: Math.max(0, toInt(e.target.value, p.challengeCooldownHoursAfterFail)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Cooldown after fail (hours)"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeCooldownHoursAfterWithdraw}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeCooldownHoursAfterWithdraw: Math.max(0, toInt(e.target.value, p.challengeCooldownHoursAfterWithdraw)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Cooldown after withdraw (hours)"
                  />
                  <Input
                    type="number"
                    value={settingsDraft.challengeManualReviewSuspiciousThreshold}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeManualReviewSuspiciousThreshold: Math.max(1, toInt(e.target.value, p.challengeManualReviewSuspiciousThreshold)) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Manual review suspicious threshold"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input
                    type="number"
                    value={settingsDraft.challengeCertificateDefaultTemplateId ?? ""}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeCertificateDefaultTemplateId: toOptInt(e.target.value) }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Default certificate template id"
                  />
                  <Input
                    value={settingsDraft.challengeCertificateVerificationKeyId ?? "v1"}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeCertificateVerificationKeyId: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                    placeholder="Certificate verification key id"
                  />
                  <select
                    value={String(settingsDraft.challengeLeaderboardRankingMetric || "COMPOSITE_SCORE")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeLeaderboardRankingMetric: e.target.value }))}
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="COMPOSITE_SCORE">COMPOSITE_SCORE</option>
                    <option value="PNL_PCT">PNL_PCT</option>
                  </select>
                  <select
                    value={String(settingsDraft.challengePrizeAwardTimingDefault || "ON_COMPLETE")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengePrizeAwardTimingDefault: e.target.value }))}
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="ON_COMPLETE">ON_COMPLETE</option>
                    <option value="ON_CHALLENGE_END">ON_CHALLENGE_END</option>
                    <option value="MANUAL">MANUAL</option>
                  </select>
                  <select
                    value={String(settingsDraft.challengePrizeCandidatesDefault || "PASSED_ONLY")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengePrizeCandidatesDefault: e.target.value }))}
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="PASSED_ONLY">PASSED_ONLY</option>
                    <option value="INCLUDE_ACTIVE">INCLUDE_ACTIVE</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <select
                    value={String(settingsDraft.challengeMailboxCategory || "SYSTEM")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeMailboxCategory: e.target.value }))}
                    data-hint="Mailbox category for challenge notifications"
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="SYSTEM">SYSTEM</option>
                    <option value="SUPPORT">SUPPORT</option>
                    <option value="ANNOUNCEMENT">ANNOUNCEMENT</option>
                    <option value="CHALLENGES">CHALLENGES</option>
                  </select>
                  <select
                    value={String(settingsDraft.challengeDefaultDrawdownType || "STATIC")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultDrawdownType: e.target.value }))}
                    data-hint="Default drawdown type"
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="STATIC">STATIC</option>
                    <option value="TRAILING">TRAILING</option>
                  </select>
                  <select
                    value={String(settingsDraft.challengeDefaultCapitalMode || "VIRTUAL")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeDefaultCapitalMode: e.target.value }))}
                    data-hint="Default capital mode"
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="VIRTUAL">VIRTUAL</option>
                    <option value="SNAPSHOT_EQUITY">SNAPSHOT_EQUITY</option>
                  </select>
                  <select
                    value={String(settingsDraft.challengeBreachPolicyDefault || "FAIL")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeBreachPolicyDefault: e.target.value }))}
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="FAIL">FAIL</option>
                    <option value="BREACH_AND_CONTINUE">BREACH_AND_CONTINUE</option>
                    <option value="MANUAL_REVIEW">MANUAL_REVIEW</option>
                  </select>
                  <select
                    value={String(settingsDraft.challengeSingleDayProfitBasis || "PNL_PCT")}
                    onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeSingleDayProfitBasis: e.target.value }))}
                    className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  >
                    <option value="PNL_PCT">PNL_PCT</option>
                    <option value="EQUITY_PCT">EQUITY_PCT</option>
                    <option value="REALIZED_ONLY">REALIZED_ONLY</option>
                  </select>
                </div>
                <Textarea
                  value={String(settingsDraft.challengeNewsBlackoutWindowsJson ?? "[]")}
                  onChange={(e) => setSettingsDraft((p) => ({ ...p, challengeNewsBlackoutWindowsJson: e.target.value }))}
                  className="bg-neutral-700 border-neutral-600 min-h-[72px]"
                  placeholder="News blackout windows JSON"
                />
                <div className="flex justify-end">
                  <Button onClick={() => saveSettingsMutation.mutate(settingsDraft)} disabled={saveSettingsMutation.isPending}>
                    {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Badge Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <Input value={badgeDraft.key} onChange={(e) => setBadgeDraft((p) => ({ ...p, key: e.target.value }))} placeholder="key" className="bg-neutral-700 border-neutral-600" />
                  <Input value={badgeDraft.name} onChange={(e) => setBadgeDraft((p) => ({ ...p, name: e.target.value }))} placeholder="name" className="bg-neutral-700 border-neutral-600" />
                  <Input value={badgeDraft.category} onChange={(e) => setBadgeDraft((p) => ({ ...p, category: e.target.value }))} placeholder="category" className="bg-neutral-700 border-neutral-600" />
                  <Input value={badgeDraft.iconEmoji} onChange={(e) => setBadgeDraft((p) => ({ ...p, iconEmoji: e.target.value }))} placeholder="emoji" className="bg-neutral-700 border-neutral-600" />
                  <Input value={badgeDraft.iconUrl} onChange={(e) => setBadgeDraft((p) => ({ ...p, iconUrl: e.target.value }))} placeholder="icon url" className="bg-neutral-700 border-neutral-600" />
                  <Textarea value={badgeDraft.description} onChange={(e) => setBadgeDraft((p) => ({ ...p, description: e.target.value }))} placeholder="description" className="bg-neutral-700 border-neutral-600 min-h-[56px]" />
                  <Textarea value={badgeDraft.criteriaJson} onChange={(e) => setBadgeDraft((p) => ({ ...p, criteriaJson: e.target.value }))} placeholder="criteria json" className="bg-neutral-700 border-neutral-600 min-h-[56px]" />
                  <div className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                    <span>Active</span>
                    <Switch checked={badgeDraft.isActive} onCheckedChange={(c) => setBadgeDraft((p) => ({ ...p, isActive: Boolean(c) }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => upsertBadgeMutation.mutate(badgeDraft)} disabled={!badgeDraft.key || !badgeDraft.name}>
                      {badgeDraft.id ? "Update" : "Create"}
                    </Button>
                    <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setBadgeDraft({ ...EMPTY_BADGE })}>
                      Clear
                    </Button>
                  </div>
                  <div className="max-h-44 overflow-auto space-y-1">
                    {(badgesQuery.data?.rows ?? []).map((row: AnyRow) => (
                      <div key={row.id} className="rounded border border-neutral-700 p-2">
                        <div className="flex justify-between">
                          <span>{row.name}</span>
                          <Badge variant={row.isActive ? "secondary" : "outline"}>{row.isActive ? "ACTIVE" : "OFF"}</Badge>
                        </div>
                        <div className="text-gray-500">{row.key}</div>
                        <div className="flex gap-2 mt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            onClick={() =>
                              setBadgeDraft({
                                id: row.id,
                                key: row.key,
                                name: row.name,
                                description: row.description || "",
                                category: row.category || "CHALLENGE",
                                iconEmoji: row.iconEmoji || "",
                                iconUrl: row.iconUrl || "",
                                criteriaJson: row.criteriaJson || "{}",
                                isActive: Boolean(row.isActive),
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => deleteBadgeMutation.mutate(Number(row.id))}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Certificate Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <Input value={certDraft.name} onChange={(e) => setCertDraft((p) => ({ ...p, name: e.target.value }))} placeholder="name" className="bg-neutral-700 border-neutral-600" />
                  <Input value={certDraft.headerText} onChange={(e) => setCertDraft((p) => ({ ...p, headerText: e.target.value }))} placeholder="header" className="bg-neutral-700 border-neutral-600" />
                  <Textarea value={certDraft.bodyText} onChange={(e) => setCertDraft((p) => ({ ...p, bodyText: e.target.value }))} placeholder="body" className="bg-neutral-700 border-neutral-600 min-h-[70px]" />
                  <Input value={certDraft.brandColor} onChange={(e) => setCertDraft((p) => ({ ...p, brandColor: e.target.value }))} placeholder="brand color" className="bg-neutral-700 border-neutral-600" />
                  <Input value={certDraft.logoUrl} onChange={(e) => setCertDraft((p) => ({ ...p, logoUrl: e.target.value }))} placeholder="logo url" className="bg-neutral-700 border-neutral-600" />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>Metrics</span>
                      <Switch checked={certDraft.includeMetrics} onCheckedChange={(c) => setCertDraft((p) => ({ ...p, includeMetrics: Boolean(c) }))} />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>Verify Code</span>
                      <Switch checked={certDraft.includeVerificationCode} onCheckedChange={(c) => setCertDraft((p) => ({ ...p, includeVerificationCode: Boolean(c) }))} />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>Downloadable</span>
                      <Switch checked={certDraft.isDownloadable} onCheckedChange={(c) => setCertDraft((p) => ({ ...p, isDownloadable: Boolean(c) }))} />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span>Shareable</span>
                      <Switch checked={certDraft.isShareable} onCheckedChange={(c) => setCertDraft((p) => ({ ...p, isShareable: Boolean(c) }))} />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => upsertCertMutation.mutate(certDraft)} disabled={!certDraft.name.trim()}>
                      {certDraft.id ? "Update" : "Create"}
                    </Button>
                    <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setCertDraft({ ...EMPTY_CERT })}>
                      Clear
                    </Button>
                  </div>
                  <div className="max-h-44 overflow-auto space-y-1">
                    {(certTemplatesQuery.data?.rows ?? []).map((row: AnyRow) => (
                      <div key={row.id} className="rounded border border-neutral-700 p-2">
                        <div className="flex justify-between">
                          <span>{row.name}</span>
                          <Badge variant={row.isActive ? "secondary" : "outline"}>{row.isActive ? "ACTIVE" : "OFF"}</Badge>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            onClick={() =>
                              setCertDraft({
                                id: row.id,
                                name: row.name,
                                headerText: row.headerText || "",
                                bodyText: row.bodyText || "",
                                brandColor: row.brandColor || "",
                                logoUrl: row.logoUrl || "",
                                includeMetrics: Boolean(row.includeMetrics),
                                includeVerificationCode: Boolean(row.includeVerificationCode),
                                isDownloadable: Boolean(row.isDownloadable),
                                isShareable: Boolean(row.isShareable),
                                isActive: Boolean(row.isActive),
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => deleteCertMutation.mutate(Number(row.id))}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-neutral-900/50 border-neutral-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Progression Tiers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <Input value={tierDraft.name} onChange={(e) => setTierDraft((p) => ({ ...p, name: e.target.value }))} placeholder="name" className="bg-neutral-700 border-neutral-600" />
                  <Input value={tierDraft.description} onChange={(e) => setTierDraft((p) => ({ ...p, description: e.target.value }))} placeholder="description" className="bg-neutral-700 border-neutral-600" />
                  <Textarea value={tierDraft.tiersJson} onChange={(e) => setTierDraft((p) => ({ ...p, tiersJson: e.target.value }))} placeholder="tiers json" className="bg-neutral-700 border-neutral-600 min-h-[80px]" />
                  <div className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                    <span>Active</span>
                    <Switch checked={tierDraft.isActive} onCheckedChange={(c) => setTierDraft((p) => ({ ...p, isActive: Boolean(c) }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => upsertTierMutation.mutate(tierDraft)} disabled={!tierDraft.name.trim()}>
                      {tierDraft.id ? "Update" : "Create"}
                    </Button>
                    <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setTierDraft({ ...EMPTY_TIER })}>
                      Clear
                    </Button>
                  </div>
                  <div className="max-h-44 overflow-auto space-y-1">
                    {(tiersQuery.data?.rows ?? []).map((row: AnyRow) => (
                      <div key={row.id} className="rounded border border-neutral-700 p-2">
                        <div className="flex justify-between">
                          <span>{row.name}</span>
                          <Badge variant={row.isActive ? "secondary" : "outline"}>{row.isActive ? "ACTIVE" : "OFF"}</Badge>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            onClick={() =>
                              setTierDraft({
                                id: row.id,
                                name: row.name,
                                description: row.description || "",
                                tiersJson: row.tiersJson || "[]",
                                isActive: Boolean(row.isActive),
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => deleteTierMutation.mutate(Number(row.id))}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        <AlertDialog
          open={deleteTarget != null}
          onOpenChange={(open) => {
            if (!open && !deleteTemplateMutation.isPending) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent className="bg-neutral-900 border-neutral-700 text-gray-100">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Challenge Template?</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-300">
                This action permanently removes <span className="font-semibold text-white">{deleteTarget?.name || "this challenge"}</span> and cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="border-neutral-600 bg-transparent text-gray-200 hover:bg-neutral-800"
                disabled={deleteTemplateMutation.isPending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-500 text-white"
                disabled={deleteTemplateMutation.isPending || !deleteTarget}
                onClick={(event) => {
                  if (!deleteTarget) {
                    event.preventDefault();
                    return;
                  }
                  deleteTemplateMutation.mutate(Number(deleteTarget.id));
                }}
              >
                {deleteTemplateMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
