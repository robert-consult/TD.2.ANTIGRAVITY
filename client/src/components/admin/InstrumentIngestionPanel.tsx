import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProvidersResp = {
  ok: boolean;
  activeKey: string | null;
  rows: Array<{
    providerKey: string;
    displayName: string;
    driver: string;
    isEnabled: boolean;
    deletedAt: number | null;
    capability?: {
      quotesRest: boolean;
      quotesWs: boolean;
      referenceData: boolean;
      batchSymbols: boolean;
    } | null;
  }>;
};

type ReferenceRow = {
  id: number;
  providerKey: string;
  category: string;
  canonicalSymbol: string;
  providerSymbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  country: string | null;
  type: string | null;
  currencyBase: string | null;
  currencyQuote: string | null;
  region: string | null;
  lastRefreshedAt: number;
};

type SearchResp = { ok: boolean; providerKey: string; rows: ReferenceRow[] };

function safeJsonParseObject(text: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "forex", label: "Forex" },
  { key: "stocks", label: "Stocks" },
  { key: "etf", label: "ETFs" },
  { key: "crypto", label: "Crypto" },
  { key: "commodities", label: "Commodities" },
  { key: "bonds", label: "Bonds" },
  { key: "funds", label: "Funds" },
  { key: "mutual_funds", label: "Mutual Funds" },
];

