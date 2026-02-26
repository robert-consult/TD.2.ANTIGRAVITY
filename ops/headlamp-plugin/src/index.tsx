/**
 * TradeHub Petascale Ops — Headlamp Plugin
 *
 * Registers a "TradeHub Ops" sidebar section inside Headlamp with sub-pages
 * for every monitoring domain: Infrastructure, Export Pipeline, ClickHouse,
 * MinIO, Valkey, Security Events, and a Grafana deep-link hub.
 *
 * All views are read-only dashboards that query live K8s resource state via
 * the Headlamp plugin SDK (`K8s.ResourceClasses`).
 */

import {
    registerRoute,
    registerSidebarEntry,
    registerSidebarEntryFilter,
    registerOverviewChartsProcessor,
    K8s,
} from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, TileChart } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Paper, Typography, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Link, Grid, LinearProgress, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';

// ─── Constants ──────────────────────────────────────────────────────────────
const NAMESPACE = 'tradehub';
const GRAFANA_BASE = '/headlamp'; // Updated at deploy time via ConfigMap

// ─── Helpers ────────────────────────────────────────────────────────────────
function usePods(labelSelector?: string) {
    return K8s.ResourceClasses.Pod.useList({ namespace: NAMESPACE, labelSelector });
}

function useStatefulSets() {
    return K8s.ResourceClasses.StatefulSet.useList({ namespace: NAMESPACE });
}

function useDeployments() {
    return K8s.ResourceClasses.Deployment.useList({ namespace: NAMESPACE });
}

function useServices() {
    return K8s.ResourceClasses.Service.useList({ namespace: NAMESPACE });
}

function StatusChip({ ready }: { ready: boolean }) {
    return (
        <Chip
            label={ready ? 'Healthy' : 'Degraded'}
            color={ready ? 'success' : 'error'}
            size="small"
            variant="outlined"
        />
    );
}

