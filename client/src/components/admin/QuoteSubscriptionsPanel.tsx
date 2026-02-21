import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type QuoteMode = "BASIC_ONLY" | "BASIC_PLUS_CUSTOM" | "CUSTOM_ONLY";

type ConfigResp = {
  globalEnabled: boolean;
  defaultMode: QuoteMode;
};

type TraderRow = {
  id: number;
  email: string;
  username: string;
  name: string | null;
  isAdmin: boolean;
  overrideMode: QuoteMode | null;
  effectiveMode: QuoteMode;
  customSubCount: number;
};

type TradersResp = {
  rows: TraderRow[];
  total: number;
  limit: number;
  offset: number;
};

type SymbolRow = {
  id: number;
  symbol: string;
  name: string;
  category: string | null;
  enabled: boolean;
};

type TraderDetailResp = {
  user: {
    id: number;
    email: string;
    username: string;
    name: string | null;
    isAdmin: boolean;
  };
  overrideMode: QuoteMode | null;
  effectiveMode: QuoteMode;
  supportsCustom: boolean;
  includesBaseline: boolean;
  subscriptions: SymbolRow[];
};

const MODE_LABELS: Record<QuoteMode, string> = {
  BASIC_ONLY: "Basic only",
  BASIC_PLUS_CUSTOM: "Basic + Customizable",
  CUSTOM_ONLY: "Customizable only",
};

function modeLabel(mode: QuoteMode | null): string {
  if (!mode) return "Inherit system default";
  return MODE_LABELS[mode] ?? mode;
}

const QUOTE_SUBSCRIPTIONS_FIELD_HELP = {
  globalEnabled: {
    inline: "Master switch allowing traders to use customizable quote subscriptions.",
    tooltip:
      "Disable to force baseline-only behavior platform-wide. Existing custom sets remain stored but should not be effective while disabled.",
  },
  defaultMode: {
    inline: "Default quote mode when a trader has no explicit override.",
    tooltip:
      "Sets baseline behavior for all non-overridden traders. Choose a conservative default before enabling customization broadly.",
  },
  saveGlobal: {
    inline: "Persist global quote-subscription policy values.",
    tooltip:
      "Commits current global enable/default mode and refreshes downstream subscription eligibility caches.",
  },
  traderSearch: {
    inline: "Filter trader rows by username, email, or display name.",
    tooltip:
      "Use targeted search to safely bulk-edit the intended audience and avoid broad accidental mode updates.",
  },
  includeAdmins: {
    inline: "Include admin users in trader search and bulk operations.",
    tooltip:
      "Keep disabled unless you intentionally manage admin quote-subscription behavior for support or QA scenarios.",
  },
  bulkMode: {
    inline: "Mode to apply to all currently selected traders.",
    tooltip:
      "Use INHERIT to clear per-trader overrides. Bulk updates are immediate and should be reviewed before applying.",
  },
  applySelected: {
    inline: "Apply selected bulk mode to checked traders.",
    tooltip:
      "Writes override mode for each selected trader. Confirm selected count and filters before execution.",
  },
  overrideMode: {
    inline: "Per-trader mode override for the selected account.",
    tooltip:
      "Overrides the global default only for this trader. INHERIT reverts trader behavior back to system default.",
  },
  symbolSearch: {
    inline: "Filter available symbols when editing one trader's custom subscriptions.",
    tooltip:
      "Search within DB-loaded symbols only. Use precise symbol queries to speed up curated custom list edits.",
  },
  saveSubscriptions: {
    inline: "Persist selected custom symbol set for the current trader.",
    tooltip:
      "Writes exact selected symbol IDs as trader custom subscriptions. Baseline inclusion still depends on trader mode.",
  },
  selectRows: {
    inline: "Checkboxes determine which traders/symbols are included in updates.",
    tooltip:
      "Selection state directly drives bulk mode or custom-subscription write operations.",
  },
} as const;

