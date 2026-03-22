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
import {
  challengeEvalIntervalSecFromMinutes,
  DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
  normalizeChallengeEvalIntervalMin,
} from "@shared/challenges/systemConfig";

type AnyRow = Record<string, any>;
type InlineTemplateDraft = { profitTargetPct: string; maxDailyLossPct: string; durationDays: string };
export const LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL = 100000;

export const EMPTY_DRAFT = {
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

export const EMPTY_BADGE = {
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

export const EMPTY_CERT = {
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

export const EMPTY_TIER = {
  id: 0,
  name: "",
  description: "",
  tiersJson: "[]",
  isActive: true,
};

export const DEFAULT_SETTINGS: Record<string, any> = {
  traderCompeteEnabled: false,
  challengeAutoAdvancePhase: true,
  challengeEvalIntervalMin: DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
  challengeEvalMaxRows: 500,
  challengeEvaluationIntervalSec: challengeEvalIntervalSecFromMinutes(DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN),
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

export const SYSTEM_TOGGLES = ["traderCompeteEnabled", "challengeAutoAdvancePhase", "challengeLeaderboardEnabled"];
export const REWARD_TOGGLES = [
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
export const NOTIFY_TOGGLES = [
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
export const CONTROL_TOGGLES = [
  "challengeForceCloseBeforeWeekend",
  "challengeCertificateIncludeMetricsDefault",
  "challengeCertificateIncludeQrDefault",
  "challengeAuditStrictMode",
  "challengeAnomalyDetectionEnabled",
  "challengeManualReviewEnabled",
];
export const ELIGIBILITY_GATE_MODES = new Set(["NONE", "EMAIL_VERIFIED", "CONTENDER", "ADMIN_APPROVED"]);
export const HOVER_HINT_SELECTOR = "input,select,textarea,button,[role='switch']";

export function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toInt(value: unknown, fallback = 0): number {
  return Math.trunc(toNum(value, fallback));
}

export function applyChallengeSchedulerIntervalDraft(
  draft: Record<string, any>,
  intervalMin: unknown,
): Record<string, any> {
  const fallbackMin = normalizeChallengeEvalIntervalMin(
    draft.challengeEvalIntervalMin,
    DEFAULT_CHALLENGE_EVAL_INTERVAL_MIN,
  );
  const nextIntervalMin = normalizeChallengeEvalIntervalMin(intervalMin, fallbackMin);
  return {
    ...draft,
    challengeEvalIntervalMin: nextIntervalMin,
    challengeEvaluationIntervalSec: challengeEvalIntervalSecFromMinutes(nextIntervalMin),
  };
}

export function toOptNum(value: string): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function toOptInt(value: string): number | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function isEligibilityGateValid(value: string): boolean {
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

export function formatPct(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

export function normalizeHintText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isArchivedTemplateRow(row: AnyRow): boolean {
  const isActive = Boolean(row.isActive ?? row.is_active);
  const visibleToTraders = Boolean(row.visibleToTraders ?? row.visible_to_traders);
  return !isActive && !visibleToTraders;
}

export function buildInlineTemplateDraft(row: AnyRow): InlineTemplateDraft {
  return {
    profitTargetPct: String(toNum(row.profit_target_pct ?? row.profitTargetPct, 0.1)),
    maxDailyLossPct: String(toNum(row.max_daily_loss_pct ?? row.maxDailyLossPct, 0.03)),
    durationDays: String(Math.max(1, toInt(row.duration_days ?? row.durationDays, 30))),
  };
}

export function isInlineTemplateDraftEqual(left: InlineTemplateDraft, right: InlineTemplateDraft): boolean {
  return (
    left.profitTargetPct === right.profitTargetPct &&
    left.maxDailyLossPct === right.maxDailyLossPct &&
    left.durationDays === right.durationDays
  );
}

export function toChallengeListRowPatch(row: AnyRow): AnyRow {
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

export function inferHoverHint(control: HTMLElement): string {
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

export function applyHoverHints(root: HTMLElement): void {
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

export function formatUsd(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString()}`;
}

export function formatWhen(utcSec: unknown): string {
  return formatUnixSecondsToLocaleString(Number(utcSec));
}

export function statusVariant(status: unknown): "default" | "secondary" | "destructive" | "outline" {
  const s = String(status || "").toUpperCase();
  if (s === "PASSED" || s === "COMPLETED") return "default";
  if (s === "FAILED" || s === "DISQUALIFIED") return "destructive";
  if (s === "REVIEW_REQUIRED") return "outline";
  if (s === "ACTIVE") return "secondary";
  return "outline";
}

export function daysLeftLabel(endAtSec: number): string {
  const delta = endAtSec - Math.floor(Date.now() / 1000);
  if (delta <= 0) return "Expired";
  const d = Math.floor(delta / 86400);
  const h = Math.floor((delta % 86400) / 3600);
  return `${d}d ${h}h`;
}

export function mapDetailToDraft(detail: AnyRow, defaultChallengeVirtualCapitalUsd = LEGACY_DEFAULT_CHALLENGE_VIRTUAL_CAPITAL): typeof EMPTY_DRAFT {
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
