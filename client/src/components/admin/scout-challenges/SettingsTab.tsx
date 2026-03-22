import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTROL_TOGGLES,
  EMPTY_BADGE,
  EMPTY_CERT,
  EMPTY_TIER,
  NOTIFY_TOGGLES,
  REWARD_TOGGLES,
  SYSTEM_TOGGLES,
  applyChallengeSchedulerIntervalDraft,
  toInt,
  toNum,
  toOptInt,
} from "./support";

type AnyRow = Record<string, any>;

interface ScoutChallengesSettingsTabProps {
  settingsDraft: Record<string, any>;
  setSettingsDraft: Dispatch<SetStateAction<Record<string, any>>>;
  effectiveScheduler?: {
    nextRunAtMs?: number | null;
    runtime?: {
      enabled: boolean;
      intervalMin: number;
      intervalSec: number;
      maxRows: number;
      source: string;
    } | null;
  } | null;
  saveSettingsPending: boolean;
  onSaveSettings: () => void;
  badgeDraft: typeof EMPTY_BADGE;
  setBadgeDraft: Dispatch<SetStateAction<typeof EMPTY_BADGE>>;
  badges: AnyRow[];
  onUpsertBadge: () => void;
  onDeleteBadge: (badgeId: number) => void;
  certDraft: typeof EMPTY_CERT;
  setCertDraft: Dispatch<SetStateAction<typeof EMPTY_CERT>>;
  certTemplates: AnyRow[];
  onUpsertCert: () => void;
  onDeleteCert: (templateId: number) => void;
  tierDraft: typeof EMPTY_TIER;
  setTierDraft: Dispatch<SetStateAction<typeof EMPTY_TIER>>;
  tiers: AnyRow[];
  onUpsertTier: () => void;
  onDeleteTier: (tierId: number) => void;
}

export function ScoutChallengesSettingsTab({
  settingsDraft,
  setSettingsDraft,
  effectiveScheduler,
  saveSettingsPending,
  onSaveSettings,
  badgeDraft,
  setBadgeDraft,
  badges,
  onUpsertBadge,
  onDeleteBadge,
  certDraft,
  setCertDraft,
  certTemplates,
  onUpsertCert,
  onDeleteCert,
  tierDraft,
  setTierDraft,
  tiers,
  onUpsertTier,
  onDeleteTier,
}: ScoutChallengesSettingsTabProps) {
  return (
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
              onChange={(e) =>
                setSettingsDraft((p) =>
                  applyChallengeSchedulerIntervalDraft(
                    p,
                    Math.max(1, toInt(e.target.value, p.challengeEvalIntervalMin)),
                  ),
                )
              }
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
              readOnly
              disabled
              className="bg-neutral-800 border-neutral-700 text-neutral-400"
              placeholder="Evaluation interval (sec, deprecated)"
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
          <div className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
            <div className="font-medium">Legacy scheduler field retired</div>
            <div className="mt-1">
              <code>challengeEvaluationIntervalSec</code> is now read-only in Wave 0. The active scheduler cadence is controlled through <code>challengeEvalIntervalMin</code>.
            </div>
          </div>
          {effectiveScheduler?.runtime ? (
            <div className="rounded border border-cyan-700/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-100/90">
              <div className="font-medium">Effective scheduler state</div>
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-cyan-200/70">Source</div>
                  <div>{effectiveScheduler.runtime.source}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-cyan-200/70">Interval</div>
                  <div>
                    {effectiveScheduler.runtime.intervalMin} min / {effectiveScheduler.runtime.intervalSec} sec
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-cyan-200/70">Max rows</div>
                  <div>{effectiveScheduler.runtime.maxRows}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-cyan-200/70">Next run</div>
                  <div>
                    {effectiveScheduler.nextRunAtMs
                      ? new Date(effectiveScheduler.nextRunAtMs).toLocaleString()
                      : "Not scheduled"}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
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
            <Button onClick={onSaveSettings} disabled={saveSettingsPending}>
              {saveSettingsPending ? "Saving..." : "Save Settings"}
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
              <Button size="sm" onClick={onUpsertBadge} disabled={!badgeDraft.key || !badgeDraft.name}>
                {badgeDraft.id ? "Update" : "Create"}
              </Button>
              <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setBadgeDraft({ ...EMPTY_BADGE })}>
                Clear
              </Button>
            </div>
            <div className="max-h-44 overflow-auto space-y-1">
              {badges.map((row) => (
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
                    <Button size="sm" variant="destructive" onClick={() => onDeleteBadge(Number(row.id))}>
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
              <Button size="sm" onClick={onUpsertCert} disabled={!certDraft.name.trim()}>
                {certDraft.id ? "Update" : "Create"}
              </Button>
              <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setCertDraft({ ...EMPTY_CERT })}>
                Clear
              </Button>
            </div>
            <div className="max-h-44 overflow-auto space-y-1">
              {certTemplates.map((row) => (
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
                    <Button size="sm" variant="destructive" onClick={() => onDeleteCert(Number(row.id))}>
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
              <Button size="sm" onClick={onUpsertTier} disabled={!tierDraft.name.trim()}>
                {tierDraft.id ? "Update" : "Create"}
              </Button>
              <Button size="sm" variant="outline" className="border-neutral-600" onClick={() => setTierDraft({ ...EMPTY_TIER })}>
                Clear
              </Button>
            </div>
            <div className="max-h-44 overflow-auto space-y-1">
              {tiers.map((row) => (
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
                    <Button size="sm" variant="destructive" onClick={() => onDeleteTier(Number(row.id))}>
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
  );
}
