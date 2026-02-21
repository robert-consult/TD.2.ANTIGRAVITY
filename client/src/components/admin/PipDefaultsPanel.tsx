import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type PipDefaultRow = {
  category: string;
  pipDecimals: number;
  quoteDecimals: number | null;
  updatedAt: number;
  updatedByAdminId: number | null;
};

type PipDefaultsResp = { ok: boolean; rows: PipDefaultRow[] };

const PIP_DEFAULTS_FIELD_HELP = {
  pipDecimals: {
    inline: "Default pip precision exponent for all symbols in this category.",
    tooltip:
      "Used when symbol-level override is absent. Pip size is calculated as 10^-pipDecimals and impacts spread/pips math.",
  },
  quoteDecimals: {
    inline: "Default quote display precision for this category.",
    tooltip:
      "Controls quote rounding when no symbol override is set. Keep aligned with market convention for readable prices.",
  },
  save: {
    inline: "Persist category defaults for future symbol onboarding and fallback formatting.",
    tooltip:
      "Changes apply to category defaults only. Existing symbol overrides continue to take precedence where configured.",
  },
} as const;

function PipDefaultsHintLabel({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs text-gray-400">{label}</Label>
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
    <TooltipProvider delayDuration={120}>
    <Card className="bg-neutral-700 border-gray-600">
      <CardHeader>
        <CardTitle className="text-base">Pip Defaults</CardTitle>
        <CardDescription>
          Default pip/quote decimalization per category. Per-instrument overrides are set on individual instruments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-3">
          Category precision defaults include hidden <span className="font-medium">Hint</span> explainers for pip math, quote formatting, and override behavior.
        </div>
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
                    <PipDefaultsHintLabel label="pipDecimals" hint={PIP_DEFAULTS_FIELD_HELP.pipDecimals.tooltip} />
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
                      title={PIP_DEFAULTS_FIELD_HELP.pipDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{PIP_DEFAULTS_FIELD_HELP.pipDecimals.inline}</p>
                  </div>
                  <div>
                    <PipDefaultsHintLabel label="quoteDecimals" hint={PIP_DEFAULTS_FIELD_HELP.quoteDecimals.tooltip} />
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
                      title={PIP_DEFAULTS_FIELD_HELP.quoteDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{PIP_DEFAULTS_FIELD_HELP.quoteDecimals.inline}</p>
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      onClick={() => saveMutation.mutate(r.category)}
                      disabled={saveMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                      title={PIP_DEFAULTS_FIELD_HELP.save.tooltip}
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
    </TooltipProvider>
  );
}
