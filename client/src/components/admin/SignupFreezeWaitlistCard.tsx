import { useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

type WaitlistRow = {
  id: number;
  fullName: string;
  email: string;
  status: string;
  consentedAt?: number | null;
  consentDocVersion?: string | null;
  consentDocSha256?: string | null;
  consentSignature?: string | null;
  invitedAt?: number | null;
  invitedByAdminId?: number | null;
  inviteSendCount?: number | null;
  lastInviteSentAt?: number | null;
  lastInviteStatus?: string | null;
  lastInviteError?: string | null;
  lastInviteFrom?: string | null;
  lastInviteSubject?: string | null;
  lastInviteBodySha256?: string | null;
  convertedAt?: number | null;
  convertedUserId?: number | null;
  prevHash?: string | null;
  recordHash?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

type WaitlistListResponse = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  rows: WaitlistRow[];
};

type Props = {
  config: any;
  setConfig: (updater: any) => void;
  setConfigChanged: (v: boolean) => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
};

function fmtSec(sec?: number | null) {
  if (!sec) return "—";
  try {
    return new Date(sec * 1000).toLocaleString();
  } catch {
    return String(sec);
  }
}

const WAITLIST_CONFIG_FIELD_HELP = {
  signupFreeze: {
    inline: "Hard-stop new account registration while allowing existing users to log in.",
    tooltip:
      "Enable during legal, infrastructure, or capacity incidents. Pair with a clear freeze banner so users know signup is intentionally paused.",
  },
  signupFreezeMessage: {
    inline: "Banner text displayed on signup while freeze is enabled.",
    tooltip:
      "Use a concise operational message and expected next step. Avoid sensitive incident details in public-facing text.",
  },
  signupWaitlistEnabled: {
    inline: "Capture signup intent (name/email + consent) for later invite waves.",
    tooltip:
      "Enable when freeze periods may be prolonged and you want structured recovery via invite batches.",
  },
  signupWaitlistInviteSender: {
    inline: "From address shown on invite emails.",
    tooltip:
      "Use a verified sender identity/domain with strong deliverability and monitoring to reduce spam-folder placement.",
  },
  signupWaitlistInviteSubject: {
    inline: "Subject line used for waitlist invite emails.",
    tooltip:
      "Keep subject explicit and trustworthy; avoid aggressive spam-like wording that harms inbox placement.",
  },
  signupWaitlistInviteBodyText: {
    inline: "Plain-text template used to send invite links.",
    tooltip:
      "Supported placeholders: {{name}}, {{email}}, {{signup_link}}. Keep copy short, clear, and legally aligned.",
  },
  signupWaitlistAutoInviteOnUnfreeze: {
    inline: "Automatically send invites when signup freeze is turned off.",
    tooltip:
      "Useful for fast recovery, but ensure your batch cap and outbound email capacity are set before enabling.",
  },
  signupWaitlistInviteBatchCap: {
    inline: "Maximum invites sent in one batch run.",
    tooltip:
      "Set this to match operational and email-provider throughput limits. Server enforces an upper cap of 500.",
  },
  signupWaitlistPolicyVersion: {
    inline: "Version identifier for the consent/policy text users accept.",
    tooltip:
      "Bump the version whenever policy meaning changes so consent records clearly map to the exact legal text.",
  },
  signupWaitlistPolicyContent: {
    inline: "Consent and privacy policy content displayed before waitlist opt-in.",
    tooltip:
      "Write in plain language and keep retention/use statements explicit. Changes should follow legal/compliance review.",
  },
} as const;

function WaitlistHintLabel({
  label,
  hint,
  labelClassName = "text-base font-medium",
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

export default function SignupFreezeWaitlistCard(props: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [status, setStatus] = useState<string>("PENDING");
  const [q, setQ] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(0);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const offset = page * pageSize;

  const waitlistQuery = useQuery<WaitlistListResponse>({
    queryKey: ["/api/admin/signup-waitlist", { status, q, limit: pageSize, offset }],
    queryFn: async () => {
      const r = await axios.get("/api/admin/signup-waitlist", {
        params: { status, q, limit: pageSize, offset },
      });
      return r.data;
    },
  });

  const rows = waitlistQuery.data?.rows ?? [];
  const total = waitlistQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectedIds = useMemo(
    () =>
      Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => Number(k)),
    [selected],
  );

  const inviteMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await axios.post("/api/admin/signup-waitlist/invite", payload);
      return r.data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/signup-waitlist"] });
      setSelected({});
      toast({
        title: "Invites processed",
        description: `Attempted: ${data?.attempted ?? 0} | Sent: ${data?.sent ?? 0} | Failed: ${data?.failed ?? 0} | Skipped: ${data?.skipped ?? 0} | Cap: ${data?.batchCap ?? "—"}`,
        variant: Number(data?.failed ?? 0) > 0 ? "destructive" : undefined,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Invite send failed",
        description: err?.response?.data?.error || err?.message || "Failed to send invites",
        variant: "destructive",
      });
    },
  });

  const toggleSelectedAllOnPage = (checked: boolean) => {
    const next: Record<number, boolean> = { ...selected };
    for (const r of rows) next[r.id] = checked;
    setSelected(next);
  };

  const downloadExport = (format: "csv" | "jsonl") => {
    const qs = new URLSearchParams();
    qs.set("format", format);
    qs.set("status", status);
    if (q.trim()) qs.set("q", q.trim());
    window.open(`/api/admin/signup-waitlist/export?${qs.toString()}`, "_blank");
  };

  const allOnPageChecked = rows.length > 0 && rows.every((r) => selected[r.id]);

  return (
    <Card className="bg-neutral-700 border-gray-600">
      <CardHeader>
        <CardTitle className="text-base">Signup Freeze & Waitlist (Invite Back)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <TooltipProvider delayDuration={120}>
        {/* Controls */}
        <div className="space-y-4">
          <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
            These signup-capacity controls include hidden <span className="font-medium">Hint</span> explainers for rollout behavior, legal impact, and operational safeguards.
          </div>
          <div className="flex items-center justify-between py-3 border-b border-gray-600">
            <div>
              <WaitlistHintLabel label="Freeze signups" hint={WAITLIST_CONFIG_FIELD_HELP.signupFreeze.tooltip} />
              <p className="text-xs text-gray-400 mt-1">{WAITLIST_CONFIG_FIELD_HELP.signupFreeze.inline}</p>
            </div>
            <Switch
              checked={Boolean(props.config?.signupFreeze)}
              onCheckedChange={(v) => {
                props.setConfig((prev: any) => ({ ...(prev ?? {}), signupFreeze: v }));
                props.setConfigChanged(true);
              }}
            />
          </div>

          <div className="space-y-2">
            <WaitlistHintLabel label="Freeze banner message" hint={WAITLIST_CONFIG_FIELD_HELP.signupFreezeMessage.tooltip} />
            <p className="text-xs text-gray-400">{WAITLIST_CONFIG_FIELD_HELP.signupFreezeMessage.inline}</p>
            <Textarea
              className="bg-neutral-600 min-h-[80px]"
              value={props.config?.signupFreezeMessage ?? ""}
              onChange={(e) => {
                props.setConfig((prev: any) => ({ ...(prev ?? {}), signupFreezeMessage: e.target.value }));
                props.setConfigChanged(true);
              }}
              placeholder="Displayed on signup when signups are frozen"
            />
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-600">
            <div>
              <WaitlistHintLabel label="Enable invite waitlist" hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistEnabled.tooltip} />
              <p className="text-xs text-gray-400 mt-1">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistEnabled.inline}</p>
            </div>
            <Switch
              checked={Boolean(props.config?.signupWaitlistEnabled)}
              onCheckedChange={(v) => {
                props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistEnabled: v }));
                props.setConfigChanged(true);
              }}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <WaitlistHintLabel label="Invite sender" hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteSender.tooltip} />
              <p className="text-xs text-gray-400">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteSender.inline}</p>
              <Input
                className="bg-neutral-600"
                value={props.config?.signupWaitlistInviteSender ?? ""}
                onChange={(e) => {
                  props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistInviteSender: e.target.value }));
                  props.setConfigChanged(true);
                }}
                placeholder='TradeQuip <noreply@tradequip.com>'
              />
            </div>
            <div className="space-y-2">
              <WaitlistHintLabel label="Invite subject" hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteSubject.tooltip} />
              <p className="text-xs text-gray-400">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteSubject.inline}</p>
              <Input
                className="bg-neutral-600"
                value={props.config?.signupWaitlistInviteSubject ?? ""}
                onChange={(e) => {
                  props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistInviteSubject: e.target.value }));
                  props.setConfigChanged(true);
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <WaitlistHintLabel
              label="Invite message template (text)"
              hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteBodyText.tooltip}
            />
            <p className="text-xs text-gray-400">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteBodyText.inline}</p>
            <p className="text-xs text-gray-400">
              Placeholders: <code className="text-gray-200">{"{{name}}"}</code>,{" "}
              <code className="text-gray-200">{"{{email}}"}</code>,{" "}
              <code className="text-gray-200">{"{{signup_link}}"}</code>
            </p>
            <Textarea
              className="bg-neutral-600 min-h-[120px]"
              value={props.config?.signupWaitlistInviteBodyText ?? ""}
              onChange={(e) => {
                props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistInviteBodyText: e.target.value }));
                props.setConfigChanged(true);
              }}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between py-3 border-b border-gray-600">
              <div>
                <WaitlistHintLabel
                  label="Auto-invite on unfreeze"
                  hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistAutoInviteOnUnfreeze.tooltip}
                />
                <p className="text-xs text-gray-400 mt-1">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistAutoInviteOnUnfreeze.inline}</p>
              </div>
              <Switch
                checked={Boolean(props.config?.signupWaitlistAutoInviteOnUnfreeze)}
                onCheckedChange={(v) => {
                  props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistAutoInviteOnUnfreeze: v }));
                  props.setConfigChanged(true);
                }}
              />
            </div>
            <div className="space-y-2">
              <WaitlistHintLabel label="Invite batch cap" hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteBatchCap.tooltip} />
              <p className="text-xs text-gray-400">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistInviteBatchCap.inline}</p>
              <Input
                className="bg-neutral-600"
                type="number"
                min={1}
                max={500}
                value={Number(props.config?.signupWaitlistInviteBatchCap ?? 200)}
                onChange={(e) => {
                  props.setConfig((prev: any) => ({
                    ...(prev ?? {}),
                    signupWaitlistInviteBatchCap: Number(e.target.value),
                  }));
                  props.setConfigChanged(true);
                }}
              />
              <p className="text-xs text-gray-400">Capped at 500 server-side.</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <WaitlistHintLabel
                label="Waitlist consent policy"
                hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistPolicyContent.tooltip}
              />
              <p className="text-xs text-gray-400 mt-1">
                This is the communications privacy notice users must accept to join the invite list.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-1 space-y-2">
                <WaitlistHintLabel
                  label="Policy version"
                  hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistPolicyVersion.tooltip}
                  labelClassName="text-sm font-medium"
                />
                <p className="text-xs text-gray-400">{WAITLIST_CONFIG_FIELD_HELP.signupWaitlistPolicyVersion.inline}</p>
                <Input
                  className="bg-neutral-600"
                  value={props.config?.signupWaitlistPolicyVersion ?? ""}
                  onChange={(e) => {
                    props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistPolicyVersion: e.target.value }));
                    props.setConfigChanged(true);
                  }}
                />
              </div>
              <div className="md:col-span-3 space-y-2">
                <WaitlistHintLabel
                  label="Policy content"
                  hint={WAITLIST_CONFIG_FIELD_HELP.signupWaitlistPolicyContent.tooltip}
                  labelClassName="text-sm font-medium"
                />
                <Textarea
                  className="bg-neutral-600 min-h-[140px]"
                  value={props.config?.signupWaitlistPolicyContent ?? ""}
                  onChange={(e) => {
                    props.setConfig((prev: any) => ({ ...(prev ?? {}), signupWaitlistPolicyContent: e.target.value }));
                    props.setConfigChanged(true);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={props.onSave} disabled={!props.canSave || props.saving} className="bg-blue-600 hover:bg-blue-700">
              {props.saving ? "Saving..." : "Save Signup Settings"}
            </Button>
          </div>
        </div>
        </TooltipProvider>

        {/* Waitlist Table */}
        <div className="border-t border-gray-600 pt-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div>
                <Label className="text-sm">Status</Label>
                <Select value={status} onValueChange={(v) => { setPage(0); setStatus(v); }}>
                  <SelectTrigger className="bg-neutral-600 mt-1 w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-700">
                    <SelectItem value="PENDING">PENDING</SelectItem>
                    <SelectItem value="INVITED">INVITED</SelectItem>
                    <SelectItem value="CONVERTED">CONVERTED</SelectItem>
                    <SelectItem value="OPTED_OUT">OPTED_OUT</SelectItem>
                    <SelectItem value="ALL">ALL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Search</Label>
                <Input
                  className="bg-neutral-600 mt-1 w-[260px]"
                  value={q}
                  onChange={(e) => { setPage(0); setQ(e.target.value); }}
                  placeholder="Name or email…"
                />
              </div>
              <div>
                <Label className="text-sm">Page size</Label>
                <Select value={String(pageSize)} onValueChange={(v) => { setPage(0); setPageSize(Number(v)); }}>
                  <SelectTrigger className="bg-neutral-600 mt-1 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-700">
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2 md:justify-end">
              <Button variant="outline" onClick={() => downloadExport("csv")}>
                Export CSV
              </Button>
              <Button variant="outline" onClick={() => downloadExport("jsonl")}>
                Export JSONL
              </Button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-xs text-gray-300">
              Total: <span className="font-semibold text-gray-100">{total}</span>
            </div>

            <div className="flex flex-col md:flex-row gap-2">
              <Button
                onClick={() => inviteMutation.mutate({ ids: selectedIds })}
                disabled={inviteMutation.isPending || selectedIds.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                Invite selected ({selectedIds.length})
              </Button>
              <Button
                variant="secondary"
                onClick={() => inviteMutation.mutate({ selectAll: true, status, q })}
                disabled={inviteMutation.isPending}
              >
                Invite all (filtered, capped)
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-gray-600 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[48px]">
                    <Checkbox checked={allOnPageChecked} onCheckedChange={(v) => toggleSelectedAllOnPage(v === true)} />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Invites</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waitlistQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">
                      No entries
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const checked = Boolean(selected[r.id]);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [r.id]: v === true }))}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{r.fullName}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.email}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.status}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtSec(r.consentedAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {(r.inviteSendCount ?? 0) > 0
                            ? `${r.inviteSendCount} (${r.lastInviteStatus ?? "—"})`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="secondary" size="sm">
                                  Details
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Waitlist entry</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-3 text-sm">
                                  <div>
                                    <span className="font-medium">Name:</span> {r.fullName}
                                  </div>
                                  <div>
                                    <span className="font-medium">Email:</span> {r.email}
                                  </div>
                                  <div>
                                    <span className="font-medium">Status:</span> {r.status}
                                  </div>
                                  <div className="pt-2 border-t">
                                    <div>
                                      <span className="font-medium">Consented:</span> {fmtSec(r.consentedAt)}
                                    </div>
                                    <div className="break-all">
                                      <span className="font-medium">Policy version:</span> {r.consentDocVersion ?? "—"}
                                    </div>
                                    <div className="break-all">
                                      <span className="font-medium">Policy SHA:</span> {r.consentDocSha256 ?? "—"}
                                    </div>
                                    <div className="break-all">
                                      <span className="font-medium">Consent signature:</span> {r.consentSignature ?? "—"}
                                    </div>
                                  </div>
                                  <div className="pt-2 border-t">
                                    <div>
                                      <span className="font-medium">Invited:</span> {fmtSec(r.invitedAt)}
                                    </div>
                                    <div>
                                      <span className="font-medium">Last invite:</span> {fmtSec(r.lastInviteSentAt)} ({r.lastInviteStatus ?? "—"})
                                    </div>
                                    {r.lastInviteError ? (
                                      <div className="text-red-300 break-all">
                                        <span className="font-medium">Last error:</span> {r.lastInviteError}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="pt-2 border-t">
                                    <div>
                                      <span className="font-medium">Converted:</span> {fmtSec(r.convertedAt)}
                                    </div>
                                  </div>
                                  <div className="pt-2 border-t">
                                    <div className="break-all">
                                      <span className="font-medium">Prev hash:</span> {r.prevHash ?? "—"}
                                    </div>
                                    <div className="break-all">
                                      <span className="font-medium">Record hash:</span> {r.recordHash ?? "—"}
                                    </div>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>

                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => inviteMutation.mutate({ ids: [r.id] })}
                              disabled={inviteMutation.isPending}
                            >
                              Invite
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-300">
              Showing {total === 0 ? 0 : offset + 1}–{Math.min(offset + pageSize, total)} of {total}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                Prev
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
