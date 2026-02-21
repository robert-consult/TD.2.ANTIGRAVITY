import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ActivityConfig = {
  inactivityThresholdDays: number;
  deletionGraceDays: number;
  botScoreThreshold: number;

  botPowEnabled: boolean;
  botPowEnforceSignup: boolean;
  botPowEnforceLogin: boolean;
  botPowChallengeScore: number;
  botPowBaseDifficulty: number;
  botPowMaxDifficulty: number;
  botPowTtlSec: number;
  botValkeyEnabled: boolean;

  activityAutoQueueInactive: boolean;
  activityAutoSoftDelete: boolean;
};

type Row = {
  userId: number;
  email: string;
  username: string;
  isDisabled: boolean;
  isDeleted: boolean;
  deletionExempt: boolean;
  createdAt: number;
  lastActiveAt: number;
  inactiveDays: number;
  botScore: number;
  botLabel: string;
  queueStatus?: string;
  queueReason?: string;
  queuedAt?: number;
  graceExpiresAt?: number;
};

function fmtTs(sec?: number) {
  if (!sec) return "-";
  return new Date(sec * 1000).toLocaleString();
}

async function apiJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  return (await res.json()) as T;
}

const ACTIVITY_FIELD_HELP = {
  overview: {
    inline: "Control inactivity and bot-risk lifecycle actions, including queueing, exemptions, and deletion operations.",
    tooltip:
      "Activity controls are high impact and can remove user access or records. Always validate filter scope, selected users, and reason notes before executing mutations.",
  },
  inactivityThresholdDays: {
    inline: "Days without activity before an account qualifies as inactive.",
    tooltip:
      "Accounts exceeding this threshold are eligible for inactivity workflows. Lower values increase queue volume and deletion pressure.",
  },
  deletionGraceDays: {
    inline: "Grace period between queueing and deletion eligibility.",
    tooltip:
      "Defines waiting time after queueing before deletion actions should proceed. Extend for safer user recovery windows.",
  },
  sweepDryRun: {
    inline: "Preview inactivity sweep effects without mutating records.",
    tooltip:
      "Dry run reports candidate impact and should be executed before apply sweeps in production.",
  },
  sweepApply: {
    inline: "Execute inactivity sweep with real state changes.",
    tooltip:
      "Apply sweep can queue or mark users based on config. Use only after dry-run validation.",
  },
  autoQueueInactive: {
    inline: "Automatically queue inactive users during sweep cycles.",
    tooltip:
      "Enabling auto-queue moves qualifying inactive users into deletion workflow without manual selection.",
  },
  autoSoftDelete: {
    inline: "Automatically soft-delete queued users after grace expires.",
    tooltip:
      "Auto soft-delete advances lifecycle progression after grace. Keep disabled if manual approval is required.",
  },
  botScoreThreshold: {
    inline: "Score threshold to classify suspicious bot-like behavior.",
    tooltip:
      "Lowering threshold increases flagged population; raising threshold reduces sensitivity.",
  },
  challengeScore: {
    inline: "Score level that triggers proof-of-work challenge requirement.",
    tooltip:
      "Users at or above this score require additional anti-bot proof flow before continuing.",
  },
  baseDifficulty: {
    inline: "Starting proof-of-work challenge difficulty.",
    tooltip:
      "Base difficulty controls minimum anti-bot puzzle hardness before adaptive scaling.",
  },
  maxDifficulty: {
    inline: "Upper bound for adaptive proof-of-work difficulty.",
    tooltip:
      "Caps anti-bot challenge hardness to avoid excessive user friction on false positives.",
  },
  ttlSec: {
    inline: "Proof-of-work challenge validity duration in seconds.",
    tooltip:
      "Expired challenges require regeneration. Too short increases retry churn; too long weakens abuse resistance.",
  },
  powEnabled: {
    inline: "Master switch for proof-of-work enforcement.",
    tooltip:
      "Disable only for incident response or controlled environments. Normal production posture should keep this enabled.",
  },
  enforceSignup: {
    inline: "Apply proof-of-work to signup flow.",
    tooltip:
      "Protects registration path from automated abuse and fake account bursts.",
  },
  enforceLogin: {
    inline: "Apply proof-of-work to login flow.",
    tooltip:
      "Use to throttle credential-stuffing pressure when login abuse patterns increase.",
  },
  valkeyEnabled: {
    inline: "Use Valkey-backed anti-bot state/cache.",
    tooltip:
      "Valkey support improves anti-bot state handling and replay resilience in distributed workloads.",
  },
  minInactiveDays: {
    inline: "List filter for minimum inactivity age in days.",
    tooltip:
      "Filters current table rows by inactivity age for targeted batch actions.",
  },
  inactiveOnly: {
    inline: "Show only inactivity-qualified users.",
    tooltip:
      "Narrows table to users matching inactivity posture before queue/delete actions.",
  },
  botsOnly: {
    inline: "Show only users with bot-related risk signals.",
    tooltip:
      "Focuses list on bot-labeled users to simplify abuse-response workflows.",
  },
  includeDeleted: {
    inline: "Include already deleted records in results.",
    tooltip:
      "Enable for forensic review; disable for active operations to reduce noise.",
  },
  note: {
    inline: "Operator note appended to queue/exempt/delete actions.",
    tooltip:
      "Provide a concise reason for audit traceability and shift handoff clarity.",
  },
  queueDeletion: {
    inline: "Queue selected users for deletion workflow.",
    tooltip:
      "Queues selected users with inferred reason (inactive, bot, or admin). Verify selection before running.",
  },
  cancelQueue: {
    inline: "Remove selected users from deletion queue.",
    tooltip:
      "Use when queueing was premature or remediation was completed.",
  },
  exempt: {
    inline: "Mark selected users as deletion-exempt.",
    tooltip:
      "Exempted users are shielded from standard deletion automation until exemption is removed.",
  },
  unexempt: {
    inline: "Remove deletion exemption from selected users.",
    tooltip:
      "Returns selected users to normal inactivity/bot lifecycle rules.",
  },
  softDelete: {
    inline: "Soft-delete selected users now.",
    tooltip:
      "Soft delete disables active presence while preserving key records. Use for reversible operational cleanup.",
  },
  hardDelete: {
    inline: "Hard-delete selected users with irreversible cleanup.",
    tooltip:
      "Hard delete is destructive and requires explicit confirmation. Keep usage limited to approved exceptional cases.",
  },
  rowSelection: {
    inline: "Select rows for batch operations.",
    tooltip:
      "Batch mutations apply only to checked rows. Re-check visible filter scope before action.",
  },
} as const;

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

