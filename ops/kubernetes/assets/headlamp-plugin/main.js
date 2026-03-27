/**
 * TradeHub Petascale Ops — Headlamp Plugin Bundle
 *
 * Built from ops/headlamp-plugin/src/index.tsx with repo-local esbuild shims
 * so the runtime uses Headlamp's browser globals instead of a stale CLI.
 */
(() => {
  // tradehub-headlamp-virtual:@kinvolk/headlamp-plugin/lib
  var pluginLib = window.pluginLib ?? {};
  var registerRoute = pluginLib.registerRoute;
  var registerSidebarEntry = pluginLib.registerSidebarEntry;
  var registerSidebarEntryFilter = pluginLib.registerSidebarEntryFilter;
  var registerOverviewChartsProcessor = pluginLib.registerOverviewChartsProcessor;
  var K8s = pluginLib.K8s;

  // tradehub-headlamp-virtual:@kinvolk/headlamp-plugin/lib/CommonComponents
  var commonComponents = window.pluginLib?.CommonComponents ?? {};
  var SectionBox = commonComponents.SectionBox;
  var TileChart = commonComponents.TileChart;

  // tradehub-headlamp-virtual:@mui/material
  var material = window.MUI ?? window.pluginLib?.MUI ?? {};
  var Alert = material.Alert;
  var Box = material.Box;
  var Chip = material.Chip;
  var Grid = material.Grid;
  var LinearProgress = material.LinearProgress;
  var Link = material.Link;
  var Paper = material.Paper;
  var Table = material.Table;
  var TableBody = material.TableBody;
  var TableCell = material.TableCell;
  var TableContainer = material.TableContainer;
  var TableHead = material.TableHead;
  var TableRow = material.TableRow;
  var Typography = material.Typography;

  // tradehub-headlamp-virtual:react
  var React = window.React ?? window.pluginLib?.React;
  var Fragment = React?.Fragment;
  var createElement = React?.createElement;
  var react_default = React;

  // src/index.tsx
  var NAMESPACE = "tradehub";
  var GRAFANA_BASE = "/grafana";
  var TILE_COLORS = {
    success: "#2e7d32",
    error: "#c62828",
    info: "#0288d1"
  };
  function usePods(labelSelector) {
    return K8s.ResourceClasses.Pod.useList({ namespace: NAMESPACE, labelSelector });
  }
  function useStatefulSets() {
    return K8s.ResourceClasses.StatefulSet.useList({ namespace: NAMESPACE });
  }
  function useDeployments() {
    return K8s.ResourceClasses.Deployment.useList({ namespace: NAMESPACE });
  }
  function StatusChip({ ready }) {
    return /* @__PURE__ */ react_default.createElement(
      Chip,
      {
        label: ready ? "Healthy" : "Degraded",
        color: ready ? "success" : "error",
        size: "small",
        variant: "outlined"
      }
    );
  }
  function PodTable({ pods, error }) {
    if (error) return /* @__PURE__ */ react_default.createElement(Alert, { severity: "error" }, "Failed to load pods: ", String(error));
    if (!pods) return /* @__PURE__ */ react_default.createElement(LinearProgress, null);
    if (pods.length === 0) return /* @__PURE__ */ react_default.createElement(Typography, { color: "text.secondary" }, "No pods found.");
    return /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Pod")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Status")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Restarts")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Node")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Age")))), /* @__PURE__ */ react_default.createElement(TableBody, null, pods.map((pod) => {
      const status = pod.status?.phase ?? "Unknown";
      const restarts = (pod.status?.containerStatuses ?? []).reduce(
        (sum, cs) => sum + (cs.restartCount ?? 0),
        0
      );
      const node = pod.spec?.nodeName ?? "\u2014";
      const created = pod.metadata?.creationTimestamp ? timeAgo(new Date(pod.metadata.creationTimestamp)) : "\u2014";
      return /* @__PURE__ */ react_default.createElement(TableRow, { key: pod.metadata?.uid }, /* @__PURE__ */ react_default.createElement(TableCell, null, pod.metadata?.name), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(StatusChip, { ready: status === "Running" })), /* @__PURE__ */ react_default.createElement(TableCell, null, restarts), /* @__PURE__ */ react_default.createElement(TableCell, null, node), /* @__PURE__ */ react_default.createElement(TableCell, null, created));
    }))));
  }
  function timeAgo(date) {
    const sec = Math.floor((Date.now() - date.getTime()) / 1e3);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }
  function StatefulSetStatus({ name }) {
    const [sets, error] = useStatefulSets();
    if (error) return /* @__PURE__ */ react_default.createElement(Alert, { severity: "error" }, "Error: ", String(error));
    if (!sets) return /* @__PURE__ */ react_default.createElement(LinearProgress, null);
    const ss = sets.find((s) => s.metadata?.name === name);
    if (!ss) return /* @__PURE__ */ react_default.createElement(Chip, { label: "Not Deployed", color: "default", size: "small" });
    const ready = ss.status?.readyReplicas ?? 0;
    const desired = ss.spec?.replicas ?? 0;
    return /* @__PURE__ */ react_default.createElement(Box, { display: "flex", alignItems: "center", gap: 1 }, /* @__PURE__ */ react_default.createElement(StatusChip, { ready: ready >= desired && desired > 0 }), /* @__PURE__ */ react_default.createElement(Typography, { variant: "body2" }, ready, "/", desired, " replicas"));
  }
  registerSidebarEntry({
    parent: null,
    name: "tradehub-ops",
    label: "TradeHub Ops",
    icon: "mdi:monitor-dashboard",
    url: "/tradehub-ops"
  });
  var sidebarItems = [
    { name: "tradehub-overview", label: "Overview", url: "/tradehub-ops", icon: "mdi:view-dashboard" },
    { name: "tradehub-infra", label: "Infrastructure", url: "/tradehub-ops/infrastructure", icon: "mdi:server" },
    { name: "tradehub-exports", label: "Export Pipeline", url: "/tradehub-ops/exports", icon: "mdi:export" },
    { name: "tradehub-clickhouse", label: "ClickHouse", url: "/tradehub-ops/clickhouse", icon: "mdi:database" },
    { name: "tradehub-minio", label: "MinIO Storage", url: "/tradehub-ops/minio", icon: "mdi:cloud-upload" },
    { name: "tradehub-valkey", label: "Valkey Cache", url: "/tradehub-ops/valkey", icon: "mdi:memory" },
    { name: "tradehub-security", label: "Security Events", url: "/tradehub-ops/security", icon: "mdi:shield-lock" },
    { name: "tradehub-grafana", label: "Grafana Links", url: "/tradehub-ops/grafana", icon: "mdi:chart-line" }
  ];
  sidebarItems.forEach((item) => {
    registerSidebarEntry({ parent: "tradehub-ops", ...item });
  });
  function OverviewPage() {
    const [pods, podError] = usePods();
    const [deployments, depError] = useDeployments();
    const totalPods = pods?.length ?? 0;
    const runningPods = (pods ?? []).filter((p) => p.status?.phase === "Running").length;
    const failedPods = (pods ?? []).filter(
      (p) => p.status?.phase === "Failed" || p.status?.phase === "Unknown"
    ).length;
    const totalDeploys = deployments?.length ?? 0;
    const healthyDeploys = (deployments ?? []).filter((d) => {
      const avail = d.status?.availableReplicas ?? 0;
      const desired = d.spec?.replicas ?? 0;
      return avail >= desired && desired > 0;
    }).length;
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "TradeHub Petascale Ops \u2014 Overview"), /* @__PURE__ */ react_default.createElement(Typography, { variant: "body2", color: "text.secondary", gutterBottom: true }, "Namespace: ", /* @__PURE__ */ react_default.createElement("strong", null, NAMESPACE), " \u2014 Live K8s resource status"), /* @__PURE__ */ react_default.createElement(Grid, { container: true, spacing: 2, sx: { mt: 1, mb: 3 } }, /* @__PURE__ */ react_default.createElement(Grid, { item: true, xs: 12, sm: 6, md: 3 }, /* @__PURE__ */ react_default.createElement(
      TileChart,
      {
        title: "Running Pods",
        data: [{ name: "running", value: runningPods, fill: TILE_COLORS.success }],
        total: totalPods,
        label: `${runningPods}/${totalPods}`,
        legend: "Pods in Running state"
      }
    )), /* @__PURE__ */ react_default.createElement(Grid, { item: true, xs: 12, sm: 6, md: 3 }, /* @__PURE__ */ react_default.createElement(
      TileChart,
      {
        title: "Failed Pods",
        data: [{ name: "failed", value: failedPods, fill: TILE_COLORS.error }],
        total: totalPods,
        label: String(failedPods),
        legend: "Pods in Failed/Unknown state"
      }
    )), /* @__PURE__ */ react_default.createElement(Grid, { item: true, xs: 12, sm: 6, md: 3 }, /* @__PURE__ */ react_default.createElement(
      TileChart,
      {
        title: "Deployments",
        data: [{ name: "healthy", value: healthyDeploys, fill: TILE_COLORS.info }],
        total: totalDeploys,
        label: `${healthyDeploys}/${totalDeploys}`,
        legend: "Healthy deployments"
      }
    )), /* @__PURE__ */ react_default.createElement(Grid, { item: true, xs: 12, sm: 6, md: 3 }, /* @__PURE__ */ react_default.createElement(Paper, { variant: "outlined", sx: { p: 2, textAlign: "center" } }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "subtitle2", color: "text.secondary" }, "Namespace"), /* @__PURE__ */ react_default.createElement(Typography, { variant: "h4", color: "primary" }, NAMESPACE), /* @__PURE__ */ react_default.createElement(Typography, { variant: "caption", color: "text.secondary" }, "Petascale Cluster")))), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Petascale Services Status" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Service")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Status")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Dashboard")))), /* @__PURE__ */ react_default.createElement(TableBody, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "ClickHouse OLAP"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(StatefulSetStatus, { name: "tradehub-clickhouse" })), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: "#/tradehub-ops/clickhouse" }, "View \u2192"))), /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "MinIO Object Storage"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(StatefulSetStatus, { name: "tradehub-minio" })), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: "#/tradehub-ops/minio" }, "View \u2192"))), /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "Valkey Cache"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(StatefulSetStatus, { name: "tradehub-valkey" })), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: "#/tradehub-ops/valkey" }, "View \u2192")))))));
  }
  registerRoute({
    path: "/tradehub-ops",
    sidebar: "tradehub-overview",
    name: "tradehub-ops-overview",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(OverviewPage, null)
  });
  function InfrastructurePage() {
    const [allPods, podError] = usePods();
    const apiPods = (allPods ?? []).filter((p) => p.metadata?.labels?.role === "api");
    const workerPods = (allPods ?? []).filter((p) => p.metadata?.labels?.role === "worker");
    const ingestorPods = (allPods ?? []).filter((p) => p.metadata?.labels?.role === "ingestor");
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "Infrastructure \u2014 Pods & Deployments"), /* @__PURE__ */ react_default.createElement(SectionBox, { title: `API Pods (${apiPods.length})` }, /* @__PURE__ */ react_default.createElement(PodTable, { pods: apiPods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: `Worker Pods (${workerPods.length})` }, /* @__PURE__ */ react_default.createElement(PodTable, { pods: workerPods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: `Ingestor Pods (${ingestorPods.length})` }, /* @__PURE__ */ react_default.createElement(PodTable, { pods: ingestorPods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "All Namespace Pods" }, /* @__PURE__ */ react_default.createElement(PodTable, { pods: allPods, error: podError })));
  }
  registerRoute({
    path: "/tradehub-ops/infrastructure",
    sidebar: "tradehub-infra",
    name: "tradehub-ops-infra",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(InfrastructurePage, null)
  });
  function ExportPipelinePage() {
    const [pods, podError] = usePods("role=worker");
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "Export & Analytics Pipeline"), /* @__PURE__ */ react_default.createElement(Typography, { variant: "body2", color: "text.secondary", gutterBottom: true }, "BullMQ workers processing admin data exports, analytics rollups, and ClickHouse sync."), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Worker Pods (BullMQ Consumers)" }, /* @__PURE__ */ react_default.createElement(PodTable, { pods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Key Metrics (via Prometheus)" }, /* @__PURE__ */ react_default.createElement(Alert, { severity: "info", sx: { mb: 2 } }, "Live queue metrics are available in the ", /* @__PURE__ */ react_default.createElement("strong", null, "Export & Analytics Pipeline"), " Grafana dashboard."), /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Metric")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Description")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Alert")))), /* @__PURE__ */ react_default.createElement(TableBody, null, [
      ["admin_data_export_queue_waiting", "Jobs waiting in BullMQ queue", "ExportQueueStarvation"],
      ["admin_data_export_jobs_completed_total", "Total completed export jobs", "\u2014"],
      ["admin_data_export_jobs_failed_total", "Total failed export jobs", "ExportFailuresHigh"],
      ["admin_data_export_bytes_written_total", "Total bytes written to MinIO", "SuspiciousExportVolume"],
      ["admin_data_rollup_refresh_last_success_at", "Last rollup refresh timestamp", "RollupRefreshStale"],
      ["clickhouse_sync_last_success_at", "Last CH sync timestamp", "ClickHouseSyncStale"]
    ].map(([metric, desc, alert]) => /* @__PURE__ */ react_default.createElement(TableRow, { key: metric }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, metric)), /* @__PURE__ */ react_default.createElement(TableCell, null, desc), /* @__PURE__ */ react_default.createElement(TableCell, null, alert === "\u2014" ? "\u2014" : /* @__PURE__ */ react_default.createElement(Chip, { label: alert, size: "small", color: "warning", variant: "outlined" })))))))));
  }
  registerRoute({
    path: "/tradehub-ops/exports",
    sidebar: "tradehub-exports",
    name: "tradehub-ops-exports",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(ExportPipelinePage, null)
  });
  function ClickHousePage() {
    const [pods, podError] = usePods("app=clickhouse");
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "ClickHouse OLAP Engine"), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "StatefulSet Status" }, /* @__PURE__ */ react_default.createElement(StatefulSetStatus, { name: "tradehub-clickhouse" })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "ClickHouse Pods" }, /* @__PURE__ */ react_default.createElement(PodTable, { pods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Sync & Query Metrics" }, /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Metric")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Description")))), /* @__PURE__ */ react_default.createElement(TableBody, null, [
      ["clickhouse_sync_rows_synced_total", "Total rows synced from Postgres"],
      ["clickhouse_sync_last_success_at", "Last successful sync timestamp"],
      ["clickhouse_sync_running", "Whether sync is currently active"],
      ["ClickHouseProfileEvents_Query", "Total queries executed"],
      ["ClickHouseMetrics_QueryThread", "Active query threads"],
      ["ClickHouseAsyncMetrics_DiskUsed_default", "Disk usage on default volume"]
    ].map(([metric, desc]) => /* @__PURE__ */ react_default.createElement(TableRow, { key: metric }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, metric)), /* @__PURE__ */ react_default.createElement(TableCell, null, desc))))))));
  }
  registerRoute({
    path: "/tradehub-ops/clickhouse",
    sidebar: "tradehub-clickhouse",
    name: "tradehub-ops-clickhouse",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(ClickHousePage, null)
  });
  function MinIOPage() {
    const [pods, podError] = usePods("app=minio");
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "MinIO Object Storage"), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "StatefulSet Status" }, /* @__PURE__ */ react_default.createElement(StatefulSetStatus, { name: "tradehub-minio" })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "MinIO Pods" }, /* @__PURE__ */ react_default.createElement(PodTable, { pods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Storage Metrics" }, /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Metric")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Description")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Alert")))), /* @__PURE__ */ react_default.createElement(TableBody, null, [
      ["minio_cluster_disk_free_bytes", "Free disk space", "MinIODiskFillForecast"],
      ["minio_bucket_usage_total_bytes", "Total bucket data size", "\u2014"],
      ["minio_s3_requests_total", "Total S3 API requests", "\u2014"],
      ["minio_s3_errors_total", "Total S3 API errors", "\u2014"]
    ].map(([metric, desc, alert]) => /* @__PURE__ */ react_default.createElement(TableRow, { key: metric }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, metric)), /* @__PURE__ */ react_default.createElement(TableCell, null, desc), /* @__PURE__ */ react_default.createElement(TableCell, null, alert === "\u2014" ? "\u2014" : /* @__PURE__ */ react_default.createElement(Chip, { label: alert, size: "small", color: "warning", variant: "outlined" })))))))), /* @__PURE__ */ react_default.createElement(Alert, { severity: "info", sx: { mt: 2 } }, "Uploads use ", /* @__PURE__ */ react_default.createElement("code", null, "X-Amz-Server-Side-Encryption: AES256"), " for at-rest encryption. KES key rotation status is monitored separately."));
  }
  registerRoute({
    path: "/tradehub-ops/minio",
    sidebar: "tradehub-minio",
    name: "tradehub-ops-minio",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(MinIOPage, null)
  });
  function ValkeyPage() {
    const [pods, podError] = usePods("app=valkey");
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "Valkey Cache & Queue Transport"), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Valkey Pods" }, /* @__PURE__ */ react_default.createElement(PodTable, { pods, error: podError })), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Cache & Queue Metrics" }, /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Metric")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Description")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Alert")))), /* @__PURE__ */ react_default.createElement(TableBody, null, [
      ["redis_keyspace_hits_total", "Cache hits", "CacheHitRateDegraded"],
      ["redis_keyspace_misses_total", "Cache misses", "\u2014"],
      ["redis_connected_clients", "Connected clients", "\u2014"],
      ["redis_used_memory_bytes", "Memory usage", "ValkeyMemoryPressure"],
      ["redis_evicted_keys_total", "Evicted keys", "\u2014"],
      ["redis_blocked_clients", "Blocked clients (BullMQ)", "\u2014"]
    ].map(([metric, desc, alert]) => /* @__PURE__ */ react_default.createElement(TableRow, { key: metric }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, metric)), /* @__PURE__ */ react_default.createElement(TableCell, null, desc), /* @__PURE__ */ react_default.createElement(TableCell, null, alert === "\u2014" ? "\u2014" : /* @__PURE__ */ react_default.createElement(Chip, { label: alert, size: "small", color: "warning", variant: "outlined" })))))))));
  }
  registerRoute({
    path: "/tradehub-ops/valkey",
    sidebar: "tradehub-valkey",
    name: "tradehub-ops-valkey",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(ValkeyPage, null)
  });
  function SecurityPage() {
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "Security Events & Monitoring"), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Active Security Alerts" }, /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Alert Rule")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Condition")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Severity")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Runbook")))), /* @__PURE__ */ react_default.createElement(TableBody, null, [
      ["BruteForceLoginAttempts", ">50 failed logins/s for 2m", "critical", "RUNBOOK_DDOS_DOS_RESPONSE.md"],
      ["CSRFFailureSpike", ">10 CSRF 403s/s for 2m", "warning", "\u2014"],
      ["SuspiciousExportVolume", ">500MB/s export rate for 5m", "critical", "RUNBOOK_DATA_EXFILTRATION.md"]
    ].map(([name, condition, severity, runbook]) => /* @__PURE__ */ react_default.createElement(TableRow, { key: name }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, name)), /* @__PURE__ */ react_default.createElement(TableCell, null, condition), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(
      Chip,
      {
        label: severity,
        color: severity === "critical" ? "error" : "warning",
        size: "small"
      }
    )), /* @__PURE__ */ react_default.createElement(TableCell, null, runbook === "\u2014" ? "\u2014" : /* @__PURE__ */ react_default.createElement("code", null, runbook)))))))), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Security Telemetry Metrics" }, /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Metric")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Source")))), /* @__PURE__ */ react_default.createElement(TableBody, null, [
      ['login_attempts_total{result="failed"}', "authCore.ts"],
      ['login_attempts_total{result="success"}', "authCore.ts"],
      ['http_responses_total{status="403",reason="csrf"}', "csrf.ts"],
      ["bot_challenges_issued_total", "botGuard.ts"],
      ["admin_active_sessions", "wsCore.ts"]
    ].map(([metric, source]) => /* @__PURE__ */ react_default.createElement(TableRow, { key: metric }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, metric)), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, source)))))))), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Threat Model Coverage" }, /* @__PURE__ */ react_default.createElement(Alert, { severity: "success" }, "Full threat model documented in ", /* @__PURE__ */ react_default.createElement("code", null, "ops/security/THREAT_MODEL.md"), " covering CSRF, XSS, CSV Injection, SSRF, Data Exfiltration, DDoS, Brute Force, and Replay vectors.")));
  }
  registerRoute({
    path: "/tradehub-ops/security",
    sidebar: "tradehub-security",
    name: "tradehub-ops-security",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(SecurityPage, null)
  });
  function GrafanaLinksPage() {
    const dashboards = [
      { name: "TradeHub Ops Overview", file: "ops-overview.json", uid: "tradehub-ops-overview", desc: "Executive status view across the core platform signals" },
      { name: "HTTP Endpoint Observability", file: "http-endpoint-observability.json", uid: "tradehub-http-observability", desc: "Per-route latency, rate, and error visibility" },
      { name: "Business Flow Health", file: "business-flow-health.json", uid: "tradehub-business-flow-health", desc: "Critical live business-flow success/failure views" },
      { name: "SLO / Burn Rate", file: "slo-burn-rate.json", uid: "tradehub-slo-burn-rate", desc: "Burn-rate and latency alerting dashboards" },
      { name: "App RED Metrics", file: "app-red-metrics.json", uid: "tradehub-app-red", desc: "Legacy/custom RED panels for the application" },
      { name: "Cache & Session", file: "cache-session-health.json", uid: "th-cache-health", desc: "Valkey hit rate, memory, and evictions" },
      { name: "Bare Metal Health", file: "bare-metal-health.json", uid: "th-bare-metal", desc: "Node CPU, memory, disk, and network metrics" },
      { name: "Security Events", file: "security-events.json", uid: "tradehub-security", desc: "Login failures, CSRF, bot challenges, and security telemetry" }
    ];
    return /* @__PURE__ */ react_default.createElement(Box, { p: 2 }, /* @__PURE__ */ react_default.createElement(Typography, { variant: "h5", gutterBottom: true }, "Grafana Dashboard Links"), /* @__PURE__ */ react_default.createElement(Typography, { variant: "body2", color: "text.secondary", gutterBottom: true }, "All dashboards are auto-provisioned from ", /* @__PURE__ */ react_default.createElement("code", null, "ops/dashboards/"), " into Grafana."), /* @__PURE__ */ react_default.createElement(TableContainer, { component: Paper, variant: "outlined", sx: { mt: 2 } }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableHead, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Dashboard")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Description")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Source")), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, "Access")))), /* @__PURE__ */ react_default.createElement(TableBody, null, dashboards.map((d) => /* @__PURE__ */ react_default.createElement(TableRow, { key: d.file }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("strong", null, d.name)), /* @__PURE__ */ react_default.createElement(TableCell, null, d.desc), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, "ops/dashboards/", d.file)), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: `${GRAFANA_BASE}/d/${d.uid}`, target: "_blank", rel: "noreferrer" }, "Open \u2192"))))))), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Direct Tool Links" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableBody, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "Grafana Root"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: GRAFANA_BASE, target: "_blank", rel: "noreferrer" }, GRAFANA_BASE))), /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "Prometheus"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: "/prometheus", target: "_blank", rel: "noreferrer" }, "/prometheus"))), /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "Bull Board"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: "/api/admin/data-exports/queues", target: "_blank", rel: "noreferrer" }, "/api/admin/data-exports/queues"))), /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, "MinIO Monitor"), /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement(Link, { href: "/minio-monitor", target: "_blank", rel: "noreferrer" }, "/minio-monitor")))))), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Alert Rule Files" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableBody, null, /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, "ops/alerts/petascale-alerts.yaml")), /* @__PURE__ */ react_default.createElement(TableCell, null, "15 rules across Platform, Data, Infrastructure, Security teams")), /* @__PURE__ */ react_default.createElement(TableRow, null, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, "ops/alerts/internal-tls-alerts.yaml")), /* @__PURE__ */ react_default.createElement(TableCell, null, "2 advisory TLS enforcement rules"))))), /* @__PURE__ */ react_default.createElement(SectionBox, { title: "Runbooks" }, /* @__PURE__ */ react_default.createElement(Table, { size: "small" }, /* @__PURE__ */ react_default.createElement(TableBody, null, [
      "RUNBOOK_EXPORT_PIPELINE_STALL.md",
      "RUNBOOK_ANALYTICS_STALENESS.md",
      "RUNBOOK_DDOS_DOS_RESPONSE.md",
      "RUNBOOK_DATA_EXFILTRATION.md",
      "RUNBOOK_CACHE_COLLAPSE.md",
      "RUNBOOK_INTERNAL_TLS.md"
    ].map((r) => /* @__PURE__ */ react_default.createElement(TableRow, { key: r }, /* @__PURE__ */ react_default.createElement(TableCell, null, /* @__PURE__ */ react_default.createElement("code", null, "ops/runbooks/", r))))))));
  }
  registerRoute({
    path: "/tradehub-ops/grafana",
    sidebar: "tradehub-grafana",
    name: "tradehub-ops-grafana",
    exact: true,
    component: () => /* @__PURE__ */ react_default.createElement(GrafanaLinksPage, null)
  });
  registerOverviewChartsProcessor({
    id: "tradehub-pod-health",
    processor: (charts) => {
      return [
        ...charts,
        {
          id: "tradehub-pod-health",
          component: () => /* @__PURE__ */ react_default.createElement(TradeHubPodHealthChart, null)
        }
      ];
    }
  });
  function TradeHubPodHealthChart() {
    const [pods] = usePods();
    const total = pods?.length ?? 0;
    const running = (pods ?? []).filter((p) => p.status?.phase === "Running").length;
    const failed = total - running;
    return /* @__PURE__ */ react_default.createElement(
      TileChart,
      {
        title: "TradeHub Pods",
        data: [
          { name: "running", value: running, fill: TILE_COLORS.success },
          { name: "other", value: failed, fill: TILE_COLORS.error }
        ],
        total,
        label: `${running}/${total}`,
        legend: `${running} running, ${failed} other`
      }
    );
  }
  registerSidebarEntryFilter((entry) => {
    return entry;
  });
})();