export function InstrumentIngestionPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: providersData } = useQuery<ProvidersResp>({
    queryKey: ["/api/admin/market-data/providers"],
  });

  const providers = useMemo(
    () => (providersData?.rows || []).filter((p) => !p.deletedAt && p.isEnabled),
    [providersData?.rows],
  );
  const [providerKey, setProviderKey] = useState<string>("");
  const selectedProvider = useMemo(
    () => providers.find((p) => p.providerKey === providerKey) ?? null,
    [providerKey, providers],
  );
  const supportsReference = Boolean(selectedProvider?.capability?.referenceData ?? true);

  const [category, setCategory] = useState<string>("forex");
  const [refreshLimit, setRefreshLimit] = useState<number>(500);
  const [filterJson, setFilterJson] = useState<string>("{}");

  const [searchQ, setSearchQ] = useState<string>("");
  const [searchLimit, setSearchLimit] = useState<number>(50);
  const [searchOffset, setSearchOffset] = useState<number>(0);
  const [searchNonce, setSearchNonce] = useState<number>(0);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [importRows, setImportRows] = useState<any[] | null>(null);
  const [importFileName, setImportFileName] = useState<string>("");

  useEffect(() => {
    if (providerKey) return;
    const active = providersData?.activeKey;
    if (active) setProviderKey(active);
    else if (providers.length) setProviderKey(providers[0].providerKey);
  }, [providerKey, providers, providersData?.activeKey]);

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
    queryKey: searchUrl ? [searchUrl, searchNonce] : ["_noop_ref_search"],
    enabled: Boolean(searchUrl && searchNonce > 0),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const filter = safeJsonParseObject(filterJson);
      if (filter === null) throw new Error("Invalid filter JSON");

      const res = await apiRequest("POST", "/api/admin/market-data/instruments/reference/refresh", {
        providerKey,
        category,
        filter,
        limit: refreshLimit,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Reference refreshed", description: `Ingested: ${data?.ingested ?? 0}` });
      setSearchOffset(0);
      setSelectedIds(new Set());
      setSearchNonce((n) => n + 1);
    },
    onError: (e: any) => {
      toast({ title: "Refresh failed", description: String(e?.message || e), variant: "destructive" });
    },
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
    },
    onError: (e: any) => {
      toast({ title: "Enable failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!importRows?.length) throw new Error("No import rows loaded");
      if (importRows.length > 50_000) throw new Error("Too many rows (max 50000)");

      const res = await apiRequest("POST", "/api/admin/market-data/instruments/reference/import", {
        providerKey,
        category,
        rows: importRows,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Catalog imported", description: `Imported: ${data?.imported ?? 0}` });
      setImportRows(null);
      setImportFileName("");
      setSearchOffset(0);
      setSelectedIds(new Set());
      setSearchNonce((n) => n + 1);
    },
    onError: (e: any) => {
      toast({ title: "Import failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const onPickImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed?.instruments) ? parsed.instruments : null;
      if (!rows) throw new Error("Expected a JSON array or an object with `rows`/`instruments` array");
      setImportRows(rows);
      setImportFileName(file.name);
      toast({ title: "File loaded", description: `${rows.length} rows ready to import` });
    } catch (err: any) {
      toast({ title: "Invalid file", description: String(err?.message ?? err), variant: "destructive" });
      setImportRows(null);
      setImportFileName("");
    }
  };

  const rows = searchData?.rows || [];

  return (
    <div className="space-y-4">
      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Instrument Ingestion</CardTitle>
          <CardDescription>Fetch provider reference lists into the catalog, then enable selected instruments into `symbol_configs`.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Provider</Label>
              <Select value={providerKey} onValueChange={setProviderKey}>
                <SelectTrigger className="bg-neutral-600 mt-1">
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
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v);
                  setSearchOffset(0);
                  setSelectedIds(new Set());
                }}
              >
                <SelectTrigger className="bg-neutral-600 mt-1">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-700">
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Refresh Limit</Label>
              <Input
                type="number"
                value={refreshLimit}
                onChange={(e) => setRefreshLimit(Math.max(1, Math.min(50_000, Number(e.target.value) || 500)))}
                className="bg-neutral-600 mt-1"
                min={1}
                max={50000}
              />
            </div>
          </div>

          <div>
            <Label>Provider Filters (JSON)</Label>
            <textarea
              value={filterJson}
              onChange={(e) => setFilterJson(e.target.value)}
              className="w-full mt-1 p-2 rounded bg-neutral-600 border border-gray-600 font-mono text-xs h-24"
              placeholder='{"country":"United States","exchange":"NASDAQ"}'
            />
            <p className="text-xs text-gray-400 mt-1">
              Sent as query params to the provider reference endpoint. Keys must match the provider API (e.g. `country`, `exchange`, `type` for stocks).
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || !providerKey || !supportsReference}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {refreshMutation.isPending ? "Refreshing…" : "Refresh Reference List"}
            </Button>
          </div>
          {!supportsReference ? (
            <p className="text-xs text-amber-300">
              Selected provider does not advertise reference-data ingestion support.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Import Reference Catalog (JSON)</CardTitle>
          <CardDescription>
            Upload a JSON file to populate `instrument_reference` (offline), then search & enable into `symbol_configs`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Label htmlFor="instrument-catalog-file">Catalog File</Label>
              <Input
                id="instrument-catalog-file"
                type="file"
                accept="application/json"
                onChange={(e) => void onPickImportFile(e.target.files?.[0] ?? null)}
                className="bg-neutral-600 mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Rows can include `category`, `canonicalSymbol`/`symbol`, `providerSymbol` (optional), and optional metadata fields (name, exchange, country…).
              </p>
            </div>
            <div className="flex items-end justify-end">
              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || !providerKey || !importRows?.length}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {importMutation.isPending ? "Importing…" : `Import${importRows?.length ? ` (${importRows.length})` : ""}`}
              </Button>
            </div>
          </div>
          {importFileName && (
            <div className="text-xs text-gray-300">
              Loaded: <span className="font-mono">{importFileName}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Browse & Enable</CardTitle>
          <CardDescription>Search the ingested reference catalog and promote selected instruments into `symbol_configs`.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label>Search</Label>
              <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} className="bg-neutral-600 mt-1" placeholder="EURUSD, AAPL, Gold…" />
            </div>
            <div>
              <Label>Page Size</Label>
              <Input
                type="number"
                value={searchLimit}
                onChange={(e) => setSearchLimit(Math.max(1, Math.min(200, Number(e.target.value) || 50)))}
                className="bg-neutral-600 mt-1"
                min={1}
                max={200}
              />
            </div>
            <div className="flex items-end gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchOffset(0);
                  setSelectedIds(new Set());
                  setSearchNonce((n) => n + 1);
                }}
                disabled={!providerKey || isSearching}
                className="bg-neutral-600 hover:bg-neutral-500"
              >
                {isSearching ? "Searching…" : "Search"}
              </Button>
              <Button
                onClick={() => enableMutation.mutate()}
                disabled={enableMutation.isPending || selectedIds.size === 0 || !providerKey}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {enableMutation.isPending ? "Enabling…" : `Enable (${selectedIds.size})`}
              </Button>
            </div>
          </div>

          <div className="border border-gray-600 rounded bg-neutral-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-300 border-b border-gray-700">
                <tr>
                  <th className="p-2 text-left">Select</th>
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
                      {searchNonce === 0 ? "Run a search to view ingested instruments." : "No results."}
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
                className="bg-neutral-600 hover:bg-neutral-500"
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
                className="bg-neutral-600 hover:bg-neutral-500"
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
        </CardContent>
      </Card>
    </div>
  );
}