function QuoteSubHintLabel({
  label,
  hint,
  className = "text-sm font-medium",
}: {
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className={className}>{label}</Label>
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

export function QuoteSubscriptionsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [traderSearch, setTraderSearch] = useState("");
  const [includeAdmins, setIncludeAdmins] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedTraderId, setSelectedTraderId] = useState<number | null>(null);
  const [bulkMode, setBulkMode] = useState<QuoteMode | "INHERIT">("BASIC_PLUS_CUSTOM");

  const [symbolSearch, setSymbolSearch] = useState("");
  const [draftSymbolIds, setDraftSymbolIds] = useState<Set<number>>(new Set());
  const [draftGlobalEnabled, setDraftGlobalEnabled] = useState(false);
  const [draftDefaultMode, setDraftDefaultMode] = useState<QuoteMode>("BASIC_PLUS_CUSTOM");

  const tradersQueryString = useMemo(() => {
    const qp = new URLSearchParams();
    if (traderSearch.trim()) qp.set("q", traderSearch.trim());
    qp.set("limit", String(limit));
    qp.set("offset", String(offset));
    if (includeAdmins) qp.set("includeAdmins", "true");
    return `/api/admin/quote-subscriptions/traders?${qp.toString()}`;
  }, [includeAdmins, limit, offset, traderSearch]);

  const { data: configData, isLoading: configLoading } = useQuery<ConfigResp>({
    queryKey: ["/api/admin/quote-subscriptions/config"],
  });

  const { data: tradersData, isLoading: tradersLoading } = useQuery<TradersResp>({
    queryKey: [tradersQueryString],
  });

  const { data: traderDetail, isLoading: traderDetailLoading } = useQuery<TraderDetailResp>({
    queryKey: ["/api/admin/quote-subscriptions/traders", selectedTraderId],
    enabled: selectedTraderId != null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/quote-subscriptions/traders/${selectedTraderId}`);
      return await res.json();
    },
  });

  const symbolsQueryString = useMemo(() => {
    const qp = new URLSearchParams();
    if (symbolSearch.trim()) qp.set("q", symbolSearch.trim());
    qp.set("limit", "150");
    return `/api/admin/quote-subscriptions/symbols?${qp.toString()}`;
  }, [symbolSearch]);

  const { data: symbolData, isLoading: symbolsLoading } = useQuery<{ rows: SymbolRow[] }>({
    queryKey: [symbolsQueryString],
    enabled: selectedTraderId != null,
  });

  useEffect(() => {
    if (!configData) return;
    setDraftGlobalEnabled(Boolean(configData.globalEnabled));
    setDraftDefaultMode(configData.defaultMode);
  }, [configData]);

  useEffect(() => {
    if (!tradersData?.rows?.length) {
      setSelectedTraderId(null);
      return;
    }

    if (selectedTraderId && tradersData.rows.some((row) => row.id === selectedTraderId)) {
      return;
    }

    setSelectedTraderId(tradersData.rows[0].id);
  }, [selectedTraderId, tradersData?.rows]);

  useEffect(() => {
    if (!traderDetail) {
      setDraftSymbolIds(new Set());
      return;
    }

    setDraftSymbolIds(new Set(traderDetail.subscriptions.map((row) => row.id)));
  }, [traderDetail]);

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/admin/quote-subscriptions/config", {
        globalEnabled: draftGlobalEnabled,
        defaultMode: draftDefaultMode,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Global quote subscription settings updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quote-subscriptions/config"] });
      queryClient.invalidateQueries({ queryKey: [tradersQueryString] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me"] });
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: String(error?.message ?? error), variant: "destructive" });
    },
  });

  const bulkModeMutation = useMutation({
    mutationFn: async () => {
      const userIds = Array.from(selectedIds.values());
      const res = await apiRequest("PUT", "/api/admin/quote-subscriptions/traders/mode", {
        userIds,
        mode: bulkMode === "INHERIT" ? null : bulkMode,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Updated", description: "Trader quote modes updated." });
      queryClient.invalidateQueries({ queryKey: [tradersQueryString] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quote-subscriptions/traders", selectedTraderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: String(error?.message ?? error), variant: "destructive" });
    },
  });

  const setSingleModeMutation = useMutation({
    mutationFn: async (mode: QuoteMode | null) => {
      const res = await apiRequest("PUT", `/api/admin/quote-subscriptions/traders/${selectedTraderId}/mode`, {
        mode,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Trader mode updated." });
      queryClient.invalidateQueries({ queryKey: [tradersQueryString] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quote-subscriptions/traders", selectedTraderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: String(error?.message ?? error), variant: "destructive" });
    },
  });

  const saveSubscriptionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PUT",
        `/api/admin/quote-subscriptions/traders/${selectedTraderId}/subscriptions`,
        { symbolIds: Array.from(draftSymbolIds.values()) },
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Trader subscriptions updated." });
      queryClient.invalidateQueries({ queryKey: [tradersQueryString] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/quote-subscriptions/traders", selectedTraderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: String(error?.message ?? error), variant: "destructive" });
    },
  });

  const rows = tradersData?.rows ?? [];
  const selectedCount = selectedIds.size;
  const total = tradersData?.total ?? 0;
  const pageEnd = Math.min(offset + limit, total);

  return (
    <TooltipProvider delayDuration={120}>
    <div className="space-y-4">
      <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
        Quote subscription controls include hidden <span className="font-medium">Hint</span> explainers for mode inheritance, bulk update safety, and symbol-level targeting.
      </div>
      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">System-wide Quote Customization</CardTitle>
          <CardDescription>
            Keeps baseline quotes as default while optionally enabling custom subscriptions platform-wide.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={draftGlobalEnabled}
                onCheckedChange={(v) => setDraftGlobalEnabled(Boolean(v))}
                title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.globalEnabled.tooltip}
              />
              <div>
                <QuoteSubHintLabel label="Enable customization for all traders" hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.globalEnabled.tooltip} />
                <p className="text-xs text-gray-400 mt-1">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.globalEnabled.inline}</p>
              </div>
            </div>
            <div className="w-full md:w-72">
              <QuoteSubHintLabel label="Default mode (when no per-trader override)" hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.defaultMode.tooltip} />
              <Select value={draftDefaultMode} onValueChange={(v) => setDraftDefaultMode(v as QuoteMode)}>
                <SelectTrigger className="bg-neutral-600 mt-1" title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.defaultMode.tooltip}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-700">
                  <SelectItem value="BASIC_ONLY">{MODE_LABELS.BASIC_ONLY}</SelectItem>
                  <SelectItem value="BASIC_PLUS_CUSTOM">{MODE_LABELS.BASIC_PLUS_CUSTOM}</SelectItem>
                  <SelectItem value="CUSTOM_ONLY">{MODE_LABELS.CUSTOM_ONLY}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.defaultMode.inline}</p>
            </div>
            <div className="md:ml-auto">
              <Button
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending || configLoading}
                className="bg-emerald-600 hover:bg-emerald-700"
                title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.saveGlobal.tooltip}
              >
                {saveConfigMutation.isPending ? "Saving..." : "Save Global Settings"}
              </Button>
            </div>
          </div>
          <div className="text-xs text-gray-300">
            Current: {configData ? `${configData.globalEnabled ? "Enabled" : "Disabled"}, default ${MODE_LABELS[configData.defaultMode]}` : "Loading..."}
          </div>
          <p className="text-xs text-gray-400">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.saveGlobal.inline}</p>
        </CardContent>
      </Card>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Trader Quote Permissions</CardTitle>
          <CardDescription>
            Search traders, apply bulk mode changes, and manage per-trader custom symbol subscriptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <QuoteSubHintLabel label="Search traders" hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.traderSearch.tooltip} />
              <Input
                value={traderSearch}
                onChange={(e) => {
                  setTraderSearch(e.target.value);
                  setOffset(0);
                }}
                placeholder="email, username, name"
                className="bg-neutral-600 mt-1"
                title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.traderSearch.tooltip}
              />
              <p className="text-xs text-gray-400 mt-1">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.traderSearch.inline}</p>
            </div>
            <div className="flex items-end gap-2">
              <Checkbox
                id="include-admins"
                checked={includeAdmins}
                onCheckedChange={(checked) => {
                  setIncludeAdmins(Boolean(checked));
                  setOffset(0);
                }}
                title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.includeAdmins.tooltip}
              />
              <div className="w-full">
                <QuoteSubHintLabel
                  label="Include admins"
                  hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.includeAdmins.tooltip}
                  className="text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.includeAdmins.inline}</p>
              </div>
            </div>
            <div className="flex items-end justify-end">
              <Button
                variant="outline"
                className="bg-neutral-600 hover:bg-neutral-500"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: [tradersQueryString] });
                }}
                title="Refresh current trader query results."
              >
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="border border-gray-600 rounded-md overflow-hidden">
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-800 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left w-10" title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.selectRows.tooltip}>
                        <Checkbox
                          checked={rows.length > 0 && rows.every((r) => selectedIds.has(r.id))}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedIds(new Set(rows.map((r) => r.id)));
                            } else {
                              setSelectedIds(new Set());
                            }
                          }}
                        />
                      </th>
                      <th className="px-3 py-2 text-left">Trader</th>
                      <th className="px-3 py-2 text-left">Effective mode</th>
                      <th className="px-3 py-2 text-left">Custom subs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradersLoading ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-gray-300">Loading...</td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-gray-300">No traders found.</td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const selected = selectedTraderId === row.id;
                        return (
                          <tr
                            key={row.id}
                            className={`border-t border-gray-700 cursor-pointer ${selected ? "bg-neutral-800" : "hover:bg-neutral-800/60"}`}
                            onClick={() => setSelectedTraderId(row.id)}
                          >
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(row.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (checked) next.add(row.id);
                                    else next.delete(row.id);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.username}</div>
                              <div className="text-xs text-gray-400">{row.email}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div>{modeLabel(row.effectiveMode)}</div>
                              <div className="text-xs text-gray-400">override: {modeLabel(row.overrideMode)}</div>
                            </td>
                            <td className="px-3 py-2">{row.customSubCount}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 border-t border-gray-700 flex items-center justify-between text-xs text-gray-300">
                <span>
                  {total === 0 ? "0" : `${offset + 1}-${pageEnd}`} of {total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-neutral-700 hover:bg-neutral-600"
                    onClick={() => setOffset((p) => Math.max(0, p - limit))}
                    disabled={offset <= 0}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-neutral-700 hover:bg-neutral-600"
                    onClick={() => setOffset((p) => p + limit)}
                    disabled={offset + limit >= total}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <p className="px-3 py-2 text-xs text-gray-400 border-t border-gray-700">
                {QUOTE_SUBSCRIPTIONS_FIELD_HELP.selectRows.inline}
              </p>
            </div>

            <Card className="bg-neutral-800 border-gray-600">
              <CardHeader>
                <CardTitle className="text-sm">Bulk Mode Update</CardTitle>
                <CardDescription>
                  Apply mode to selected traders. Use "Inherit" to clear per-trader overrides.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm">Selected traders: {selectedCount}</div>
                <QuoteSubHintLabel label="Bulk mode" hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.bulkMode.tooltip} />
                <Select value={bulkMode} onValueChange={(v) => setBulkMode(v as QuoteMode | "INHERIT")}> 
                  <SelectTrigger className="bg-neutral-700" title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.bulkMode.tooltip}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-800 border-gray-700">
                    <SelectItem value="BASIC_ONLY">{MODE_LABELS.BASIC_ONLY}</SelectItem>
                    <SelectItem value="BASIC_PLUS_CUSTOM">{MODE_LABELS.BASIC_PLUS_CUSTOM}</SelectItem>
                    <SelectItem value="CUSTOM_ONLY">{MODE_LABELS.CUSTOM_ONLY}</SelectItem>
                    <SelectItem value="INHERIT">Inherit system default</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.bulkMode.inline}</p>
                <Button
                  onClick={() => bulkModeMutation.mutate()}
                  disabled={selectedCount === 0 || bulkModeMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                  title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.applySelected.tooltip}
                >
                  {bulkModeMutation.isPending ? "Applying..." : "Apply To Selected"}
                </Button>
                <p className="text-xs text-gray-400">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.applySelected.inline}</p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Trader Subscription Detail</CardTitle>
          <CardDescription>
            Edit a single trader override mode and custom symbol list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedTraderId ? (
            <div className="text-sm text-gray-300">Select a trader to view details.</div>
          ) : traderDetailLoading || !traderDetail ? (
            <div className="text-sm text-gray-300">Loading trader detail...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Trader</Label>
                  <div className="mt-1 p-2 rounded bg-neutral-800 border border-gray-600 text-sm">
                    {traderDetail.user.username} ({traderDetail.user.email})
                  </div>
                </div>
                <div>
                  <Label>Current effective mode</Label>
                  <div className="mt-1 p-2 rounded bg-neutral-800 border border-gray-600 text-sm">
                    {modeLabel(traderDetail.effectiveMode)}
                  </div>
                </div>
                <div>
                  <QuoteSubHintLabel label="Override mode" hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.overrideMode.tooltip} />
                  <Select
                    value={traderDetail.overrideMode ?? "INHERIT"}
                    onValueChange={(v) => {
                      const next = v === "INHERIT" ? null : (v as QuoteMode);
                      setSingleModeMutation.mutate(next);
                    }}
                  >
                    <SelectTrigger className="bg-neutral-600 mt-1" title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.overrideMode.tooltip}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-gray-700">
                      <SelectItem value="BASIC_ONLY">{MODE_LABELS.BASIC_ONLY}</SelectItem>
                      <SelectItem value="BASIC_PLUS_CUSTOM">{MODE_LABELS.BASIC_PLUS_CUSTOM}</SelectItem>
                      <SelectItem value="CUSTOM_ONLY">{MODE_LABELS.CUSTOM_ONLY}</SelectItem>
                      <SelectItem value="INHERIT">Inherit system default</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400 mt-1">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.overrideMode.inline}</p>
                </div>
              </div>

              {!traderDetail.supportsCustom ? (
                <div className="text-sm text-gray-300 border border-amber-600/40 bg-amber-900/20 p-3 rounded">
                  This trader is currently in a mode that does not allow custom subscriptions.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div className="md:col-span-2">
                      <QuoteSubHintLabel label="Search symbols (from DB-loaded instruments)" hint={QUOTE_SUBSCRIPTIONS_FIELD_HELP.symbolSearch.tooltip} />
                      <Input
                        value={symbolSearch}
                        onChange={(e) => setSymbolSearch(e.target.value)}
                        placeholder="AAPL, SPY, EURUSD..."
                        className="bg-neutral-600 mt-1"
                        title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.symbolSearch.tooltip}
                      />
                      <p className="text-xs text-gray-400 mt-1">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.symbolSearch.inline}</p>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        onClick={() => saveSubscriptionsMutation.mutate()}
                        disabled={saveSubscriptionsMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-700"
                        title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.saveSubscriptions.tooltip}
                      >
                        {saveSubscriptionsMutation.isPending ? "Saving..." : `Save Subscriptions (${draftSymbolIds.size})`}
                      </Button>
                    </div>
                  </div>

                  <div className="border border-gray-600 rounded-md max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-800 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left w-10" title={QUOTE_SUBSCRIPTIONS_FIELD_HELP.selectRows.tooltip}></th>
                          <th className="px-3 py-2 text-left">Symbol</th>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-left">Baseline</th>
                        </tr>
                      </thead>
                      <tbody>
                        {symbolsLoading ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-center text-gray-300">Loading symbols...</td>
                          </tr>
                        ) : !symbolData?.rows?.length ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-center text-gray-300">No symbols found.</td>
                          </tr>
                        ) : (
                          symbolData.rows.map((row) => (
                            <tr key={row.id} className="border-t border-gray-700 hover:bg-neutral-800/60">
                              <td className="px-3 py-2">
                                <Checkbox
                                  checked={draftSymbolIds.has(row.id)}
                                  onCheckedChange={(checked) => {
                                    setDraftSymbolIds((prev) => {
                                      const next = new Set(prev);
                                      if (checked) next.add(row.id);
                                      else next.delete(row.id);
                                      return next;
                                    });
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2 font-mono">{row.symbol}</td>
                              <td className="px-3 py-2">{row.name}</td>
                              <td className="px-3 py-2">{row.category ?? "-"}</td>
                              <td className="px-3 py-2">{row.enabled ? "Yes" : "No"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400">{QUOTE_SUBSCRIPTIONS_FIELD_HELP.saveSubscriptions.inline}</p>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}
