import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="border-gray-800 bg-neutral-800 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Inactivity Deletion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-400">Inactivity Threshold (days)</div>
                <Input
                  value={cfg?.inactivityThresholdDays ?? 90}
                  onChange={(e) => updateCfg.mutate({ inactivityThresholdDays: Number(e.target.value || 90) })}
                />
              </div>
              <div>
                <div className="text-xs text-gray-400">Grace Period (days)</div>
                <Input value={cfg?.deletionGraceDays ?? 30} onChange={(e) => updateCfg.mutate({ deletionGraceDays: Number(e.target.value || 30) })} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => runSweep.mutate(true)} disabled={runSweep.isPending}>
                Sweep (Dry Run)
              </Button>
              <Button onClick={() => runSweep.mutate(false)} disabled={runSweep.isPending}>
                Sweep (Apply)
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(cfg?.activityAutoQueueInactive ?? true)}
                  onChange={(e) => updateCfg.mutate({ activityAutoQueueInactive: e.target.checked })}
                />
                Auto-queue inactive
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(cfg?.activityAutoSoftDelete ?? false)}
                  onChange={(e) => updateCfg.mutate({ activityAutoSoftDelete: e.target.checked })}
                />
                Auto soft-delete after grace
              </label>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-neutral-800 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Bot Detection (PoW)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs text-gray-400">Bot Score Threshold</div>
                <Input value={cfg?.botScoreThreshold ?? 40} onChange={(e) => updateCfg.mutate({ botScoreThreshold: Number(e.target.value || 40) })} />
              </div>
              <div>
                <div className="text-xs text-gray-400">Challenge Score (require proof)</div>
                <Input
                  value={cfg?.botPowChallengeScore ?? 25}
                  onChange={(e) => updateCfg.mutate({ botPowChallengeScore: Number(e.target.value || 25) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-xs text-gray-400">Base Diff</div>
                <Input
                  value={cfg?.botPowBaseDifficulty ?? 14}
                  onChange={(e) => updateCfg.mutate({ botPowBaseDifficulty: Number(e.target.value || 14) })}
                />
              </div>
              <div>
                <div className="text-xs text-gray-400">Max Diff</div>
                <Input value={cfg?.botPowMaxDifficulty ?? 20} onChange={(e) => updateCfg.mutate({ botPowMaxDifficulty: Number(e.target.value || 20) })} />
              </div>
              <div>
                <div className="text-xs text-gray-400">TTL (sec)</div>
                <Input value={cfg?.botPowTtlSec ?? 120} onChange={(e) => updateCfg.mutate({ botPowTtlSec: Number(e.target.value || 120) })} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(cfg?.botPowEnabled ?? true)}
                  onChange={(e) => updateCfg.mutate({ botPowEnabled: e.target.checked })}
                />
                PoW enabled
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(cfg?.botPowEnforceSignup ?? true)}
                  onChange={(e) => updateCfg.mutate({ botPowEnforceSignup: e.target.checked })}
                />
                Enforce on signup
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(cfg?.botPowEnforceLogin ?? false)}
                  onChange={(e) => updateCfg.mutate({ botPowEnforceLogin: e.target.checked })}
                />
                Enforce on login
              </label>
              <label className="flex items-center gap-2">
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
          <CardTitle className="text-sm">Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-400">Min inactive days</div>
              <Input className="w-24" value={days} onChange={(e) => setDays(Number(e.target.value || 0))} />
            </div>

            <Button variant={inactiveOnly ? "default" : "secondary"} onClick={() => setInactiveOnly((v) => !v)}>
              Inactive Only
            </Button>
            <Button variant={botsOnly ? "default" : "secondary"} onClick={() => setBotsOnly((v) => !v)}>
              Bots Only
            </Button>
            <Button variant={includeDeleted ? "default" : "secondary"} onClick={() => setIncludeDeleted((v) => !v)}>
              Include Deleted
            </Button>

            <div className="flex-1" />

            <Input
              className="max-w-[280px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note / reason (optional)"
            />

            <Button
              variant="secondary"
              disabled={!canAct || queue.isPending}
              onClick={() => queue.mutate({ userIds: selectedIds, reason: inferredReason, note: note || undefined })}
            >
              Queue Deletion
            </Button>
            <Button variant="secondary" disabled={!canAct || cancelQueue.isPending} onClick={() => cancelQueue.mutate({ userIds: selectedIds, note: note || undefined })}>
              Cancel Queue
            </Button>
            <Button
              variant="secondary"
              disabled={!canAct || exempt.isPending}
              onClick={() => exempt.mutate({ userIds: selectedIds, exempt: true, note: note || undefined })}
            >
              Exempt
            </Button>
            <Button
              variant="secondary"
              disabled={!canAct || exempt.isPending}
              onClick={() => exempt.mutate({ userIds: selectedIds, exempt: false, note: note || undefined })}
            >
              Unexempt
            </Button>
            <Button disabled={!canAct || softDelete.isPending} onClick={() => softDelete.mutate()}>
              Soft Delete Now
            </Button>
            <Button
              variant="destructive"
              disabled={!canAct || hardDelete.isPending}
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

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-gray-700">
                  <TableHead className="w-[44px]">Sel</TableHead>
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
  );
}
