import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { INSTRUMENT_CATALOG_CATEGORY_TAGS, INSTRUMENT_CATEGORY_LABELS } from "@shared/instruments/categories";

type ProvidersResp = {
  ok: boolean;
  activeKey: string | null;
  rows: Array<{ providerKey: string; displayName: string; driver: string; isEnabled: boolean; deletedAt: number | null }>;
};

type ReferenceRow = {
  id: number;
  providerKey: string;
  category: string;
  canonicalSymbol: string;
  providerSymbol: string;
  name: string | null;
  exchange: string | null;
  country: string | null;
  lastRefreshedAt: number;
};

type SearchResp = { ok: boolean; providerKey: string; rows: ReferenceRow[] };

const CATEGORIES = INSTRUMENT_CATALOG_CATEGORY_TAGS.map((key) => ({
  key,
  label: INSTRUMENT_CATEGORY_LABELS[key],
}));

const CATALOG_DIALOG_FIELD_HELP = {
  provider: {
    inline: "Choose which market-data provider catalog to query.",
    tooltip:
      "Provider determines which reference rows are returned. Use the same provider strategy you rely on for quote ingestion to avoid symbol drift.",
  },
  category: {
    inline: "Filter reference rows to a specific asset category.",
    tooltip:
      "Category filtering reduces noise and helps prevent accidental enablement of unsupported instrument classes.",
  },
  pageSize: {
    inline: "Number of catalog rows shown per page.",
    tooltip:
      "Larger pages reduce pagination but can increase render cost and selection mistakes in bulk operations.",
  },
  search: {
    inline: "Lookup by symbol/name/provider symbol from the ingested catalog.",
    tooltip:
      "Use targeted searches (e.g., EURUSD, AAPL) before enabling to confirm identity and metadata quality.",
  },
  selectRows: {
    inline: "Select rows to promote into live `symbol_configs`.",
    tooltip:
      "Only selected rows are enabled. Review symbol, country, exchange, and provider symbol before promotion.",
  },
  enable: {
    inline: "Enable selected catalog rows for live trading and subscriptions.",
    tooltip:
      "Promotion is active immediately. Validate decimals/lot settings afterward in configured symbol editor when needed.",
  },
} as const;

