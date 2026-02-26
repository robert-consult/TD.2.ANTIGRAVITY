import React, { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/components/LeaderboardTable";
import {
  TRADER_SEARCH_CATEGORIES,
  traderSearchCategoriesResponseSchema,
  traderSearchBreakdownResponseSchema,
  traderSearchResponseSchema,
  traderSearchTradeExtremesResponseSchema,
  type TraderSearchRow,
} from "@shared/admin/traderSearch";
import {
  INSTRUMENT_CATEGORY_LABELS,
  normalizeInstrumentCategory,
} from "@shared/instruments/categories";

function clampNumber(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPct01(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const value = parsed > 1 ? parsed / 100 : parsed;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function formatPct01(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatSignedUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "+";
  return `${sign}${formatCurrency(v)}`;
}

function formatDurationSec(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  const remMins = mins % 60;
  if (days > 0) return `${days}d ${remHrs}h`;
  if (hrs > 0) return `${hrs}h ${remMins}m`;
  return `${remMins}m`;
}

function topMixBadges(mix: Record<string, number> | null | undefined): Array<{ k: string; v: number }> {
  if (!mix) return [];
  return Object.entries(mix)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => ({ k, v }));
}

export default function TraderSearchTab({ days }: { days: string }) {
  const { toast } = useToast();
  const daysInt = useMemo(() => Math.max(0, Math.trunc(Number(days) || 30)), [days]);

  const [q, setQ] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [minTrades, setMinTrades] = useState("");
  const [minWinRatePct, setMinWinRatePct] = useState("");
  const [maxDrawdownPct, setMaxDrawdownPct] = useState("");
  const [minNetProfit, setMinNetProfit] = useState("");
  const [maxBestDayPct, setMaxBestDayPct] = useState("");
  const [minProfitFactor, setMinProfitFactor] = useState("");
  const [minSlUsagePct, setMinSlUsagePct] = useState("");
  const [minTpUsagePct, setMinTpUsagePct] = useState("");
  const [minHoldHours, setMinHoldHours] = useState("");
  const [maxHoldHours, setMaxHoldHours] = useState("");
  const [limit, setLimit] = useState("25");
  const [offset, setOffset] = useState(0);
  const [exportLimit, setExportLimit] = useState("5000");

  const [selected, setSelected] = useState<TraderSearchRow | null>(null);

  const { data: categoriesData } = useQuery({
    queryKey: ["/api/admin/trader-scouting/categories"],
    staleTime: 60_000,
    select: (raw: unknown) => traderSearchCategoriesResponseSchema.parse(raw),
  });

  const categoryChoices = useMemo(() => {
    const fromApi = categoriesData?.categories?.filter(Boolean) ?? [];
    if (fromApi.length) {
      return Array.from(new Set(fromApi.map((raw) => normalizeInstrumentCategory(raw, "unknown"))));
    }
    return [...TRADER_SEARCH_CATEGORIES];
  }, [categoriesData?.categories]);

  useEffect(() => {
    setOffset(0);
  }, [
    daysInt,
    q,
    categories.join(","),
    minTrades,
    minWinRatePct,
    maxDrawdownPct,
    minNetProfit,
    maxBestDayPct,
    minProfitFactor,
    minSlUsagePct,
    minTpUsagePct,
    minHoldHours,
    maxHoldHours,
    limit,
  ]);

  const searchUrl = useMemo(() => {
    const qp = new URLSearchParams();
    qp.set("days", String(daysInt));
    qp.set("offset", String(offset));
    qp.set("limit", String(Math.max(1, Math.min(200, Math.trunc(clampNumber(limit, 25))))));
    if (minTrades.trim()) qp.set("minTrades", String(Math.max(0, Math.trunc(clampNumber(minTrades.trim(), 0)))));

    const qTrim = q.trim();
    if (qTrim) qp.set("q", qTrim);
    if (categories.length) qp.set("categories", categories.join(","));

    if (minWinRatePct.trim()) {
      const v = clampPct01(minWinRatePct.trim());
      if (v != null) qp.set("minWinRate", String(v));
    }
    if (maxDrawdownPct.trim()) {
      const v = clampPct01(maxDrawdownPct.trim());
      if (v != null) qp.set("maxDrawdown", String(v));
    }
    if (minNetProfit.trim()) {
      const v = clampNumber(minNetProfit.trim(), NaN);
      if (Number.isFinite(v)) qp.set("minNetProfit", String(v));
    }
    if (maxBestDayPct.trim()) {
      const v = clampPct01(maxBestDayPct.trim());
      if (v != null) qp.set("maxBestDayPct", String(v));
    }

    if (minProfitFactor.trim()) {
      const v = clampNumber(minProfitFactor.trim(), NaN);
      if (Number.isFinite(v) && v >= 0) qp.set("minProfitFactor", String(v));
    }
    if (minSlUsagePct.trim()) {
      const v = clampPct01(minSlUsagePct.trim());
      if (v != null) qp.set("minSlUsage", String(v));
    }
    if (minTpUsagePct.trim()) {
      const v = clampPct01(minTpUsagePct.trim());
      if (v != null) qp.set("minTpUsage", String(v));
    }

    if (minHoldHours.trim()) {
      const v = clampNumber(minHoldHours.trim(), NaN);
      if (Number.isFinite(v) && v >= 0) qp.set("minHoldSec", String(Math.trunc(v * 3600)));
    }
    if (maxHoldHours.trim()) {
      const v = clampNumber(maxHoldHours.trim(), NaN);
      if (Number.isFinite(v) && v >= 0) qp.set("maxHoldSec", String(Math.trunc(v * 3600)));
    }

    return `/api/admin/trader-scouting/search?${qp.toString()}`;
  }, [
    daysInt,
    offset,
    limit,
    q,
    categories,
    minTrades,
    minWinRatePct,
    maxDrawdownPct,
    minNetProfit,
    maxBestDayPct,
    minProfitFactor,
    minSlUsagePct,
    minTpUsagePct,
    minHoldHours,
    maxHoldHours,
  ]);

  const exportFilters = useMemo(() => {
    const payload: Record<string, unknown> = {
      days: daysInt,
    };
    if (exportLimit.trim()) {
      payload.exportLimit = Math.max(1, Math.trunc(clampNumber(exportLimit, 5000)));
    }

    if (minTrades.trim()) payload.minTrades = Math.max(0, Math.trunc(clampNumber(minTrades.trim(), 0)));

    const qTrim = q.trim();
    if (qTrim) payload.q = qTrim;
    if (categories.length) payload.categories = categories;

    if (minWinRatePct.trim()) {
      const v = clampPct01(minWinRatePct.trim());
      if (v != null) payload.minWinRate = v;
    }
    if (maxDrawdownPct.trim()) {
      const v = clampPct01(maxDrawdownPct.trim());
      if (v != null) payload.maxDrawdown = v;
    }
    if (minNetProfit.trim()) {
      const v = clampNumber(minNetProfit.trim(), NaN);
      if (Number.isFinite(v)) payload.minNetProfit = v;
    }
    if (maxBestDayPct.trim()) {
      const v = clampPct01(maxBestDayPct.trim());
      if (v != null) payload.maxBestDayPct = v;
    }

    if (minProfitFactor.trim()) {
      const v = clampNumber(minProfitFactor.trim(), NaN);
      if (Number.isFinite(v) && v >= 0) payload.minProfitFactor = v;
    }
    if (minSlUsagePct.trim()) {
      const v = clampPct01(minSlUsagePct.trim());
      if (v != null) payload.minSlUsage = v;
    }
    if (minTpUsagePct.trim()) {
      const v = clampPct01(minTpUsagePct.trim());
      if (v != null) payload.minTpUsage = v;
    }

    if (minHoldHours.trim()) {
      const v = clampNumber(minHoldHours.trim(), NaN);
      if (Number.isFinite(v) && v >= 0) payload.minHoldSec = Math.trunc(v * 3600);
    }
    if (maxHoldHours.trim()) {
      const v = clampNumber(maxHoldHours.trim(), NaN);
      if (Number.isFinite(v) && v >= 0) payload.maxHoldSec = Math.trunc(v * 3600);
    }

    return payload;
  }, [
    daysInt,
    exportLimit,
    q,
    categories,
    minTrades,
    minWinRatePct,
    maxDrawdownPct,
    minNetProfit,
    maxBestDayPct,
    minProfitFactor,
    minSlUsagePct,
    minTpUsagePct,
    minHoldHours,
    maxHoldHours,
  ]);

  const exportMutation = useMutation({
    mutationFn: async (format: "csv" | "jsonl" | "parquet") => {
      const res = await apiRequest("POST", "/api/admin/data-exports/trader-scouting", {
        format,
        filters: exportFilters,
      });
      return res.json() as Promise<{ ok: true; jobId: string; deduped: boolean }>;
    },
    onSuccess: ({ jobId, deduped }) => {
      toast({
        title: deduped ? "Using existing export job" : "Export job queued",
        description: `Job ID: ${jobId}`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Export failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const [debouncedSearchUrl, setDebouncedSearchUrl] = useState<string>(searchUrl);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearchUrl(searchUrl), 300);
    return () => window.clearTimeout(t);
  }, [searchUrl]);

  const { data: searchData, isFetching: isSearching, error: searchError } = useQuery({
    queryKey: [debouncedSearchUrl],
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    select: (raw: unknown) => traderSearchResponseSchema.parse(raw),
  });

  const results = searchData?.results ?? [];
  const hasMore = searchData?.hasMore ?? false;

  useEffect(() => {
    if (!selected) return;
    if (results.some((r) => r.userId === selected.userId)) return;
    setSelected(null);
  }, [results, selected]);

  const toggleCategory = (key: string) => {
    setCategories((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const drillUserId = selected?.userId ?? null;
  const breakdownUrl = useMemo(() => {
    if (!drillUserId) return null;
    const qp = new URLSearchParams();
    qp.set("days", String(daysInt));
    return `/api/admin/trader-scouting/${drillUserId}/asset-classes?${qp.toString()}`;
  }, [drillUserId, daysInt]);

  const extremesUrl = useMemo(() => {
    if (!drillUserId) return null;
    const qp = new URLSearchParams();
    qp.set("days", String(daysInt));
    qp.set("limit", "10");
    return `/api/admin/trader-scouting/${drillUserId}/trade-extremes?${qp.toString()}`;
  }, [drillUserId, daysInt]);

  const { data: breakdownData, isFetching: isBreakdownLoading } = useQuery({
    queryKey: breakdownUrl ? [breakdownUrl] : ["_noop_trader_breakdown"],
    enabled: Boolean(breakdownUrl),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    select: (raw: unknown) => traderSearchBreakdownResponseSchema.parse(raw),
  });

  const { data: extremesData, isFetching: isExtremesLoading } = useQuery({
    queryKey: extremesUrl ? [extremesUrl] : ["_noop_trader_extremes"],
    enabled: Boolean(extremesUrl),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    select: (raw: unknown) => traderSearchTradeExtremesResponseSchema.parse(raw),
  });

  return (
    <div className="space-y-4" data-testid="admin-trader-search">
      <Card className="bg-neutral-800 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base text-orange-300">Trader Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">User (email/username)</div>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-q"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Min closed trades</div>
              <Input
                value={minTrades}
                onChange={(e) => setMinTrades(e.target.value)}
                inputMode="numeric"
                placeholder="optional"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-trades"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Limit</div>
              <Input
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                inputMode="numeric"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-limit"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">Min win rate %</div>
              <Input
                value={minWinRatePct}
                onChange={(e) => setMinWinRatePct(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 55"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-winrate"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Max drawdown %</div>
              <Input
                value={maxDrawdownPct}
                onChange={(e) => setMaxDrawdownPct(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 10"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-max-drawdown"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Min net profit ($)</div>
              <Input
                value={minNetProfit}
                onChange={(e) => setMinNetProfit(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 5000"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-netprofit"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Max best day %</div>
              <Input
                value={maxBestDayPct}
                onChange={(e) => setMaxBestDayPct(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 50"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-max-bestday"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">Min profit factor</div>
              <Input
                value={minProfitFactor}
                onChange={(e) => setMinProfitFactor(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-pf"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Min SL usage %</div>
              <Input
                value={minSlUsagePct}
                onChange={(e) => setMinSlUsagePct(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-sl-usage"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Min TP usage %</div>
              <Input
                value={minTpUsagePct}
                onChange={(e) => setMinTpUsagePct(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-tp-usage"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">Min avg holding period (hours)</div>
              <Input
                value={minHoldHours}
                onChange={(e) => setMinHoldHours(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-min-avg-hold-hours"
              />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Max avg holding period (hours)</div>
              <Input
                value={maxHoldHours}
                onChange={(e) => setMaxHoldHours(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                className="bg-neutral-700 border-neutral-600 text-gray-100"
                data-testid="trader-search-max-avg-hold-hours"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="text-xs text-gray-400 mr-1">Categories:</div>
            {categoryChoices.map((key) => {
              const canonicalKey = normalizeInstrumentCategory(key, "unknown");
              const label = INSTRUMENT_CATEGORY_LABELS[canonicalKey];
              const active = categories.includes(canonicalKey);
              return (
                <Button
                  key={canonicalKey}
                  type="button"
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className={
                    active ? "bg-orange-600 hover:bg-orange-500" : "border-neutral-600 text-gray-200 hover:bg-neutral-700"
                  }
                  onClick={() => toggleCategory(canonicalKey)}
                >
                  {label}
                </Button>
              );
            })}
            {categories.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-gray-300 hover:bg-neutral-700"
                onClick={() => setCategories([])}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <div className="text-xs text-gray-400 mb-1">Export max rows</div>
                <Input
                  value={exportLimit}
                  onChange={(e) => setExportLimit(e.target.value)}
                  inputMode="numeric"
                  placeholder="5000"
                  className="bg-neutral-700 border-neutral-600 text-gray-100 w-36"
                  data-testid="trader-search-export-limit"
                />
              </div>

              <Button
                type="button"
                onClick={() => exportMutation.mutate("csv")}
                disabled={exportMutation.isPending}
                variant="csv"
                data-testid="trader-search-export-csv"
              >
                Export CSV (Excel)
              </Button>

              <Button
                type="button"
                onClick={() => exportMutation.mutate("jsonl")}
                disabled={exportMutation.isPending}
                variant="jsonl"
                data-testid="trader-search-export-jsonl"
              >
                Export JSONL
              </Button>

              <Button
                type="button"
                onClick={() => exportMutation.mutate("parquet")}
                disabled={exportMutation.isPending}
                variant="parquet"
                data-testid="trader-search-export-parquet"
              >
                Export Parquet
              </Button>
            </div>

            {exportMutation.isPending ? <div className="text-xs text-gray-400">Exporting…</div> : null}
          </div>

          {searchError ? (
            <div className="text-sm text-red-400">{String((searchError as any)?.message || searchError)}</div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="bg-neutral-800 border-gray-600 xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base text-gray-100">Results</CardTitle>
          </CardHeader>
          <CardContent>
            {isSearching ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400" />
              </div>
            ) : results.length === 0 ? (
              <div className="text-sm text-gray-400">No traders match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="trader-search-results">
                  <thead>
                    <tr className="text-gray-300 border-b border-neutral-700">
                      <th className="py-2 text-left">User</th>
                      <th className="py-2 text-right">Trades</th>
                      <th className="py-2 text-right">Net</th>
                      <th className="py-2 text-right">Win%</th>
                      <th className="py-2 text-right">PF</th>
                      <th className="py-2 text-right">Avg hold</th>
                      <th className="py-2 text-right">Max hold</th>
                      <th className="py-2 text-right">Max DD</th>
                      <th className="py-2 text-right">Best day</th>
                      <th className="py-2 text-left">Mix</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const isSelected = selected?.userId === r.userId;
                      const mix = topMixBadges(r.assetMix);
                      return (
                        <tr
                          key={r.userId}
                          className={`border-b border-neutral-900 hover:bg-neutral-700/40 ${isSelected ? "bg-neutral-700/40" : ""}`}
                        >
                          <td className="py-2">
                            <div className="font-medium text-white truncate max-w-[220px]">{r.username || "(no username)"}</div>
                            <div className="text-xs text-gray-400 truncate max-w-[220px]">{r.email || "—"}</div>
                          </td>
                          <td className="py-2 text-right text-gray-200">{r.trades}</td>
                          <td className={`py-2 text-right ${r.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {formatSignedUsd(r.netProfit)}
                          </td>
                          <td className="py-2 text-right text-gray-200">{formatPct01(r.winRate)}</td>
                          <td className="py-2 text-right text-gray-200">{r.profitFactor == null ? "—" : r.profitFactor.toFixed(2)}</td>
                          <td className="py-2 text-right text-gray-200">{formatDurationSec(r.avgHoldSec)}</td>
                          <td className="py-2 text-right text-gray-200">{formatDurationSec(r.maxHoldSec)}</td>
                          <td className="py-2 text-right text-gray-200">{formatPct01(r.maxDrawdown)}</td>
                          <td className="py-2 text-right text-gray-200">{formatPct01(r.bestDayPct)}</td>
                          <td className="py-2">
                            <div className="flex flex-wrap gap-1">
                              {mix.length === 0 ? (
                                <span className="text-xs text-gray-500">—</span>
                              ) : (
                                mix.map((m) => (
                                  <Badge
                                    key={m.k}
                                    variant="secondary"
                                    className="bg-neutral-900 border border-neutral-700 text-gray-200"
                                  >
                                    {m.k}:{(m.v * 100).toFixed(0)}%
                                  </Badge>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="py-2 text-right">
                            <Button
                              size="sm"
                              onClick={() => setSelected(r)}
                              className="bg-orange-600 hover:bg-orange-500"
                            >
                              Drilldown
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between pt-3">
              <div className="text-xs text-gray-400">
                Offset {offset} · Showing {results.length} · {hasMore ? "More available" : "End"}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-neutral-600 text-gray-200 hover:bg-neutral-700"
                  onClick={() => setOffset((o) => Math.max(0, o - Math.max(1, Math.trunc(clampNumber(limit, 25)))))}
                  disabled={offset === 0}
                >
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-neutral-600 text-gray-200 hover:bg-neutral-700"
                  onClick={() => setOffset((o) => o + Math.max(1, Math.trunc(clampNumber(limit, 25))))}
                  disabled={!hasMore}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-gray-600" data-testid="trader-search-drilldown">
          <CardHeader>
            <CardTitle className="text-base text-gray-100">Drilldown</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className="text-sm text-gray-400">Select a trader to view category mix and best/worst trades.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-white font-medium truncate">{selected.username || "(no username)"}</div>
                    <div className="text-xs text-gray-400 truncate">{selected.email || "—"}</div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-gray-300 hover:bg-neutral-700"
                    onClick={() => setSelected(null)}
                  >
                    Clear
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-neutral-900 border border-neutral-700 rounded p-2">
                    <div className="text-gray-400">Net</div>
                    <div className={selected.netProfit >= 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                      {formatSignedUsd(selected.netProfit)}
                    </div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-700 rounded p-2">
                    <div className="text-gray-400">Win rate</div>
                    <div className="text-gray-200 font-semibold">{formatPct01(selected.winRate)}</div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-700 rounded p-2">
                    <div className="text-gray-400">Avg hold</div>
                    <div className="text-gray-200 font-semibold">{formatDurationSec(selected.avgHoldSec)}</div>
                  </div>
                  <div className="bg-neutral-900 border border-neutral-700 rounded p-2">
                    <div className="text-gray-400">Max drawdown</div>
                    <div className="text-gray-200 font-semibold">{formatPct01(selected.maxDrawdown)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-200 mb-2">Category breakdown</div>
                  {isBreakdownLoading ? (
                    <div className="text-xs text-gray-500">Loading…</div>
                  ) : (breakdownData?.rows || []).length === 0 ? (
                    <div className="text-xs text-gray-500">—</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-neutral-700">
                            <th className="py-1 text-left">Category</th>
                            <th className="py-1 text-right">Trades</th>
                            <th className="py-1 text-right">Net</th>
                            <th className="py-1 text-right">Win%</th>
                            <th className="py-1 text-right">Avg hold</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(breakdownData?.rows || []).map((b) => (
                            <tr key={b.category} className="border-b border-neutral-900">
                              <td className="py-1 text-gray-200">{b.category}</td>
                              <td className="py-1 text-right text-gray-200">{b.trades}</td>
                              <td className={`py-1 text-right ${b.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {formatSignedUsd(b.netProfit)}
                              </td>
                              <td className="py-1 text-right text-gray-200">{formatPct01(b.winRate)}</td>
                              <td className="py-1 text-right text-gray-200">{formatDurationSec(b.avgHoldSec)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-sm text-gray-200 mb-2">Top / Bottom trades</div>
                  {isExtremesLoading ? (
                    <div className="text-xs text-gray-500">Loading…</div>
                  ) : !extremesData ? (
                    <div className="text-xs text-gray-500">—</div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Top</div>
                        {extremesData.top.length === 0 ? (
                          <div className="text-xs text-gray-500">—</div>
                        ) : (
                          <div className="space-y-1">
                            {extremesData.top.slice(0, 5).map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center justify-between gap-2 bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs text-gray-200 truncate">
                                    {t.symbol || "—"} · {(t.side || "—").toUpperCase()}
                                  </div>
                                  <div className="text-[11px] text-gray-500">Hold {formatDurationSec(t.holdSec)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-emerald-400 font-semibold">{formatSignedUsd(t.profit)}</div>
                                  <div className="text-[11px] text-gray-400">{formatPct01(t.priceReturnPct)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-xs text-gray-400 mb-1">Bottom</div>
                        {extremesData.bottom.length === 0 ? (
                          <div className="text-xs text-gray-500">—</div>
                        ) : (
                          <div className="space-y-1">
                            {extremesData.bottom.slice(0, 5).map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center justify-between gap-2 bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs text-gray-200 truncate">
                                    {t.symbol || "—"} · {(t.side || "—").toUpperCase()}
                                  </div>
                                  <div className="text-[11px] text-gray-500">Hold {formatDurationSec(t.holdSec)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-red-400 font-semibold">{formatSignedUsd(t.profit)}</div>
                                  <div className="text-[11px] text-gray-400">{formatPct01(t.priceReturnPct)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
