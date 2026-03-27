import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { FieldHintLabel, SYSTEM_HEALTH_FIELD_HELP, type MarketDataProvidersResp, type SystemHealthData } from "./AdminDashboardSupport";
import { OPS_TOOLS } from "./opsAccess";

interface SystemHealthPanelProps {
  healthProviderKey: string;
  setHealthProviderKey: (providerKey: string) => void;
  refetchHealth: () => void;
  providers: MarketDataProvidersResp["rows"];
  activeProviderKey: string | null;
  health?: SystemHealthData;
  probeProviderPending: boolean;
  onProbeProvider: () => void;
}

export function SystemHealthPanel({
  healthProviderKey,
  setHealthProviderKey,
  refetchHealth,
  providers,
  activeProviderKey,
  health,
  probeProviderPending,
  onProbeProvider,
}: SystemHealthPanelProps) {
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const grafanaHref = "/grafana/d/tradehub-http-observability";
  const businessFlowHref = "/grafana/d/tradehub-business-flow-health";
  const prometheusHref = OPS_TOOLS.find((tool) => tool.key === "prometheus")?.href ?? "/prometheus";

  return (
    <TabsContent value="health">
      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">System Health Status</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchHealth()}
            className="bg-neutral-600 hover:bg-neutral-500"
            title={SYSTEM_HEALTH_FIELD_HELP.refresh.tooltip}
          >
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <TooltipProvider delayDuration={120}>
            <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
              Inspect market data provider readiness using hidden <span className="font-medium">Hint</span> explainers for probe behavior and diagnostics.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-3">
                <FieldHintLabel label="Provider" hint={SYSTEM_HEALTH_FIELD_HELP.provider.tooltip} />
                <p className="text-xs text-gray-400 mt-1">{SYSTEM_HEALTH_FIELD_HELP.provider.inline}</p>
                <Select value={healthProviderKey} onValueChange={setHealthProviderKey}>
                  <SelectTrigger className="bg-neutral-600 mt-2" title={SYSTEM_HEALTH_FIELD_HELP.provider.tooltip}>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent className="bg-neutral-700">
                    {providers.map((p) => (
                      <SelectItem key={p.providerKey} value={p.providerKey}>
                        {p.displayName} ({p.providerKey})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">
                  Active configured: <span className="font-mono">{health?.activeProviderKey ?? activeProviderKey ?? "—"}</span>{" "}
                  · Feed using: <span className="font-mono">{health?.feedProviderKey ?? health?.feedSource ?? "simulated"}</span>
                </p>
                {health?.requestedProvider?.missingSecrets?.length ? (
                  <p className="text-xs text-amber-300 mt-1">
                    Missing env secrets: <span className="font-mono">{health.requestedProvider.missingSecrets.join(", ")}</span>
                  </p>
                ) : null}
              </div>
              <div className="flex items-end justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onProbeProvider}
                  disabled={probeProviderPending || !healthProviderKey}
                  className="bg-neutral-600 hover:bg-neutral-500"
                  title={SYSTEM_HEALTH_FIELD_HELP.fetchStatus.tooltip}
                >
                  {probeProviderPending ? "Fetching…" : "Fetch Status"}
                </Button>
              </div>
            </div>

            {health ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="flex items-center mb-2">
                    <div
                      className={`w-3 h-3 rounded-full mr-2 ${healthProviderKey && health.feedProviderKey && healthProviderKey === health.feedProviderKey
                        ? (health.feedProviderConnected ? "bg-green-500" : "bg-red-500")
                        : healthProviderKey
                          ? (health.requestedProvider?.configUsable ? "bg-amber-500" : "bg-red-500")
                          : "bg-gray-500"
                        }`}
                    ></div>
                    <span className="font-medium">Provider Status</span>
                  </div>
                  <p
                    className={`text-lg ${healthProviderKey && health.feedProviderKey && healthProviderKey === health.feedProviderKey
                      ? (health.feedProviderConnected ? "text-green-400" : "text-red-400")
                      : healthProviderKey
                        ? (health.requestedProvider?.configUsable ? "text-amber-300" : "text-red-400")
                        : "text-gray-400"
                      }`}
                  >
                    {(() => {
                      if (!healthProviderKey) return "Select a provider";
                      const selectedIsFeed = Boolean(health.feedProviderKey && healthProviderKey === health.feedProviderKey);
                      if (selectedIsFeed) return health.feedProviderConnected ? "Connected" : "Disconnected";
                      if (health.requestedProvider?.error) return String(health.requestedProvider.error);
                      if (health.requestedProvider?.configUsable) return "Configured (not active)";
                      if (health.requestedProvider?.missingSecrets?.length) return "Missing API key";
                      return "Unknown";
                    })()}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Selected: <span className="font-mono">{healthProviderKey || "—"}</span>
                    {health.requestedProvider?.displayName ? (
                      <>
                        {" "}
                        · <span className="truncate">{health.requestedProvider.displayName}</span>
                      </>
                    ) : null}
                  </p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Last Provider Success</div>
                  <p className="text-lg">
                    {health.lastProviderSuccessAt ? new Date(health.lastProviderSuccessAt).toLocaleString() : "Never"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Provider: <span className="font-mono">{health.lastProviderSuccessKey ?? "—"}</span>
                  </p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Consecutive Failures</div>
                  <p className={`text-lg ${health.failures > 0 ? "text-amber-400" : "text-green-400"}`}>
                    {health.failures}
                  </p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Feed Source</div>
                  <p className="text-lg font-mono">{health.feedSource ?? "—"}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {health.feedSourceAt ? new Date(health.feedSourceAt).toLocaleString() : "—"}
                  </p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Stale Symbols</div>
                  <p className={`text-lg ${health.staleCount > 0 ? "text-amber-400" : "text-green-400"}`}>
                    {health.staleCount}
                  </p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Quote Cache Size</div>
                  <p className="text-lg">{health.cacheSize} symbols</p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Server Time</div>
                  <p className="text-lg">{new Date(health.serverTime).toLocaleString()}</p>
                </div>

                <div className="bg-neutral-800 p-4 rounded-lg">
                  <div className="font-medium mb-2">Last Feed Update</div>
                  <p className="text-lg">
                    {health.lastSuccess ? new Date(health.lastSuccess).toLocaleString() : "Never"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400">Loading health data...</p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild variant="outline" size="sm" className="bg-neutral-600 hover:bg-neutral-500">
                <a href={grafanaHref} target="_blank" rel="noreferrer">
                  Open HTTP Dashboard
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="bg-neutral-600 hover:bg-neutral-500">
                <a href={businessFlowHref} target="_blank" rel="noreferrer">
                  Open Business Flow Dashboard
                </a>
              </Button>
              {isSuperAdmin ? (
                <Button asChild variant="outline" size="sm" className="bg-neutral-600 hover:bg-neutral-500">
                  <a href={prometheusHref} target="_blank" rel="noreferrer">
                    Open Prometheus
                  </a>
                </Button>
              ) : null}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