function CatalogHintLabel({
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

export function InstrumentCatalogEnableDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: providersData } = useQuery<ProvidersResp>({
    queryKey: ["/api/admin/market-data/providers"],
    enabled: props.open,
  });

  const providers = useMemo(
    () => (providersData?.rows || []).filter((p) => !p.deletedAt && p.isEnabled),
    [providersData?.rows],
  );

  const [providerKey, setProviderKey] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [searchQ, setSearchQ] = useState<string>("");
  const [searchLimit, setSearchLimit] = useState<number>(50);
  const [searchOffset, setSearchOffset] = useState<number>(0);
  const [searchNonce, setSearchNonce] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!props.open) return;
    if (providerKey) return;
    const active = providersData?.activeKey;
    if (active) setProviderKey(active);
    else if (providers.length) setProviderKey(providers[0].providerKey);
  }, [props.open, providerKey, providers, providersData?.activeKey]);

  useEffect(() => {
    if (!props.open) return;
    if (!providerKey) return;
    if (searchNonce === 0) setSearchNonce(1);
  }, [props.open, providerKey, searchNonce]);

  const searchUrl = useMemo(() => {
    if (!providerKey) return null;
    const qp = new URLSearchParams();
    qp.set("providerKey", providerKey);
    if (category) qp.set("category", category);
    if (searchQ) qp.set("q", searchQ);
    qp.set("limit", String(searchLimit));
    qp.set("offset", String(searchOffset));
    return `/api/admin/market-data/instruments/reference/search?${qp.toString()}`;
  }, [providerKey, category, searchQ, searchLimit, searchOffset]);

  const { data: searchData, isFetching: isSearching } = useQuery<SearchResp>({
    queryKey: searchUrl ? [searchUrl, searchNonce] : ["_noop_ref_search_dialog"],
    enabled: Boolean(props.open && searchUrl && searchNonce > 0),
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedIds.values());
      const res = await apiRequest("POST", "/api/admin/market-data/instruments/reference/enable", {
        providerKey,
        ids,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Enabled instruments", description: `Enabled: ${data?.enabled?.length ?? 0}` });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/admin/symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/config/symbols"] });
      props.onOpenChange(false);
    },
    onError: (e: any) => {
      toast({ title: "Enable failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const rows = searchData?.rows || [];

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="bg-neutral-800 text-white border-gray-700 w-[calc(100%-2rem)] max-w-3xl">
        <TooltipProvider delayDuration={120}>
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Add Instruments From Catalog</DialogTitle>
          <p className="text-xs text-gray-400">
            Searches `instrument_reference` and enables selected rows into `symbol_configs` (active immediately).
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
            Catalog promotion includes hidden <span className="font-medium">Hint</span> explainers for provider scoping, row vetting, and safe bulk enablement.
          </div>
          {/* Row 1: Provider, Category, Page Size */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <CatalogHintLabel label="Provider" hint={CATALOG_DIALOG_FIELD_HELP.provider.tooltip} />
              <Select
                value={providerKey}
                onValueChange={(v) => {
                  setProviderKey(v);
                  setSearchOffset(0);
                  setSelectedIds(new Set());
                  setSearchNonce((n) => n + 1);
                }}
              >
                <SelectTrigger className="bg-neutral-700 mt-1" title={CATALOG_DIALOG_FIELD_HELP.provider.tooltip}>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-700">
                  {providers.map((p) => (
                    <SelectItem key={p.providerKey} value={p.providerKey}>
                      {p.displayName} ({p.providerKey})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">{CATALOG_DIALOG_FIELD_HELP.provider.inline}</p>
            </div>
            <div className="flex-1 min-w-[120px]">
              <CatalogHintLabel label="Category" hint={CATALOG_DIALOG_FIELD_HELP.category.tooltip} />
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v === "_all" ? "" : v);
                  setSearchOffset(0);
                  setSelectedIds(new Set());
                  setSearchNonce((n) => n + 1);
                }}
              >
                <SelectTrigger className="bg-neutral-700 mt-1" title={CATALOG_DIALOG_FIELD_HELP.category.tooltip}>
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-700">
                  <SelectItem value="_all">All</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400 mt-1">{CATALOG_DIALOG_FIELD_HELP.category.inline}</p>
            </div>
            <div className="w-[80px] shrink-0">
              <CatalogHintLabel label="Page Size" hint={CATALOG_DIALOG_FIELD_HELP.pageSize.tooltip} />
              <Input
                type="number"
                value={searchLimit}
                onChange={(e) => setSearchLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50)))}
                className="bg-neutral-700 mt-1"
                min={1}
                max={200}
                title={CATALOG_DIALOG_FIELD_HELP.pageSize.tooltip}
              />
              <p className="text-xs text-gray-400 mt-1">{CATALOG_DIALOG_FIELD_HELP.pageSize.inline}</p>
            </div>
          </div>

          {/* Row 2: Search input + buttons - fully responsive */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <CatalogHintLabel label="Search" hint={CATALOG_DIALOG_FIELD_HELP.search.tooltip} />
              <Input
                id="catalog-search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSearchOffset(0);
                    setSelectedIds(new Set());
                    setSearchNonce((n) => n + 1);
                  }
                }}
                className="bg-neutral-700 mt-1"
                placeholder="EURUSD, AAPL, Gold…"
                title={CATALOG_DIALOG_FIELD_HELP.search.tooltip}
              />
              <p className="text-xs text-gray-400 mt-1">{CATALOG_DIALOG_FIELD_HELP.search.inline}</p>
            </div>
            <div className="flex items-end justify-end gap-2 shrink-0 flex-wrap">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchOffset(0);
                  setSelectedIds(new Set());
                  setSearchNonce((n) => n + 1);
                }}
                disabled={!providerKey || isSearching}
                className="bg-neutral-700 hover:bg-neutral-600"
              >
                {isSearching ? "Searching…" : "Search"}
              </Button>
              <Button
                onClick={() => enableMutation.mutate()}
                disabled={enableMutation.isPending || selectedIds.size === 0 || !providerKey}
                className="bg-emerald-600 hover:bg-emerald-700 whitespace-nowrap"
                title={CATALOG_DIALOG_FIELD_HELP.enable.tooltip}
              >
                {enableMutation.isPending ? "Enabling…" : `Enable (${selectedIds.size})`}
              </Button>
            </div>
          </div>

          <div className="text-xs text-gray-400">{CATALOG_DIALOG_FIELD_HELP.selectRows.inline}</div>
          <div className="border border-gray-700 rounded bg-neutral-900 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-300 border-b border-gray-800">
                <tr>
                  <th className="p-2 text-left" title={CATALOG_DIALOG_FIELD_HELP.selectRows.tooltip}>Select</th>
                  <th className="p-2 text-left">Symbol</th>
                  <th className="p-2 text-left">Name</th>
                  <th className="p-2 text-left">Country</th>
                  <th className="p-2 text-left">Exchange</th>
                  <th className="p-2 text-left">Provider Symbol</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="p-3 text-gray-400" colSpan={6}>
                      {searchNonce === 0 ? "Loading…" : "No results."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const checked = selectedIds.has(r.id);
                    return (
                      <tr key={r.id} className="border-b border-gray-800 hover:bg-neutral-800/60">
                        <td className="p-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(r.id);
                                else next.delete(r.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="p-2 font-mono text-xs">{r.canonicalSymbol}</td>
                        <td className="p-2">{r.name || "—"}</td>
                        <td className="p-2">{r.country || "—"}</td>
                        <td className="p-2">{r.exchange || "—"}</td>
                        <td className="p-2 font-mono text-xs">{r.providerSymbol}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-400">Offset: {searchOffset}</div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="bg-neutral-700 hover:bg-neutral-600"
                disabled={searchOffset === 0 || isSearching || searchNonce === 0}
                onClick={() => {
                  setSearchOffset((o) => Math.max(0, o - searchLimit));
                  setSelectedIds(new Set());
                  setSearchNonce((n) => n + 1);
                }}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                className="bg-neutral-700 hover:bg-neutral-600"
                disabled={rows.length < searchLimit || isSearching || searchNonce === 0}
                onClick={() => {
                  setSearchOffset((o) => o + searchLimit);
                  setSelectedIds(new Set());
                  setSearchNonce((n) => n + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} className="bg-neutral-700">
            Close
          </Button>
        </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
