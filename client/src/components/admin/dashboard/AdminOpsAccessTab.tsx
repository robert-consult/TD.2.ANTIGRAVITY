import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { GRAFANA_DASHBOARDS, OPS_TOOLS, canAccessOpsTool } from "./opsAccess";

type AdminOpsAccessTabProps = {
  onSelectAdminTab: (tab: string) => void;
};

export function AdminOpsAccessTab({ onSelectAdminTab }: AdminOpsAccessTabProps) {
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.isSuperAdmin);

  return (
    <TabsContent value="ops" className="p-4">
      <div className="space-y-4">
        <Card className="bg-neutral-800 border-neutral-700 text-white">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>Ops Access Directory</span>
              <Badge variant="outline">{isSuperAdmin ? "Superadmin" : "Admin"}</Badge>
            </CardTitle>
            <CardDescription className="text-gray-300">
              Each observability surface keeps its own URL. This page is the launcher and quick-reference map.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-gray-300">
            Same-host paths are the default cluster access model. Local port-forward commands remain the documented fallback for dev or break-glass access.
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {OPS_TOOLS.map((tool) => {
            const allowed = canAccessOpsTool(tool, isSuperAdmin);
            return (
              <Card key={tool.key} className="bg-neutral-800 border-neutral-700 text-white">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span>{tool.name}</span>
                    <Badge variant={allowed ? "outline" : "secondary"}>
                      {tool.requiredRole === "admin" ? "Admin+" : "Superadmin only"}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-gray-300">{tool.purpose}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-300">
                  <div>
                    Path: <code className="text-white">{tool.href}</code>
                  </div>
                  {tool.localAccess ? (
                    <div>
                      Local fallback: <code className="text-white">{tool.localAccess}</code>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {allowed ? (
                      <Button asChild variant="outline" size="sm" className="bg-neutral-700 hover:bg-neutral-600">
                        <a href={tool.href} target="_blank" rel="noreferrer">
                          Open {tool.name}
                        </a>
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled className="bg-neutral-700">
                        {tool.name} requires superadmin
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="bg-neutral-800 border-neutral-700 text-white">
          <CardHeader>
            <CardTitle className="text-base">Grafana Dashboards</CardTitle>
            <CardDescription className="text-gray-300">
              Launch the operator dashboards directly through Grafana. These links reuse the same protected `/grafana` surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {GRAFANA_DASHBOARDS.map((dashboard) => (
              <div key={dashboard.href} className="rounded-md border border-neutral-700 bg-neutral-900/70 p-3">
                <div className="font-medium text-white">{dashboard.name}</div>
                <div className="mt-1 text-sm text-gray-300">{dashboard.description}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="bg-neutral-700 hover:bg-neutral-600">
                    <a href={dashboard.href} target="_blank" rel="noreferrer">
                      Open Dashboard
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-neutral-800 border-neutral-700 text-white">
          <CardHeader>
            <CardTitle className="text-base">Existing Control Surfaces</CardTitle>
            <CardDescription className="text-gray-300">
              Runtime controls stay in the existing admin tabs. Use these shortcuts instead of duplicating control UI inside the observability tools.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="bg-neutral-700 hover:bg-neutral-600" onClick={() => onSelectAdminTab("system")}>
              Open System Config
            </Button>
            <Button variant="outline" size="sm" className="bg-neutral-700 hover:bg-neutral-600" onClick={() => onSelectAdminTab("data")}>
              Open Data
            </Button>
            <Button variant="outline" size="sm" className="bg-neutral-700 hover:bg-neutral-600" onClick={() => onSelectAdminTab("trades")}>
              Open Trade Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