export default function UserActivityAdmin() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [botsOnly, setBotsOnly] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState("");

  const { data: cfg } = useQuery({
    queryKey: ["admin-activity-config"],
    queryFn: async () => apiJson<ActivityConfig>("GET", "/api/admin/activity/config"),
  });

  const { data: list } = useQuery({
    queryKey: ["admin-activity-users", days, inactiveOnly, botsOnly, includeDeleted],
    queryFn: async () => {
      const qs = new URLSearchParams({
        days: String(days),
        inactiveOnly: inactiveOnly ? "1" : "0",
        botsOnly: botsOnly ? "1" : "0",
        includeDeleted: includeDeleted ? "1" : "0",
      });
      return apiJson<{ days: number; rows: Row[] }>("GET", `/api/admin/activity/users?${qs.toString()}`);
    },
  });

  const rows = list?.rows ?? [];
  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k)),
    [selected]
  );

  const updateCfg = useMutation({
    mutationFn: async (next: Partial<ActivityConfig>) => {
      await apiRequest("PUT", "/api/admin/activity/config", { ...cfg, ...next });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-activity-config"] });
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const runSweep = useMutation({
    mutationFn: async (dryRun: boolean) => apiJson("POST", "/api/admin/activity/sweep", { dryRun }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const queue = useMutation({
    mutationFn: async (payload: { userIds: number[]; reason: "INACTIVE" | "BOT" | "ADMIN"; note?: string }) =>
      apiJson("POST", "/api/admin/activity/queue", payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const cancelQueue = useMutation({
    mutationFn: async (payload: { userIds: number[]; note?: string }) => apiJson("POST", "/api/admin/activity/cancel", payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const exempt = useMutation({
    mutationFn: async (payload: { userIds: number[]; exempt: boolean; note?: string }) =>
      apiJson("POST", "/api/admin/activity/exempt", payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const softDelete = useMutation({
    mutationFn: async () =>
      apiJson("POST", "/api/admin/activity/soft-delete", { userIds: selectedIds, reason: note || "admin-soft-delete" }),
    onSuccess: async () => {
      setSelected({});
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const hardDelete = useMutation({
    mutationFn: async () =>
      apiJson("POST", "/api/admin/activity/hard-delete", { userIds: selectedIds, reason: note || "admin-hard-delete" }),
    onSuccess: async () => {
      setSelected({});
      await qc.invalidateQueries({ queryKey: ["admin-activity-users"] });
    },
  });

  const canAct = selectedIds.length > 0;
  const inferredReason: "INACTIVE" | "BOT" | "ADMIN" = inactiveOnly ? "INACTIVE" : botsOnly ? "BOT" : "ADMIN";

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-4">
        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
          <FieldHintLabel
            label="Activity Lifecycle Controls"
            hint={ACTIVITY_FIELD_HELP.overview.tooltip}
            labelClassName="text-sm font-medium"
          />
          <p className="text-xs text-cyan-100/90 mt-1">{ACTIVITY_FIELD_HELP.overview.inline}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Card className="border-gray-800 bg-neutral-800 text-white">
            <CardHeader className="pb-2">
              <FieldHintLabel label="Inactivity Deletion" hint={ACTIVITY_FIELD_HELP.overview.tooltip} labelClassName="text-sm" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldHintLabel
                    label="Inactivity Threshold (days)"
                    hint={ACTIVITY_FIELD_HELP.inactivityThresholdDays.tooltip}
                    labelClassName="text-xs text-gray-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.inactivityThresholdDays.inline}</p>
                  <Input
                    value={cfg?.inactivityThresholdDays ?? 90}
                    title={ACTIVITY_FIELD_HELP.inactivityThresholdDays.tooltip}
                    onChange={(e) => updateCfg.mutate({ inactivityThresholdDays: Number(e.target.value || 90) })}
                  />
                </div>
                <div>
                  <FieldHintLabel
                    label="Grace Period (days)"
                    hint={ACTIVITY_FIELD_HELP.deletionGraceDays.tooltip}
                    labelClassName="text-xs text-gray-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.deletionGraceDays.inline}</p>
                  <Input
                    value={cfg?.deletionGraceDays ?? 30}
                    title={ACTIVITY_FIELD_HELP.deletionGraceDays.tooltip}
                    onChange={(e) => updateCfg.mutate({ deletionGraceDays: Number(e.target.value || 30) })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => runSweep.mutate(true)}
                  disabled={runSweep.isPending}
                  title={ACTIVITY_FIELD_HELP.sweepDryRun.tooltip}
                >
                  Sweep (Dry Run)
                </Button>
                <Button onClick={() => runSweep.mutate(false)} disabled={runSweep.isPending} title={ACTIVITY_FIELD_HELP.sweepApply.tooltip}>
                  Sweep (Apply)
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-300">
                <label className="flex items-center gap-2" title={ACTIVITY_FIELD_HELP.autoQueueInactive.tooltip}>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg?.activityAutoQueueInactive ?? true)}
                    onChange={(e) => updateCfg.mutate({ activityAutoQueueInactive: e.target.checked })}
                  />
                  Auto-queue inactive
                </label>
                <label className="flex items-center gap-2" title={ACTIVITY_FIELD_HELP.autoSoftDelete.tooltip}>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg?.activityAutoSoftDelete ?? false)}
                    onChange={(e) => updateCfg.mutate({ activityAutoSoftDelete: e.target.checked })}
                  />
                  Auto soft-delete after grace
                </label>
              </div>
              <p className="text-xs text-gray-400">
                {ACTIVITY_FIELD_HELP.autoQueueInactive.inline} {ACTIVITY_FIELD_HELP.autoSoftDelete.inline}
              </p>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-neutral-800 text-white">
            <CardHeader className="pb-2">
              <FieldHintLabel label="Bot Detection (PoW)" hint={ACTIVITY_FIELD_HELP.powEnabled.tooltip} labelClassName="text-sm" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldHintLabel label="Bot Score Threshold" hint={ACTIVITY_FIELD_HELP.botScoreThreshold.tooltip} labelClassName="text-xs text-gray-300" />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.botScoreThreshold.inline}</p>
                  <Input
                    value={cfg?.botScoreThreshold ?? 40}
                    title={ACTIVITY_FIELD_HELP.botScoreThreshold.tooltip}
                    onChange={(e) => updateCfg.mutate({ botScoreThreshold: Number(e.target.value || 40) })}
                  />
                </div>
                <div>
                  <FieldHintLabel label="Challenge Score (require proof)" hint={ACTIVITY_FIELD_HELP.challengeScore.tooltip} labelClassName="text-xs text-gray-300" />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.challengeScore.inline}</p>
                  <Input
                    value={cfg?.botPowChallengeScore ?? 25}
                    title={ACTIVITY_FIELD_HELP.challengeScore.tooltip}
                    onChange={(e) => updateCfg.mutate({ botPowChallengeScore: Number(e.target.value || 25) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <FieldHintLabel label="Base Diff" hint={ACTIVITY_FIELD_HELP.baseDifficulty.tooltip} labelClassName="text-xs text-gray-300" />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.baseDifficulty.inline}</p>
                  <Input
                    value={cfg?.botPowBaseDifficulty ?? 14}
                    title={ACTIVITY_FIELD_HELP.baseDifficulty.tooltip}
                    onChange={(e) => updateCfg.mutate({ botPowBaseDifficulty: Number(e.target.value || 14) })}
                  />
                </div>
                <div>
                  <FieldHintLabel label="Max Diff" hint={ACTIVITY_FIELD_HELP.maxDifficulty.tooltip} labelClassName="text-xs text-gray-300" />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.maxDifficulty.inline}</p>
                  <Input
                    value={cfg?.botPowMaxDifficulty ?? 20}
                    title={ACTIVITY_FIELD_HELP.maxDifficulty.tooltip}
                    onChange={(e) => updateCfg.mutate({ botPowMaxDifficulty: Number(e.target.value || 20) })}
                  />
                </div>
                <div>
                  <FieldHintLabel label="TTL (sec)" hint={ACTIVITY_FIELD_HELP.ttlSec.tooltip} labelClassName="text-xs text-gray-300" />
                  <p className="text-xs text-gray-400 mt-1">{ACTIVITY_FIELD_HELP.ttlSec.inline}</p>
                  <Input
                    value={cfg?.botPowTtlSec ?? 120}
                    title={ACTIVITY_FIELD_HELP.ttlSec.tooltip}
                    onChange={(e) => updateCfg.mutate({ botPowTtlSec: Number(e.target.value || 120) })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-300">
                <label className="flex items-center gap-2" title={ACTIVITY_FIELD_HELP.powEnabled.tooltip}>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg?.botPowEnabled ?? true)}
                    onChange={(e) => updateCfg.mutate({ botPowEnabled: e.target.checked })}
                  />
                  PoW enabled
                </label>
                <label className="flex items-center gap-2" title={ACTIVITY_FIELD_HELP.enforceSignup.tooltip}>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg?.botPowEnforceSignup ?? true)}
                    onChange={(e) => updateCfg.mutate({ botPowEnforceSignup: e.target.checked })}
                  />
                  Enforce on signup
                </label>
                <label className="flex items-center gap-2" title={ACTIVITY_FIELD_HELP.enforceLogin.tooltip}>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg?.botPowEnforceLogin ?? false)}
                    onChange={(e) => updateCfg.mutate({ botPowEnforceLogin: e.target.checked })}
                  />
                  Enforce on login
                </label>
                <label className="flex items-center gap-2" title={ACTIVITY_FIELD_HELP.valkeyEnabled.tooltip}>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg?.botValkeyEnabled ?? true)}
                    onChange={(e) => updateCfg.mutate({ botValkeyEnabled: e.target.checked })}
                  />
                  Valkey enabled
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-800 bg-neutral-800 text-white">
          <CardHeader className="pb-2">
            <FieldHintLabel label="Users" hint={ACTIVITY_FIELD_HELP.rowSelection.tooltip} labelClassName="text-sm" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col gap-1 min-w-[220px]">
                <FieldHintLabel label="Min inactive days" hint={ACTIVITY_FIELD_HELP.minInactiveDays.tooltip} labelClassName="text-xs text-gray-300" />
                <Input
                  className="w-24"
                  value={days}
                  title={ACTIVITY_FIELD_HELP.minInactiveDays.tooltip}
                  onChange={(e) => setDays(Number(e.target.value || 0))}
                />
              </div>

              <Button variant={inactiveOnly ? "default" : "secondary"} onClick={() => setInactiveOnly((v) => !v)} title={ACTIVITY_FIELD_HELP.inactiveOnly.tooltip}>
                Inactive Only
              </Button>
              <Button variant={botsOnly ? "default" : "secondary"} onClick={() => setBotsOnly((v) => !v)} title={ACTIVITY_FIELD_HELP.botsOnly.tooltip}>
                Bots Only
              </Button>
              <Button
                variant={includeDeleted ? "default" : "secondary"}
                onClick={() => setIncludeDeleted((v) => !v)}
                title={ACTIVITY_FIELD_HELP.includeDeleted.tooltip}
              >
                Include Deleted
              </Button>

              <div className="flex-1" />

              <Input
                className="max-w-[280px]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note / reason (optional)"
                title={ACTIVITY_FIELD_HELP.note.tooltip}
              />

              <Button
                variant="secondary"
                disabled={!canAct || queue.isPending}
                onClick={() => queue.mutate({ userIds: selectedIds, reason: inferredReason, note: note || undefined })}
                title={ACTIVITY_FIELD_HELP.queueDeletion.tooltip}
              >
                Queue Deletion
              </Button>
              <Button
                variant="secondary"
                disabled={!canAct || cancelQueue.isPending}
                onClick={() => cancelQueue.mutate({ userIds: selectedIds, note: note || undefined })}
                title={ACTIVITY_FIELD_HELP.cancelQueue.tooltip}
              >
                Cancel Queue
              </Button>
              <Button
                variant="secondary"
                disabled={!canAct || exempt.isPending}
                onClick={() => exempt.mutate({ userIds: selectedIds, exempt: true, note: note || undefined })}
                title={ACTIVITY_FIELD_HELP.exempt.tooltip}
              >
                Exempt
              </Button>
              <Button
                variant="secondary"
                disabled={!canAct || exempt.isPending}
                onClick={() => exempt.mutate({ userIds: selectedIds, exempt: false, note: note || undefined })}
                title={ACTIVITY_FIELD_HELP.unexempt.tooltip}
              >
                Unexempt
              </Button>
              <Button disabled={!canAct || softDelete.isPending} onClick={() => softDelete.mutate()} title={ACTIVITY_FIELD_HELP.softDelete.tooltip}>
                Soft Delete Now
              </Button>
              <Button
                variant="destructive"
                disabled={!canAct || hardDelete.isPending}
                title={ACTIVITY_FIELD_HELP.hardDelete.tooltip}
                onClick={() => {
                  const ok = confirm(
                    "HARD DELETE selected users now? This purges sessions/settings/journal/login history/notes/bot assessments and scrubs the user record. Trades/legal ledgers remain for audit integrity."
                  );
                  if (!ok) return;
                  const phrase = prompt('Type \"HARD DELETE\" to confirm');
                  if (phrase !== "HARD DELETE") return;
                  hardDelete.mutate();
                }}
              >
                Hard Delete Now
              </Button>
            </div>

            <p className="text-xs text-gray-400">
              {ACTIVITY_FIELD_HELP.note.inline} {ACTIVITY_FIELD_HELP.rowSelection.inline}
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-gray-700">
                    <TableHead className="w-[44px]" title={ACTIVITY_FIELD_HELP.rowSelection.tooltip}>Sel</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead>Inactive Days</TableHead>
                    <TableHead>Bot</TableHead>
                    <TableHead>Queue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.userId} className="border-b border-gray-700">
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[r.userId])}
                          title={ACTIVITY_FIELD_HELP.rowSelection.tooltip}
                          onChange={(e) => setSelected((s) => ({ ...s, [r.userId]: e.target.checked }))}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium flex items-center gap-2">
                          <span>{r.email}</span>
                          {r.deletionExempt ? <span className="text-xs text-amber-400">EXEMPT</span> : null}
                          {r.isDeleted ? <span className="text-xs text-red-400">DELETED</span> : null}
                          {r.isDisabled ? <span className="text-xs text-gray-400">DISABLED</span> : null}
                        </div>
                        <div className="text-xs text-gray-400">
                          {r.username} • id={r.userId}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{fmtTs(r.lastActiveAt)}</TableCell>
                      <TableCell>{r.inactiveDays}</TableCell>
                      <TableCell>
                        {r.botScore} ({r.botLabel})
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.queueStatus ? (
                          <div>
                            <div className="font-medium">
                              {r.queueStatus} {r.queueReason ? `(${r.queueReason})` : ""}
                            </div>
                            <div className="text-gray-400">Queued: {fmtTs(r.queuedAt)}</div>
                            <div className="text-gray-400">Grace: {fmtTs(r.graceExpiresAt)}</div>
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 py-6">
                        No rows
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
