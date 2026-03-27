export type OpsToolKey = "grafana" | "prometheus" | "headlamp" | "minio-monitor" | "bull-board";

export type OpsTool = {
  key: OpsToolKey;
  name: string;
  href: string;
  purpose: string;
  requiredRole: "admin" | "superadmin";
  localAccess?: string | null;
};

export type GrafanaDashboardLink = {
  name: string;
  href: string;
  description: string;
};

export const OPS_TOOLS: OpsTool[] = [
  {
    key: "grafana",
    name: "Grafana",
    href: "/grafana",
    purpose: "Primary dashboards for metrics, traces, logs, and alerts.",
    requiredRole: "admin",
    localAccess: "kubectl port-forward -n tradehub svc/tradehub-grafana 3000:3000 then open http://127.0.0.1:3000/grafana",
  },
  {
    key: "prometheus",
    name: "Prometheus",
    href: "/prometheus",
    purpose: "Advanced raw query and target inspection UI.",
    requiredRole: "superadmin",
    localAccess: "kubectl port-forward -n tradehub svc/tradehub-prometheus 9090:9090 then open http://127.0.0.1:9090/",
  },
  {
    key: "headlamp",
    name: "Headlamp",
    href: "/headlamp",
    purpose: "Read-only Kubernetes resource inspection for the tradehub namespace.",
    requiredRole: "superadmin",
    localAccess: "kubectl port-forward -n tradehub svc/tradehub-headlamp 4466:4466 then open http://127.0.0.1:4466/",
  },
  {
    key: "minio-monitor",
    name: "MinIO Monitor",
    href: "/minio-monitor",
    purpose: "Storage health, buckets, and object-store monitoring UI.",
    requiredRole: "superadmin",
    localAccess: null,
  },
  {
    key: "bull-board",
    name: "Bull Board",
    href: "/api/admin/data-exports/queues",
    purpose: "Queue operations and admin export pipeline inspection.",
    requiredRole: "superadmin",
    localAccess: null,
  },
];

export const GRAFANA_DASHBOARDS: GrafanaDashboardLink[] = [
  {
    name: "TradeHub Ops Overview",
    href: "/grafana/d/tradehub-ops-overview",
    description: "Executive status view across app, queue, security, and infrastructure signals.",
  },
  {
    name: "HTTP Endpoint Observability",
    href: "/grafana/d/tradehub-http-observability",
    description: "Per-route request rate, latency, saturation, and error visibility.",
  },
  {
    name: "Business Flow Health",
    href: "/grafana/d/tradehub-business-flow-health",
    description: "Live flow-step outcomes and latency for critical user journeys.",
  },
  {
    name: "SLO / Burn Rate",
    href: "/grafana/d/tradehub-slo-burn-rate",
    description: "Latency and error burn-rate views for alerting and capacity response.",
  },
  {
    name: "App RED Metrics",
    href: "/grafana/d/tradehub-app-red",
    description: "Legacy/custom RED metrics and operational app panels.",
  },
  {
    name: "Security Events",
    href: "/grafana/d/tradehub-security",
    description: "Login failures, CSRF, bot controls, and security telemetry.",
  },
  {
    name: "Cache & Session Health",
    href: "/grafana/d/th-cache-health",
    description: "Valkey hit rate, evictions, and cache/session-layer visibility.",
  },
  {
    name: "Bare Metal Health",
    href: "/grafana/d/th-bare-metal",
    description: "Node CPU, memory, disk, and network resource health.",
  },
];

export function canAccessOpsTool(tool: OpsTool, isSuperAdmin: boolean): boolean {
  return tool.requiredRole === "admin" || isSuperAdmin;
}