function PodTable({ pods, error }: { pods: any[] | null; error: any }) {
    if (error) return <Alert severity="error">Failed to load pods: {String(error)}</Alert>;
    if (!pods) return <LinearProgress />;
    if (pods.length === 0) return <Typography color="text.secondary">No pods found.</Typography>;
    return (
        <TableContainer component={Paper} variant="outlined">
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell><strong>Pod</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                        <TableCell><strong>Restarts</strong></TableCell>
                        <TableCell><strong>Node</strong></TableCell>
                        <TableCell><strong>Age</strong></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {pods.map((pod: any) => {
                        const status = pod.status?.phase ?? 'Unknown';
                        const restarts = (pod.status?.containerStatuses ?? []).reduce(
                            (sum: number, cs: any) => sum + (cs.restartCount ?? 0),
                            0
                        );
                        const node = pod.spec?.nodeName ?? '—';
                        const created = pod.metadata?.creationTimestamp
                            ? timeAgo(new Date(pod.metadata.creationTimestamp))
                            : '—';
                        return (
                            <TableRow key={pod.metadata?.uid}>
                                <TableCell>{pod.metadata?.name}</TableCell>
                                <TableCell>
                                    <StatusChip ready={status === 'Running'} />
                                </TableCell>
                                <TableCell>{restarts}</TableCell>
                                <TableCell>{node}</TableCell>
                                <TableCell>{created}</TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

function timeAgo(date: Date): string {
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
}

function StatefulSetStatus({ name }: { name: string }) {
    const [sets, error] = useStatefulSets();
    if (error) return <Alert severity="error">Error: {String(error)}</Alert>;
    if (!sets) return <LinearProgress />;
    const ss = sets.find((s: any) => s.metadata?.name === name);
    if (!ss) return <Chip label="Not Deployed" color="default" size="small" />;
    const ready = ss.status?.readyReplicas ?? 0;
    const desired = ss.spec?.replicas ?? 0;
    return (
        <Box display="flex" alignItems="center" gap={1}>
            <StatusChip ready={ready >= desired && desired > 0} />
            <Typography variant="body2">{ready}/{desired} replicas</Typography>
        </Box>
    );
}

// ─── Sidebar Registration ───────────────────────────────────────────────────
// Top-level "TradeHub Ops" sidebar group
registerSidebarEntry({
    parent: null,
    name: 'tradehub-ops',
    label: 'TradeHub Ops',
    icon: 'mdi:monitor-dashboard',
    url: '/tradehub-ops',
});

// Sub-entries
const sidebarItems = [
    { name: 'tradehub-overview', label: 'Overview', url: '/tradehub-ops', icon: 'mdi:view-dashboard' },
    { name: 'tradehub-infra', label: 'Infrastructure', url: '/tradehub-ops/infrastructure', icon: 'mdi:server' },
    { name: 'tradehub-exports', label: 'Export Pipeline', url: '/tradehub-ops/exports', icon: 'mdi:export' },
    { name: 'tradehub-clickhouse', label: 'ClickHouse', url: '/tradehub-ops/clickhouse', icon: 'mdi:database' },
    { name: 'tradehub-minio', label: 'MinIO Storage', url: '/tradehub-ops/minio', icon: 'mdi:cloud-upload' },
    { name: 'tradehub-valkey', label: 'Valkey Cache', url: '/tradehub-ops/valkey', icon: 'mdi:memory' },
    { name: 'tradehub-security', label: 'Security Events', url: '/tradehub-ops/security', icon: 'mdi:shield-lock' },
    { name: 'tradehub-grafana', label: 'Grafana Links', url: '/tradehub-ops/grafana', icon: 'mdi:chart-line' },
];

sidebarItems.forEach(item => {
    registerSidebarEntry({ parent: 'tradehub-ops', ...item });
});

// ─── Overview Page ──────────────────────────────────────────────────────────
function OverviewPage() {
    const theme = useTheme();
    const [pods, podError] = usePods();
    const [deployments, depError] = useDeployments();

    const totalPods = pods?.length ?? 0;
    const runningPods = (pods ?? []).filter((p: any) => p.status?.phase === 'Running').length;
    const failedPods = (pods ?? []).filter((p: any) =>
        p.status?.phase === 'Failed' || p.status?.phase === 'Unknown'
    ).length;

    const totalDeploys = deployments?.length ?? 0;
    const healthyDeploys = (deployments ?? []).filter((d: any) => {
        const avail = d.status?.availableReplicas ?? 0;
        const desired = d.spec?.replicas ?? 0;
        return avail >= desired && desired > 0;
    }).length;

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>TradeHub Petascale Ops — Overview</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
                Namespace: <strong>{NAMESPACE}</strong> — Live K8s resource status
            </Typography>

            <Grid container spacing={2} sx={{ mt: 1, mb: 3 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <TileChart
                        title="Running Pods"
                        data={[{ name: 'running', value: runningPods, fill: theme.palette.success.main }]}
                        total={totalPods}
                        label={`${runningPods}/${totalPods}`}
                        legend="Pods in Running state"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <TileChart
                        title="Failed Pods"
                        data={[{ name: 'failed', value: failedPods, fill: theme.palette.error.main }]}
                        total={totalPods}
                        label={String(failedPods)}
                        legend="Pods in Failed/Unknown state"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <TileChart
                        title="Deployments"
                        data={[{ name: 'healthy', value: healthyDeploys, fill: theme.palette.info.main }]}
                        total={totalDeploys}
                        label={`${healthyDeploys}/${totalDeploys}`}
                        legend="Healthy deployments"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="subtitle2" color="text.secondary">Namespace</Typography>
                        <Typography variant="h4" color="primary">{NAMESPACE}</Typography>
                        <Typography variant="caption" color="text.secondary">Petascale Cluster</Typography>
                    </Paper>
                </Grid>
            </Grid>

            <SectionBox title="Petascale Services Status">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell><strong>Service</strong></TableCell>
                            <TableCell><strong>Status</strong></TableCell>
                            <TableCell><strong>Dashboard</strong></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        <TableRow>
                            <TableCell>ClickHouse OLAP</TableCell>
                            <TableCell><StatefulSetStatus name="tradehub-clickhouse" /></TableCell>
                            <TableCell><Link href="#/tradehub-ops/clickhouse">View →</Link></TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>MinIO Object Storage</TableCell>
                            <TableCell><StatefulSetStatus name="tradehub-minio" /></TableCell>
                            <TableCell><Link href="#/tradehub-ops/minio">View →</Link></TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>Valkey Cache</TableCell>
                            <TableCell><StatefulSetStatus name="tradehub-valkey" /></TableCell>
                            <TableCell><Link href="#/tradehub-ops/valkey">View →</Link></TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops',
    sidebar: 'tradehub-overview',
    name: 'tradehub-ops-overview',
    exact: true,
    component: () => <OverviewPage />,
});

// ─── Infrastructure Page ────────────────────────────────────────────────────
function InfrastructurePage() {
    const [allPods, podError] = usePods();
    const apiPods = (allPods ?? []).filter((p: any) => p.metadata?.labels?.role === 'api');
    const workerPods = (allPods ?? []).filter((p: any) => p.metadata?.labels?.role === 'worker');
    const ingestorPods = (allPods ?? []).filter((p: any) => p.metadata?.labels?.role === 'ingestor');

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>Infrastructure — Pods & Deployments</Typography>

            <SectionBox title={`API Pods (${apiPods.length})`}>
                <PodTable pods={apiPods} error={podError} />
            </SectionBox>

            <SectionBox title={`Worker Pods (${workerPods.length})`}>
                <PodTable pods={workerPods} error={podError} />
            </SectionBox>

            <SectionBox title={`Ingestor Pods (${ingestorPods.length})`}>
                <PodTable pods={ingestorPods} error={podError} />
            </SectionBox>

            <SectionBox title="All Namespace Pods">
                <PodTable pods={allPods} error={podError} />
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/infrastructure',
    sidebar: 'tradehub-infra',
    name: 'tradehub-ops-infra',
    exact: true,
    component: () => <InfrastructurePage />,
});

// ─── Export Pipeline Page ───────────────────────────────────────────────────
function ExportPipelinePage() {
    const [pods, podError] = usePods('role=worker');

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>Export & Analytics Pipeline</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
                BullMQ workers processing admin data exports, analytics rollups, and ClickHouse sync.
            </Typography>

            <SectionBox title="Worker Pods (BullMQ Consumers)">
                <PodTable pods={pods} error={podError} />
            </SectionBox>

            <SectionBox title="Key Metrics (via Prometheus)">
                <Alert severity="info" sx={{ mb: 2 }}>
                    Live queue metrics are available in the <strong>Export & Analytics Pipeline</strong> Grafana dashboard.
                </Alert>
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Metric</strong></TableCell>
                                <TableCell><strong>Description</strong></TableCell>
                                <TableCell><strong>Alert</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {[
                                ['admin_data_export_queue_waiting', 'Jobs waiting in BullMQ queue', 'ExportQueueStarvation'],
                                ['admin_data_export_jobs_completed_total', 'Total completed export jobs', '—'],
                                ['admin_data_export_jobs_failed_total', 'Total failed export jobs', 'ExportFailuresHigh'],
                                ['admin_data_export_bytes_written_total', 'Total bytes written to MinIO', 'SuspiciousExportVolume'],
                                ['admin_data_rollup_refresh_last_success_at', 'Last rollup refresh timestamp', 'RollupRefreshStale'],
                                ['clickhouse_sync_last_success_at', 'Last CH sync timestamp', 'ClickHouseSyncStale'],
                            ].map(([metric, desc, alert]) => (
                                <TableRow key={metric as string}>
                                    <TableCell><code>{metric}</code></TableCell>
                                    <TableCell>{desc}</TableCell>
                                    <TableCell>{alert === '—' ? '—' : <Chip label={alert as string} size="small" color="warning" variant="outlined" />}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/exports',
    sidebar: 'tradehub-exports',
    name: 'tradehub-ops-exports',
    exact: true,
    component: () => <ExportPipelinePage />,
});

// ─── ClickHouse Page ────────────────────────────────────────────────────────
function ClickHousePage() {
    const [pods, podError] = usePods('app=clickhouse');

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>ClickHouse OLAP Engine</Typography>

            <SectionBox title="StatefulSet Status">
                <StatefulSetStatus name="tradehub-clickhouse" />
            </SectionBox>

            <SectionBox title="ClickHouse Pods">
                <PodTable pods={pods} error={podError} />
            </SectionBox>

            <SectionBox title="Sync & Query Metrics">
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Metric</strong></TableCell>
                                <TableCell><strong>Description</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {[
                                ['clickhouse_sync_rows_synced_total', 'Total rows synced from Postgres'],
                                ['clickhouse_sync_last_success_at', 'Last successful sync timestamp'],
                                ['clickhouse_sync_running', 'Whether sync is currently active'],
                                ['ClickHouseProfileEvents_Query', 'Total queries executed'],
                                ['ClickHouseMetrics_QueryThread', 'Active query threads'],
                                ['ClickHouseAsyncMetrics_DiskUsed_default', 'Disk usage on default volume'],
                            ].map(([metric, desc]) => (
                                <TableRow key={metric}>
                                    <TableCell><code>{metric}</code></TableCell>
                                    <TableCell>{desc}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/clickhouse',
    sidebar: 'tradehub-clickhouse',
    name: 'tradehub-ops-clickhouse',
    exact: true,
    component: () => <ClickHousePage />,
});

// ─── MinIO Page ─────────────────────────────────────────────────────────────
function MinIOPage() {
    const [pods, podError] = usePods('app=minio');

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>MinIO Object Storage</Typography>

            <SectionBox title="StatefulSet Status">
                <StatefulSetStatus name="tradehub-minio" />
            </SectionBox>

            <SectionBox title="MinIO Pods">
                <PodTable pods={pods} error={podError} />
            </SectionBox>

            <SectionBox title="Storage Metrics">
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Metric</strong></TableCell>
                                <TableCell><strong>Description</strong></TableCell>
                                <TableCell><strong>Alert</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {[
                                ['minio_cluster_disk_free_bytes', 'Free disk space', 'MinIODiskFillForecast'],
                                ['minio_bucket_usage_total_bytes', 'Total bucket data size', '—'],
                                ['minio_s3_requests_total', 'Total S3 API requests', '—'],
                                ['minio_s3_errors_total', 'Total S3 API errors', '—'],
                            ].map(([metric, desc, alert]) => (
                                <TableRow key={metric}>
                                    <TableCell><code>{metric}</code></TableCell>
                                    <TableCell>{desc}</TableCell>
                                    <TableCell>{alert === '—' ? '—' : <Chip label={alert} size="small" color="warning" variant="outlined" />}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionBox>

            <Alert severity="info" sx={{ mt: 2 }}>
                Uploads use <code>X-Amz-Server-Side-Encryption: AES256</code> for at-rest encryption.
                KES key rotation status is monitored separately.
            </Alert>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/minio',
    sidebar: 'tradehub-minio',
    name: 'tradehub-ops-minio',
    exact: true,
    component: () => <MinIOPage />,
});

// ─── Valkey Page ────────────────────────────────────────────────────────────
function ValkeyPage() {
    const [pods, podError] = usePods('app=valkey');

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>Valkey Cache & Queue Transport</Typography>

            <SectionBox title="Valkey Pods">
                <PodTable pods={pods} error={podError} />
            </SectionBox>

            <SectionBox title="Cache & Queue Metrics">
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Metric</strong></TableCell>
                                <TableCell><strong>Description</strong></TableCell>
                                <TableCell><strong>Alert</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {[
                                ['redis_keyspace_hits_total', 'Cache hits', 'CacheHitRateDegraded'],
                                ['redis_keyspace_misses_total', 'Cache misses', '—'],
                                ['redis_connected_clients', 'Connected clients', '—'],
                                ['redis_used_memory_bytes', 'Memory usage', 'ValkeyMemoryPressure'],
                                ['redis_evicted_keys_total', 'Evicted keys', '—'],
                                ['redis_blocked_clients', 'Blocked clients (BullMQ)', '—'],
                            ].map(([metric, desc, alert]) => (
                                <TableRow key={metric}>
                                    <TableCell><code>{metric}</code></TableCell>
                                    <TableCell>{desc}</TableCell>
                                    <TableCell>{alert === '—' ? '—' : <Chip label={alert} size="small" color="warning" variant="outlined" />}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/valkey',
    sidebar: 'tradehub-valkey',
    name: 'tradehub-ops-valkey',
    exact: true,
    component: () => <ValkeyPage />,
});

// ─── Security Events Page ───────────────────────────────────────────────────
function SecurityPage() {
    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>Security Events & Monitoring</Typography>

            <SectionBox title="Active Security Alerts">
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Alert Rule</strong></TableCell>
                                <TableCell><strong>Condition</strong></TableCell>
                                <TableCell><strong>Severity</strong></TableCell>
                                <TableCell><strong>Runbook</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {[
                                ['BruteForceLoginAttempts', '>50 failed logins/s for 2m', 'critical', 'RUNBOOK_DDOS_DOS_RESPONSE.md'],
                                ['CSRFFailureSpike', '>10 CSRF 403s/s for 2m', 'warning', '—'],
                                ['SuspiciousExportVolume', '>500MB/s export rate for 5m', 'critical', 'RUNBOOK_DATA_EXFILTRATION.md'],
                            ].map(([name, condition, severity, runbook]) => (
                                <TableRow key={name}>
                                    <TableCell><strong>{name}</strong></TableCell>
                                    <TableCell>{condition}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={severity}
                                            color={severity === 'critical' ? 'error' : 'warning'}
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell>{runbook === '—' ? '—' : <code>{runbook}</code>}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionBox>

            <SectionBox title="Security Telemetry Metrics">
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell><strong>Metric</strong></TableCell>
                                <TableCell><strong>Source</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {[
                                ['login_attempts_total{result="failed"}', 'authCore.ts'],
                                ['login_attempts_total{result="success"}', 'authCore.ts'],
                                ['http_responses_total{status="403",reason="csrf"}', 'csrf.ts'],
                                ['bot_challenges_issued_total', 'botGuard.ts'],
                                ['admin_active_sessions', 'wsCore.ts'],
                            ].map(([metric, source]) => (
                                <TableRow key={metric}>
                                    <TableCell><code>{metric}</code></TableCell>
                                    <TableCell><code>{source}</code></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionBox>

            <SectionBox title="Threat Model Coverage">
                <Alert severity="success">
                    Full threat model documented in <code>ops/security/THREAT_MODEL.md</code> covering CSRF,
                    XSS, CSV Injection, SSRF, Data Exfiltration, DDoS, Brute Force, and Replay vectors.
                </Alert>
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/security',
    sidebar: 'tradehub-security',
    name: 'tradehub-ops-security',
    exact: true,
    component: () => <SecurityPage />,
});

// ─── Grafana Links Page ─────────────────────────────────────────────────────
function GrafanaLinksPage() {
    const dashboards = [
        { name: 'Bare Metal Health', file: 'bare-metal-health.json', desc: 'Node CPU, memory, disk, network metrics' },
        { name: 'Kubernetes Health', file: 'kubernetes-health.json', desc: 'Pod restarts, OOMKills, HPA status' },
        { name: 'App RED Metrics', file: 'app-red-metrics.json', desc: 'Route rate, errors, duration p50/p95/p99' },
        { name: 'Export Pipeline', file: 'export-analytics-pipeline.json', desc: 'Queue depth, job throughput, CH sync lag' },
        { name: 'Cache & Session', file: 'cache-session-health.json', desc: 'Valkey hit rate, memory, evictions' },
        { name: 'MinIO Storage', file: 'minio-storage.json', desc: 'Disk forecast, request rate, bucket growth' },
        { name: 'ClickHouse OLAP', file: 'clickhouse-olap.json', desc: 'Queries, merges, disk & memory usage' },
        { name: 'Security Events', file: 'security-events.json', desc: 'Login failures, CSRF, bot challenges' },
    ];

    return (
        <Box p={2}>
            <Typography variant="h5" gutterBottom>Grafana Dashboard Links</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
                All dashboards are auto-provisioned from <code>ops/dashboards/</code> into Grafana.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell><strong>Dashboard</strong></TableCell>
                            <TableCell><strong>Description</strong></TableCell>
                            <TableCell><strong>Source</strong></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {dashboards.map(d => (
                            <TableRow key={d.file}>
                                <TableCell><strong>{d.name}</strong></TableCell>
                                <TableCell>{d.desc}</TableCell>
                                <TableCell><code>ops/dashboards/{d.file}</code></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <SectionBox title="Alert Rule Files">
                <Table size="small">
                    <TableBody>
                        <TableRow>
                            <TableCell><code>ops/alerts/petascale-alerts.yaml</code></TableCell>
                            <TableCell>15 rules across Platform, Data, Infrastructure, Security teams</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell><code>ops/alerts/internal-tls-alerts.yaml</code></TableCell>
                            <TableCell>2 advisory TLS enforcement rules</TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </SectionBox>

            <SectionBox title="Runbooks">
                <Table size="small">
                    <TableBody>
                        {[
                            'RUNBOOK_EXPORT_PIPELINE_STALL.md',
                            'RUNBOOK_ANALYTICS_STALENESS.md',
                            'RUNBOOK_DDOS_DOS_RESPONSE.md',
                            'RUNBOOK_DATA_EXFILTRATION.md',
                            'RUNBOOK_CACHE_COLLAPSE.md',
                            'RUNBOOK_INTERNAL_TLS.md',
                        ].map(r => (
                            <TableRow key={r}>
                                <TableCell><code>ops/runbooks/{r}</code></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </SectionBox>
        </Box>
    );
}

registerRoute({
    path: '/tradehub-ops/grafana',
    sidebar: 'tradehub-grafana',
    name: 'tradehub-ops-grafana',
    exact: true,
    component: () => <GrafanaLinksPage />,
});

// ─── Overview Charts (injected into Headlamp overview) ──────────────────────
registerOverviewChartsProcessor({
    id: 'tradehub-pod-health',
    processor: charts => {
        return [
            ...charts,
            {
                id: 'tradehub-pod-health',
                component: () => <TradeHubPodHealthChart />,
            },
        ];
    },
});

function TradeHubPodHealthChart() {
    const [pods] = usePods();
    const theme = useTheme();
    const total = pods?.length ?? 0;
    const running = (pods ?? []).filter((p: any) => p.status?.phase === 'Running').length;
    const failed = total - running;

    return (
        <TileChart
            title="TradeHub Pods"
            data={[
                { name: 'running', value: running, fill: theme.palette.success.main },
                { name: 'other', value: failed, fill: theme.palette.error.main },
            ]}
            total={total}
            label={`${running}/${total}`}
            legend={`${running} running, ${failed} other`}
        />
    );
}

// Filter unnecessary default sidebar entries for focused ops view
registerSidebarEntryFilter(entry => {
    // Keep all entries — don't remove defaults so operators can still access built-in K8s views
    return entry;
});
