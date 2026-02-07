import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProviderRow = {
  id: number;
  providerKey: string;
  displayName: string;
  driver: string;
  configJson: string;
  isEnabled: boolean;
  configUsable?: boolean;
  missingSecrets?: string[];
  capability?: {
    quotesRest: boolean;
    quotesWs: boolean;
    referenceData: boolean;
    batchSymbols: boolean;
  } | null;
  streamSupported?: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  isActive?: boolean;
};

type ProvidersResp = {
  ok: boolean;
  activeKey: string | null;
  fallbackKeys: string[];
  rows: ProviderRow[];
};

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function MarketDataProvidersCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ProvidersResp>({
    queryKey: ["/api/admin/market-data/providers"],
  });

  const providers = useMemo(() => (data?.rows || []).filter((p) => !p.deletedAt), [data?.rows]);
  const activeKey = data?.activeKey ?? null;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProviderKey, setUploadProviderKey] = useState("");
  const [uploadDisplayName, setUploadDisplayName] = useState("");
  const [uploadDriver, setUploadDriver] = useState<string>("twelvedata");
  const [uploadConfigJson, setUploadConfigJson] = useState(prettyJson({ driver: "twelvedata", apiKey: "env:TWELVE_DATA_API_KEY" }));

  const [reloadOpen, setReloadOpen] = useState(false);
  const [reloadMode, setReloadMode] = useState<"create_missing" | "upsert">("upsert");

  const activateMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const res = await apiRequest("POST", `/api/admin/market-data/providers/${encodeURIComponent(providerKey)}/activate`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
      toast({ title: "Provider activated", description: "Market data provider selection updated." });
    },
    onError: (e: any) => {
      toast({ title: "Activation failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const res = await apiRequest("POST", `/api/admin/market-data/providers/${encodeURIComponent(providerKey)}/test`, { symbols: ["EURUSD"] });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: data?.ok ? "Provider test OK" : "Provider test failed",
        description: data?.ok ? `Quotes: ${data?.quoteCount ?? 0}` : String(data?.error ?? "Unknown error"),
        variant: data?.ok ? undefined : "destructive",
      });
    },
    onError: (e: any) => {
      toast({ title: "Provider test failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const res = await apiRequest("DELETE", `/api/admin/market-data/providers/${encodeURIComponent(providerKey)}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
      toast({ title: "Provider deleted", description: "Provider removed from the registry." });
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const res = await apiRequest("GET", `/api/admin/market-data/providers/${encodeURIComponent(providerKey)}/export`);
      const blob = await res.blob();
      return { providerKey, blob };
    },
    onSuccess: ({ providerKey, blob }) => {
      const filename = `provider-${providerKey}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Exported provider config", description: filename });
    },
    onError: (e: any) => {
      toast({ title: "Export failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const exportBundleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/market-data/providers/export-bundle");
      const blob = await res.blob();
      return { blob };
    },
    onSuccess: ({ blob }) => {
      const filename = "market-data-providers.bundle.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Exported bundle", description: filename });
    },
    onError: (e: any) => {
      toast({ title: "Export failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const reloadFilesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/market-data/providers/reload-files", { mode: reloadMode });
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
      setReloadOpen(false);
      toast({
        title: data?.ok ? "Reloaded provider files" : "Reload completed with errors",
        description: `created=${Number(data?.createdKeys?.length ?? 0)} updated=${Number(data?.updatedKeys?.length ?? 0)} skipped=${Number(data?.skippedKeys?.length ?? 0)}`,
        variant: data?.ok ? undefined : "destructive",
      });
    },
    onError: (e: any) => {
      toast({ title: "Reload failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const cfg = parseJson(uploadConfigJson);
      if (!cfg) throw new Error("Invalid config JSON");
      const payload = {
        providerKey: uploadProviderKey.trim(),
        displayName: uploadDisplayName.trim(),
        driver: uploadDriver,
        config: cfg,
      };
      const res = await apiRequest("POST", "/api/admin/market-data/providers", payload);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
      setUploadOpen(false);
      toast({ title: "Provider uploaded", description: "Provider configuration saved." });
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const obj = parseJson(text);
    if (!obj) {
      toast({ title: "Invalid JSON", description: "Could not parse provider config JSON.", variant: "destructive" });
      return;
    }

    const providerKey = String(obj.providerKey ?? "").trim();
    const displayName = String(obj.displayName ?? obj.name ?? "").trim();
    const driver = String(obj.driver ?? "").trim();
    const config = obj.config ?? (obj.driver ? obj : null);

    if (providerKey) setUploadProviderKey(providerKey);
    if (displayName) setUploadDisplayName(displayName);
    if (driver) setUploadDriver(driver);
    if (config) setUploadConfigJson(prettyJson(config));
    else setUploadConfigJson(prettyJson(obj));
  };

  return (
    <Card className="bg-neutral-700 border-gray-600">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Providers</CardTitle>
          <CardDescription>
            Switch market data providers instantly. Upload JSON configs for new providers (secrets should be `env:...` references).
          </CardDescription>
          <div className="mt-2 text-xs text-gray-300">
            Active: <span className="font-mono">{activeKey ?? "—"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            onClick={() => setReloadOpen(true)}
            disabled={reloadFilesMutation.isPending}
            className="bg-neutral-600 hover:bg-neutral-500"
          >
            Reload From Disk
          </Button>

          <Button
            variant="outline"
            onClick={() => exportBundleMutation.mutate()}
            disabled={exportBundleMutation.isPending}
            className="bg-neutral-600 hover:bg-neutral-500"
          >
            Export Bundle
          </Button>

          <Button variant="outline" onClick={() => setUploadOpen(true)} className="bg-neutral-600 hover:bg-neutral-500">
            Upload Config
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-gray-300">Loading providers…</div>
        ) : providers.length === 0 ? (
          <div className="text-sm text-gray-300">No providers found.</div>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => {
              const isActive = Boolean(activeKey && p.providerKey === activeKey);
              const isBuiltin = p.providerKey === "twelvedata" || p.providerKey === "1forge";
              return (
                <div key={p.providerKey} className="flex flex-col md:flex-row md:items-center justify-between gap-2 p-3 rounded border border-gray-600 bg-neutral-800/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{p.displayName}</span>
                      <Badge variant="outline" className="font-mono">{p.providerKey}</Badge>
                      {isActive && <Badge className="bg-emerald-700">Active</Badge>}
                      {!p.isEnabled && <Badge variant="destructive">Disabled</Badge>}
                      {p.configUsable === false && (
                        <Badge variant="destructive" title={(p.missingSecrets || []).join(", ")}>
                          Secrets missing
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Driver: <span className="font-mono">{p.driver}</span>
                      {p.capability ? (
                        <>
                          {" "}·{" "}
                          {p.capability.quotesRest ? "REST" : "No REST"}
                          {" / "}
                          {p.capability.quotesWs ? "WS" : "No WS"}
                          {" / "}
                          {p.capability.referenceData ? "Reference data" : "No reference data"}
                          {p.capability.quotesWs ? (
                            <>
                              {" / "}
                              {p.streamSupported ? "WS stream adapter ready" : "WS stream adapter missing"}
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => exportMutation.mutate(p.providerKey)}
                      disabled={exportMutation.isPending}
                      className="bg-neutral-700 hover:bg-neutral-600"
                    >
                      Export
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => testMutation.mutate(p.providerKey)}
                      disabled={testMutation.isPending}
                      className="bg-neutral-700 hover:bg-neutral-600"
                    >
                      Test
                    </Button>

                    <Button
                      size="sm"
                      onClick={() => activateMutation.mutate(p.providerKey)}
                      disabled={isActive || activateMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Activate
                    </Button>

                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(p.providerKey)}
                      disabled={isBuiltin || isActive || deleteMutation.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Provider Config (JSON)</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>Config file</Label>
              <Input
                type="file"
                accept="application/json"
                onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                className="bg-neutral-700 mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">
                Supported shapes: a full object with `providerKey`, `displayName`, `driver`, `config` OR a raw config object with `driver`.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Provider Key</Label>
                <Input value={uploadProviderKey} onChange={(e) => setUploadProviderKey(e.target.value)} className="bg-neutral-700 mt-1 font-mono" />
              </div>
              <div>
                <Label>Display Name</Label>
                <Input value={uploadDisplayName} onChange={(e) => setUploadDisplayName(e.target.value)} className="bg-neutral-700 mt-1" />
              </div>
              <div>
                <Label>Driver</Label>
                <Select value={uploadDriver} onValueChange={setUploadDriver}>
                  <SelectTrigger className="bg-neutral-700 mt-1">
                    <SelectValue placeholder="Select driver" />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-800 border-gray-700">
                    <SelectItem value="twelvedata">twelvedata</SelectItem>
                    <SelectItem value="oneforge">oneforge</SelectItem>
                    <SelectItem value="generic_rest_v1">generic_rest_v1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Config JSON</Label>
              <textarea
                value={uploadConfigJson}
                onChange={(e) => setUploadConfigJson(e.target.value)}
                className="w-full mt-1 p-2 rounded bg-neutral-700 border border-gray-600 font-mono text-xs h-56"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} className="bg-neutral-700">
              Cancel
            </Button>
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending || !uploadProviderKey.trim() || !uploadDisplayName.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {uploadMutation.isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-lg">
          <DialogHeader>
            <DialogTitle>Reload Provider Configs From Disk</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm text-gray-200">
            <div>
              Reloads JSON configs from <span className="font-mono">config/marketdata/providers</span> (or{" "}
              <span className="font-mono">MARKET_DATA_PROVIDER_CONFIG_DIR</span>) and syncs them into the DB.
            </div>

            <div className="space-y-2">
              <Label>Sync mode</Label>
              <Select value={reloadMode} onValueChange={(v) => setReloadMode(v as any)}>
                <SelectTrigger className="bg-neutral-700">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent className="bg-neutral-800 border-gray-700">
                  <SelectItem value="upsert">upsert (overwrite existing)</SelectItem>
                  <SelectItem value="create_missing">create_missing (safer)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReloadOpen(false)} className="bg-neutral-700">
              Cancel
            </Button>
            <Button
              onClick={() => reloadFilesMutation.mutate()}
              disabled={reloadFilesMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {reloadFilesMutation.isPending ? "Reloading…" : "Reload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
