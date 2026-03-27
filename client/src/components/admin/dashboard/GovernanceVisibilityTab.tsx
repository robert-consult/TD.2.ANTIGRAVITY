import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { RuntimeGovernanceSnapshot } from "@shared/runtimeConfig";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { OPS_TOOLS } from "./opsAccess";

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return "—";
  return new Date(value * 1000).toLocaleString();
}

function statusVariant(status: string): "default" | "outline" | "secondary" | "destructive" {
  if (status === "failed" || status === "missing-doc") return "destructive";
  if (status === "pending" || status === "partial") return "secondary";
  if (status === "applied" || status === "aligned") return "default";
  return "outline";
}

export function GovernanceVisibilityTab() {
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const { data, isLoading } = useQuery<RuntimeGovernanceSnapshot>({
    queryKey: ["/api/admin/runtime-config/governance"],
    queryFn: () => axios.get("/api/admin/runtime-config/governance").then((response) => response.data),
  });

  if (isLoading) {
    return <div className="text-sm text-gray-300">Loading governance snapshot…</div>;
  }

  if (!data) {
    return <div className="text-sm text-gray-300">Governance snapshot unavailable.</div>;
  }

  return (
    <div className="space-y-4" data-testid="governance-visibility-tab">
      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Governance Overview</CardTitle>
          <CardDescription>
            Effective values are shown here with mutability boundaries. Local development may intentionally drift from
            the checked-in Kubernetes manifests; drift badges make that visible instead of silent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs text-gray-300">
          <Badge variant="outline">Generated {formatTimestamp(data.generatedAt)}</Badge>
          <Badge variant="outline">Sections {data.sections.length}</Badge>
          <Badge variant="outline">Reload Domains {data.reloads.length}</Badge>
          <Badge variant="outline">Docs {data.documentation.length}</Badge>
        </CardContent>
      </Card>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">External Ops Surfaces</CardTitle>
          <CardDescription>
            Governance stays read-only here, but the linked observability tools remain the live operational surfaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="bg-neutral-600 hover:bg-neutral-500">
            <a href="/grafana/d/tradehub-ops-overview" target="_blank" rel="noreferrer">
              Open Grafana Overview
            </a>
          </Button>
          {isSuperAdmin ? (
            <>
              <Button asChild variant="outline" size="sm" className="bg-neutral-600 hover:bg-neutral-500">
                <a href={OPS_TOOLS.find((tool) => tool.key === "prometheus")?.href ?? "/prometheus"} target="_blank" rel="noreferrer">
                  Open Prometheus
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="bg-neutral-600 hover:bg-neutral-500">
                <a href={OPS_TOOLS.find((tool) => tool.key === "headlamp")?.href ?? "/headlamp"} target="_blank" rel="noreferrer">
                  Open Headlamp
                </a>
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Controlled Reload Traces</CardTitle>
          <CardDescription>
            Requested versus applied state for reload-gated runtime domains. Use this for rollback context and
            acknowledgement visibility.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.reloads.map((reload) => (
            <div
              key={reload.domain}
              className="rounded-md border border-blue-700/30 bg-blue-950/20 p-3 text-xs text-blue-100/90"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{reload.domain}</span>
                <Badge variant={statusVariant(reload.status)}>Status: {reload.status}</Badge>
                <Badge variant="outline">Requested v{reload.requestedVersion}</Badge>
                <Badge variant="outline">Applied v{reload.lastAppliedVersion ?? "—"}</Badge>
                <Badge variant="outline">Scope: {reload.requiredScope}</Badge>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>Requested: {formatTimestamp(reload.requestedAt)}</div>
                <div>Last applied: {formatTimestamp(reload.lastAppliedAt)}</div>
                <div>Requested by: {reload.requestedBy ?? "—"}</div>
                <div>Acknowledgements: {reload.acknowledgements.length}</div>
              </div>
              {reload.acknowledgements.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {reload.acknowledgements.map((ack) => (
                    <Badge key={ack.actorId} variant={statusVariant(ack.status)}>
                      {ack.role}@{ack.nodeId} v{ack.version}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {reload.lastError ? <div className="mt-2 text-red-200">{reload.lastError}</div> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {data.sections.map((section) => (
          <Card key={section.id} className="bg-neutral-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Setting</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Manifest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.entries.map((entry) => (
                    <TableRow key={entry.key}>
                      <TableCell className="align-top">
                        <div className="font-medium text-white">{entry.label}</div>
                        {entry.notes ? <div className="mt-1 text-[11px] text-gray-400">{entry.notes}</div> : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="font-mono text-xs">{formatValue(entry.value)}</div>
                        {entry.secret ? (
                          <div className="mt-1 text-[11px] text-gray-400">
                            Secret readiness: {entry.secretConfigured ? "configured" : "missing"}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{entry.source}</Badge>
                          <Badge variant="outline">{entry.mutability}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="font-mono text-xs">{formatValue(entry.manifestValue)}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge
                            variant={statusVariant(
                              entry.alignedWithManifest
                                ? "aligned"
                                : entry.alignedWithManifest === false
                                  ? "failed"
                                  : "outline",
                            )}
                          >
                            {entry.alignedWithManifest === null
                              ? "No manifest compare"
                              : entry.alignedWithManifest
                                ? "Aligned"
                                : "Drift"}
                          </Badge>
                          {entry.manifestPath ? (
                            <span className="text-[11px] text-gray-400">{entry.manifestPath}</span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-neutral-700 border-gray-600">
        <CardHeader>
          <CardTitle className="text-base">Documentation Reconciliation</CardTitle>
          <CardDescription>
            Expected audit and operational documents that should still match the live control model.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Modified</TableHead>
                <TableHead>Live Checks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.documentation.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="align-top">
                    <div className="font-medium text-white">{doc.label}</div>
                    <div className="mt-1 text-[11px] text-gray-400">{doc.docPath}</div>
                    {doc.notes ? <div className="mt-1 text-[11px] text-gray-400">{doc.notes}</div> : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(doc.liveStatus)}>{doc.liveStatus}</Badge>
                      <Badge variant={doc.exists ? "outline" : "destructive"}>
                        {doc.exists ? "Present" : "Missing"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{formatTimestamp(doc.lastModifiedAt)}</TableCell>
                  <TableCell className="align-top text-xs text-gray-300">
                    {doc.liveChecks.length ? doc.liveChecks.join(" • ") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
