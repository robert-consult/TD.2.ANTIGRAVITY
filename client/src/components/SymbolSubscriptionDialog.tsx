import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";

type QuoteMode = "BASIC_ONLY" | "BASIC_PLUS_CUSTOM" | "CUSTOM_ONLY";

type SymbolRow = {
  id: number;
  symbol: string;
  name: string;
  category?: string | null;
  enabled?: boolean;
};

type AvailableSymbolsResponse = {
  q: string;
  limit: number;
  rows: Array<
    SymbolRow & {
      isSubscribed: boolean;
    }
  >;
};

type SubscriptionsResponse = {
  subscriptions: SymbolRow[];
};

const MODE_LABELS: Record<QuoteMode, string> = {
  BASIC_ONLY: "Basic only",
  BASIC_PLUS_CUSTOM: "Basic + Customizable",
  CUSTOM_ONLY: "Customizable only",
};

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function SymbolSubscriptionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "manage";
  effectiveMode: QuoteMode;
}) {
  const { open, onOpenChange, mode, effectiveMode } = props;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [draftSymbolIds, setDraftSymbolIds] = useState<Set<number>>(new Set());
  const [isDirty, setIsDirty] = useState(false);

  const invalidateByPrefix = (prefix: string) => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey?.[0];
        return typeof key === "string" && key.startsWith(prefix);
      },
    });
  };

  const availableQueryPath = useMemo(() => {
    const qp = new URLSearchParams();
    if (debouncedSearch.trim()) qp.set("q", debouncedSearch.trim());
    qp.set("limit", "180");
    qp.set("excludeAllowed", "true");
    return `/api/quote-subscriptions/available-symbols?${qp.toString()}`;
  }, [debouncedSearch]);

  const subscriptionsQuery = useQuery<SubscriptionsResponse>({
    queryKey: ["/api/quote-subscriptions/me/subscriptions"],
    enabled: open,
  });

  const availableQuery = useQuery<AvailableSymbolsResponse>({
    queryKey: [availableQueryPath],
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setSearchInput("");
      setDebouncedSearch("");
      setIsDirty(false);
      return;
    }
    setSearchInput("");
    setDebouncedSearch("");
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!open || isDirty || !subscriptionsQuery.data) return;
    setDraftSymbolIds(new Set(subscriptionsQuery.data.subscriptions.map((row) => row.id)));
  }, [isDirty, open, subscriptionsQuery.data]);

  const symbolById = useMemo(() => {
    const map = new Map<number, SymbolRow>();
    for (const row of subscriptionsQuery.data?.subscriptions ?? []) {
      map.set(row.id, {
        ...row,
        symbol: String(row.symbol).toUpperCase(),
      });
    }
    for (const row of availableQuery.data?.rows ?? []) {
      map.set(row.id, {
        ...row,
        symbol: String(row.symbol).toUpperCase(),
      });
    }
    return map;
  }, [availableQuery.data?.rows, subscriptionsQuery.data?.subscriptions]);

  const normalizedDraftIds = useMemo(() => {
    const next = new Set<number>();
    for (const id of draftSymbolIds.values()) {
      if (symbolById.has(id)) next.add(id);
    }
    return next;
  }, [draftSymbolIds, symbolById]);

  useEffect(() => {
    if (!open) return;
    if (setsEqual(normalizedDraftIds, draftSymbolIds)) return;
    setDraftSymbolIds(normalizedDraftIds);
    setIsDirty(true);
  }, [draftSymbolIds, normalizedDraftIds, open]);

  const selectedRows = useMemo(() => {
    const rows: SymbolRow[] = [];
    for (const id of normalizedDraftIds.values()) {
      const row = symbolById.get(id);
      if (row) rows.push(row);
    }
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return rows;
  }, [normalizedDraftIds, symbolById]);

  const availableRows = useMemo(() => {
    return (availableQuery.data?.rows ?? [])
      .filter((row) => !draftSymbolIds.has(row.id))
      .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
  }, [availableQuery.data?.rows, draftSymbolIds]);

  const saveMutation = useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/quote-subscriptions/me/subscriptions"] });
      const previous = queryClient.getQueryData<SubscriptionsResponse>(["/api/quote-subscriptions/me/subscriptions"]);
      const subscriptions = Array.from(normalizedDraftIds.values())
        .map((id) => symbolById.get(id))
        .filter((row): row is SymbolRow => Boolean(row));
      queryClient.setQueryData<SubscriptionsResponse>(
        ["/api/quote-subscriptions/me/subscriptions"],
        { subscriptions },
      );
      return { previous };
    },
    mutationFn: async () => {
      const payload = { symbolIds: Array.from(normalizedDraftIds.values()).sort((a, b) => a - b) };
      const res = await apiRequest("PUT", "/api/quote-subscriptions/me/subscriptions", payload);
      return await res.json();
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/quote-subscriptions/me/subscriptions"], context.previous);
      }
      toast({
        title: "Update failed",
        description: String(error?.message ?? "Could not update symbol subscriptions"),
        variant: "destructive",
      });
    },
    onSuccess: () => {
      setIsDirty(false);
      toast({ title: "Saved", description: "Your custom quote symbols were updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me/subscriptions"] });
      invalidateByPrefix("/api/quote-subscriptions/available-symbols");
      queryClient.invalidateQueries({ queryKey: ["/api/quotes/latest"] });
      onOpenChange(false);
    },
  });

  const title = mode === "add" ? "Add Symbols" : "Manage Symbols";
  const description =
    mode === "add"
      ? "Search ingested instruments and add symbols to your custom quote watchlist."
      : "Edit your custom watchlist. Remove symbols you no longer want streamed.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-neutral-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-gray-300">
            {description} Current quote mode: <span className="font-medium text-cyan-300">{MODE_LABELS[effectiveMode]}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search symbols, names, or categories..."
              className="bg-neutral-800 border-gray-700 pl-8"
            />
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="border border-gray-700 rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-700 bg-neutral-800 text-sm font-medium">
                Available Instruments ({availableRows.length})
              </div>
              <div className="max-h-80 overflow-auto divide-y divide-gray-800">
                {availableQuery.isLoading ? (
                  <div className="px-3 py-6 text-sm text-gray-300">Loading symbols...</div>
                ) : availableRows.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-gray-400">No matching symbols found.</div>
                ) : (
                  availableRows.map((row) => (
                    <div key={row.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-medium">{String(row.symbol).toUpperCase()}</div>
                        <div className="text-xs text-gray-400 truncate">{row.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          {row.category ? <Badge variant="secondary">{row.category}</Badge> : null}
                          {row.enabled === false ? <Badge variant="destructive">Not in baseline</Badge> : null}
                        </div>
                      </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-neutral-800 hover:bg-neutral-700 border-gray-600"
                        onClick={() => {
                          setDraftSymbolIds((prev) => {
                            const next = new Set(prev);
                            next.add(row.id);
                            return next;
                          });
                          setIsDirty(true);
                        }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

            <div className="border border-gray-700 rounded-md overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-700 bg-neutral-800 text-sm font-medium">
                Your Custom Symbols ({selectedRows.length})
              </div>
              <div className="max-h-80 overflow-auto divide-y divide-gray-800">
                {subscriptionsQuery.isLoading && !selectedRows.length ? (
                  <div className="px-3 py-6 text-sm text-gray-300">Loading your symbols...</div>
                ) : selectedRows.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-gray-400">No custom symbols selected.</div>
                ) : (
                  selectedRows.map((row) => (
                    <div key={row.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-medium">{row.symbol}</div>
                        <div className="text-xs text-gray-400 truncate">{row.name}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-neutral-800 hover:bg-red-900/40 border-gray-600"
                        onClick={() => {
                          setDraftSymbolIds((prev) => {
                            const next = new Set(prev);
                            next.delete(row.id);
                            return next;
                          });
                          setIsDirty(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Remove
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="bg-neutral-800 hover:bg-neutral-700 border-gray-600"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !isDirty}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {mode === "add" ? "Save Added Symbols" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
