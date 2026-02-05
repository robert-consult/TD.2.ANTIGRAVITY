import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PipDefaultRow = {
  category: string;
  pipDecimals: number;
  quoteDecimals: number | null;
  updatedAt: number;
  updatedByAdminId: number | null;
};

type PipDefaultsResp = { ok: boolean; rows: PipDefaultRow[] };

export function PipDefaultsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<PipDefaultsResp>({
    queryKey: ["/api/admin/market-data/pip-defaults"],
  });

  const rows = useMemo(() => data?.rows || [], [data?.rows]);

  const [draft, setDraft] = useState<Record<string, { pipDecimals: number; quoteDecimals: number | null }>>({});

  useEffect(() => {
    const next: Record<string, { pipDecimals: number; quoteDecimals: number | null }> = {};
    for (const r of rows) next[r.category] = { pipDecimals: r.pipDecimals, quoteDecimals: r.quoteDecimals };
    setDraft(next);
  }, [rows]);

  const saveMutation = useMutation({
    mutationFn: async (category: string) => {
      const v = draft[category];
      const res = await apiRequest("PUT", `/api/admin/market-data/pip-defaults/${encodeURIComponent(category)}`, v);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/pip-defaults"] });
      toast({ title: "Saved", description: "Pip defaults updated." });
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  return (
    <Card className="bg-neutral-700 border-gray-600">
      <CardHeader>
        <CardTitle className="text-base">Pip Defaults</CardTitle>
        <CardDescription>
          Default pip/quote decimalization per category. Per-instrument overrides are set on individual instruments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-gray-300">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-300">No defaults found.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const v = draft[r.category] ?? { pipDecimals: r.pipDecimals, quoteDecimals: r.quoteDecimals };
              return (
                <div key={r.category} className="grid grid-cols-1 md:grid-cols-5 gap-2 p-3 rounded border border-gray-600 bg-neutral-800/40">
                  <div className="md:col-span-2 flex items-center">
                    <span className="font-mono text-sm">{r.category}</span>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">pipDecimals</div>
                    <Input
                      type="number"
                      value={v.pipDecimals}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setDraft((prev) => ({ ...prev, [r.category]: { ...v, pipDecimals: Number.isFinite(n) ? n : v.pipDecimals } }));
                      }}
                      className="bg-neutral-600 mt-1"
                      min={0}
                      max={12}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">quoteDecimals</div>
                    <Input
                      type="number"
                      value={v.quoteDecimals ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = raw === "" ? null : Number(raw);
                        setDraft((prev) => ({ ...prev, [r.category]: { ...v, quoteDecimals: n != null && Number.isFinite(n) ? n : null } }));
                      }}
                      className="bg-neutral-600 mt-1"
                      min={0}
                      max={12}
                      placeholder="(null)"
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      onClick={() => saveMutation.mutate(r.category)}
                      disabled={saveMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

