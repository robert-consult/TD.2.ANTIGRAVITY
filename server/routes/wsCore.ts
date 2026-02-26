// @ts-nocheck
import type { Express, Request } from "express";
import type { Store } from "express-session";
import type { Server } from "http";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import cookie from "cookie";
import signature from "cookie-signature";
import { eq } from "drizzle-orm";
import { db } from "@db";
import { globalSettings, users } from "@shared/schema";
import { applyQuoteUpdate, getQuoteMeta } from "../services/quoteHub";
import { getProviderRateLimitStats } from "../marketdata/rateLimit";
import { getMessagingMetrics } from "../services/messaging";
import { getAdminExportMetricsSnapshot } from "../services/adminDataExportMetrics";
import { getAdminDataRollupMetricsSnapshot } from "../services/adminDataRollups";
import { getClickHouseSyncMetricsSnapshot } from "../services/clickhouseSync";
import { getAllowedSymbolsForUser } from "../services/quoteSubscriptions";
import {
  buildGeoContext,
  extractGeoHints,
  getClientIp,
  getUserAgent,
  revokeSession,
} from "../security/sessionTrail";
import { evaluateLoginJurisdiction } from "../policy/jurisdictionControl";
import { getTrustedProxyCountryIso2 } from "../security/proxyHeaders";
import { onLiveEvent } from "../services/liveBus";
import { appendIdentityAudit } from "../services/identityAudit";
import { IMPERSONATION_TTL_MS } from "../middleware/auth";
import { buildQuoteSnapshotResponse } from "./quotesCore";
import {
  WS_MSG_ACCOUNT_SNAPSHOT,
  WS_MSG_ACCOUNT_SUBSCRIBE,
  WS_MSG_ACCOUNT_UNSUBSCRIBE,
  WS_MSG_ACCOUNT_UPDATE,
  WS_MSG_ACCOUNT_UPDATED,
  WS_MSG_AUTH_HELLO,
  WS_MSG_AUTH_OK,
  WS_MSG_ERROR,
  WS_MSG_PING,
  WS_MSG_PONG,
  WS_MSG_QUOTES_SNAPSHOT,
  WS_MSG_QUOTES_SUBSCRIBE,
  WS_MSG_QUOTES_UNSUBSCRIBE,
  WS_MSG_QUOTES_UPDATE,
  WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED,
  WS_MSG_TRADES_SUBSCRIBE,
  WS_MSG_TRADES_UNSUBSCRIBE,
  WS_MSG_TRADES_UPDATE,
  WS_MSG_TRADES_UPDATED,
  WS_PROTOCOL_VERSION,
} from "@shared/ws/protocol";
import {
  addWsQuotePermissionRefreshErrorsTotal,
  addWsQuotePermissionRefreshTotal,
  getRouteMetricSnapshot,
  incWsMessageRateLimitedTotal,
  incWsOriginRejectedTotal,
  incWsUserConnectionLimitRejectedTotal,
} from "./metricsState";
import { isPrivateOrLoopbackIp } from "@shared/security/requestIdentity";

export type LiveClient = WebSocket & {
  userId?: number;
  sessionId?: string;
  isAdmin?: boolean;
  isImpersonating?: boolean;
  realAdminId?: number;
  impersonationStartedAtMs?: number;
  sessionEmail?: string;
  impersonationTtlCloseIssued?: boolean;
  clientIp?: string;
  clientUserAgent?: string;
  wsOrigin?: string | null;
  ipCountryIso2?: string;
  userCountryIso2?: string;
  allowedQuoteSymbols?: Set<string>;
  quoteSymbols?: Set<string>;
  wantsQuotesAll?: boolean;
  quoteKey?: string;
  wantsTrades?: boolean;
  wantsAccount?: boolean;
  wsMsgWindowStartMs?: number;
  wsMsgCount?: number;
};

export type WsBroadcast = (event: any, filter?: (client: LiveClient) => boolean) => void;

interface WsCoreDeps {
  sessionStore: Store;
  sessionCookieName: string;
  sessionSecret: string;
}

export function registerWsCore(app: Express, deps: WsCoreDeps): { httpServer: Server; broadcast: WsBroadcast } {
  const { sessionStore, sessionCookieName, sessionSecret } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
  const SESSION_SECRET = sessionSecret;

// Create HTTP server
const httpServer = createServer(app);

const wsMaxPayloadBytes = Math.max(
  1024,
  Math.min(1_048_576, Math.trunc(Number(process.env.WS_MAX_MESSAGE_BYTES ?? 65_536) || 65_536)),
);

// --- Internal WebSocket server for live updates (quotes + trades) ---
const wss = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  maxPayload: wsMaxPayloadBytes,
});

function wsEnvFlagEnabled(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const metricsRequirePrivateAccess = wsEnvFlagEnabled(
  process.env.METRICS_REQUIRE_PRIVATE,
  process.env.NODE_ENV === "production",
);
const metricsAuthToken = String(process.env.METRICS_AUTH_TOKEN ?? "").trim();

function hasValidMetricsToken(req: Request): boolean {
  if (!metricsAuthToken) return false;
  const rawAuth = String(req.headers.authorization ?? "").trim();
  if (rawAuth.toLowerCase().startsWith("bearer ")) {
    const presented = rawAuth.slice("Bearer ".length).trim();
    if (presented === metricsAuthToken) return true;
  }
  const headerToken = String(req.headers["x-metrics-token"] ?? "").trim();
  return Boolean(headerToken && headerToken === metricsAuthToken);
}

function canAccessMetrics(req: Request): boolean {
  if (hasValidMetricsToken(req)) return true;
  if (!metricsRequirePrivateAccess) return true;
  const clientIp = getClientIp(req as any);
  return Boolean(clientIp && isPrivateOrLoopbackIp(clientIp));
}

app.get("/metrics", (req, res) => {
  if (!canAccessMetrics(req)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const quoteMeta = getQuoteMeta();
  const wsCount = wss.clients ? wss.clients.size : 0;
  const providerRateStats = getProviderRateLimitStats();
  const messagingMetrics = getMessagingMetrics();
  const exportMetrics = getAdminExportMetricsSnapshot();
  const rollupMetrics = getAdminDataRollupMetricsSnapshot();
  const clickhouseSyncMetrics = getClickHouseSyncMetricsSnapshot();
  const metricSnapshot = getRouteMetricSnapshot();
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(
    [
      "# HELP ws_active_connections Number of active websocket connections",
      "# TYPE ws_active_connections gauge",
      `ws_active_connections ${wsCount}`,
      "# HELP quotehub_size Number of quotes held in memory",
      "# TYPE quotehub_size gauge",
      `quotehub_size ${quoteMeta.size}`,
      "# HELP quotehub_seq Latest quote sequence number",
      "# TYPE quotehub_seq gauge",
      `quotehub_seq ${quoteMeta.seq}`,
      "# HELP quotehub_asof Latest quote snapshot timestamp (ms)",
      "# TYPE quotehub_asof gauge",
      `quotehub_asof ${quoteMeta.asOf}`,
      "# HELP marketdata_provider_ratelimit_queue_length Queued provider HTTP requests (rate limiter)",
      "# TYPE marketdata_provider_ratelimit_queue_length gauge",
      ...providerRateStats.map(
        (s) => `marketdata_provider_ratelimit_queue_length{provider_key="${s.providerKey}"} ${s.queueLength}`,
      ),
      "# HELP marketdata_provider_ratelimit_active In-flight provider HTTP requests (rate limiter)",
      "# TYPE marketdata_provider_ratelimit_active gauge",
      ...providerRateStats.map(
        (s) => `marketdata_provider_ratelimit_active{provider_key="${s.providerKey}"} ${s.active}`,
      ),
      "# HELP marketdata_provider_ratelimit_rejected_total Provider requests rejected due to full queue",
      "# TYPE marketdata_provider_ratelimit_rejected_total counter",
      ...providerRateStats.map(
        (s) => `marketdata_provider_ratelimit_rejected_total{provider_key="${s.providerKey}"} ${s.rejectedQueueFullTotal}`,
      ),
      "# HELP marketdata_provider_ratelimit_started_total Provider requests started (rate limiter)",
      "# TYPE marketdata_provider_ratelimit_started_total counter",
      ...providerRateStats.map(
        (s) => `marketdata_provider_ratelimit_started_total{provider_key="${s.providerKey}"} ${s.startedTotal}`,
      ),
      "# HELP trade_close_rejected_quote_stale_total Manual close requests rejected due to stale quotes",
      "# TYPE trade_close_rejected_quote_stale_total counter",
      `trade_close_rejected_quote_stale_total ${metricSnapshot.metricTradeCloseRejectedQuoteStaleTotal}`,
      "# HELP trade_targets_rejected_quote_stale_total Target update requests rejected due to stale quotes (market open)",
      "# TYPE trade_targets_rejected_quote_stale_total counter",
      `trade_targets_rejected_quote_stale_total ${metricSnapshot.metricTradeTargetsRejectedQuoteStaleTotal}`,
      "# HELP trade_open_rejected_quote_revalidation_total Trade open requests rejected due to quote commit revalidation failure",
      "# TYPE trade_open_rejected_quote_revalidation_total counter",
      `trade_open_rejected_quote_revalidation_total ${metricSnapshot.metricTradeOpenRejectedQuoteRevalidationTotal}`,
      "# HELP trade_close_rejected_quote_revalidation_total Trade close requests rejected due to quote commit revalidation failure",
      "# TYPE trade_close_rejected_quote_revalidation_total counter",
      `trade_close_rejected_quote_revalidation_total ${metricSnapshot.metricTradeCloseRejectedQuoteRevalidationTotal}`,
      "# HELP ws_quote_permission_refresh_total WebSocket clients whose quote permissions were recalculated",
      "# TYPE ws_quote_permission_refresh_total counter",
      `ws_quote_permission_refresh_total ${metricSnapshot.metricWsQuotePermissionRefreshTotal}`,
      "# HELP ws_quote_permission_refresh_errors_total WebSocket quote-permission refresh failures",
      "# TYPE ws_quote_permission_refresh_errors_total counter",
      `ws_quote_permission_refresh_errors_total ${metricSnapshot.metricWsQuotePermissionRefreshErrorsTotal}`,
      "# HELP ws_origin_rejected_total WebSocket connection attempts rejected by origin validation",
      "# TYPE ws_origin_rejected_total counter",
      `ws_origin_rejected_total ${metricSnapshot.metricWsOriginRejectedTotal}`,
      "# HELP ws_user_connection_limit_rejected_total WebSocket connections rejected due to per-user connection cap",
      "# TYPE ws_user_connection_limit_rejected_total counter",
      `ws_user_connection_limit_rejected_total ${metricSnapshot.metricWsUserConnectionLimitRejectedTotal}`,
      "# HELP ws_message_rate_limited_total WebSocket connections closed for message-rate abuse",
      "# TYPE ws_message_rate_limited_total counter",
      `ws_message_rate_limited_total ${metricSnapshot.metricWsMessageRateLimitedTotal}`,
      "# HELP mailbox_fanout_queue_depth Pending mailbox fanout jobs",
      "# TYPE mailbox_fanout_queue_depth gauge",
      `mailbox_fanout_queue_depth ${messagingMetrics.mailboxFanoutQueueDepth}`,
      "# HELP mailbox_fanout_running Whether mailbox fanout worker is currently running",
      "# TYPE mailbox_fanout_running gauge",
      `mailbox_fanout_running ${messagingMetrics.mailboxFanoutRunning}`,
      "# HELP mailbox_fanout_enqueued_total Total mailbox recipients enqueued for async fanout",
      "# TYPE mailbox_fanout_enqueued_total counter",
      `mailbox_fanout_enqueued_total ${messagingMetrics.mailboxFanoutEnqueuedTotal}`,
      "# HELP mailbox_fanout_processed_total Total mailbox recipients processed by async fanout",
      "# TYPE mailbox_fanout_processed_total counter",
      `mailbox_fanout_processed_total ${messagingMetrics.mailboxFanoutProcessedTotal}`,
      "# HELP mailbox_fanout_failed_total Total mailbox recipients that failed async fanout processing",
      "# TYPE mailbox_fanout_failed_total counter",
      `mailbox_fanout_failed_total ${messagingMetrics.mailboxFanoutFailedTotal}`,
      "# HELP admin_data_export_jobs_created_total Admin data export jobs created",
      "# TYPE admin_data_export_jobs_created_total counter",
      `admin_data_export_jobs_created_total ${exportMetrics.createdTotal}`,
      "# HELP admin_data_export_jobs_deduped_total Admin data export jobs deduped to existing jobs",
      "# TYPE admin_data_export_jobs_deduped_total counter",
      `admin_data_export_jobs_deduped_total ${exportMetrics.dedupedTotal}`,
      "# HELP admin_data_export_jobs_started_total Admin data export jobs started",
      "# TYPE admin_data_export_jobs_started_total counter",
      `admin_data_export_jobs_started_total ${exportMetrics.startedTotal}`,
      "# HELP admin_data_export_jobs_succeeded_total Admin data export jobs completed successfully",
      "# TYPE admin_data_export_jobs_succeeded_total counter",
      `admin_data_export_jobs_succeeded_total ${exportMetrics.succeededTotal}`,
      "# HELP admin_data_export_jobs_failed_total Admin data export jobs failed",
      "# TYPE admin_data_export_jobs_failed_total counter",
      `admin_data_export_jobs_failed_total ${exportMetrics.failedTotal}`,
      "# HELP admin_data_export_jobs_canceled_total Admin data export jobs canceled",
      "# TYPE admin_data_export_jobs_canceled_total counter",
      `admin_data_export_jobs_canceled_total ${exportMetrics.canceledTotal}`,
      "# HELP admin_data_export_jobs_expired_total Admin data export jobs expired",
      "# TYPE admin_data_export_jobs_expired_total counter",
      `admin_data_export_jobs_expired_total ${exportMetrics.expiredTotal}`,
      "# HELP admin_data_export_jobs_running Active admin data export jobs",
      "# TYPE admin_data_export_jobs_running gauge",
      `admin_data_export_jobs_running ${exportMetrics.runningGauge}`,
      "# HELP admin_data_export_queue_waiting BullMQ waiting jobs",
      "# TYPE admin_data_export_queue_waiting gauge",
      `admin_data_export_queue_waiting ${exportMetrics.queueWaiting}`,
      "# HELP admin_data_export_queue_active BullMQ active jobs",
      "# TYPE admin_data_export_queue_active gauge",
      `admin_data_export_queue_active ${exportMetrics.queueActive}`,
      "# HELP admin_data_export_queue_delayed BullMQ delayed jobs",
      "# TYPE admin_data_export_queue_delayed gauge",
      `admin_data_export_queue_delayed ${exportMetrics.queueDelayed}`,
      "# HELP admin_data_export_queue_failed BullMQ failed jobs in queue backend",
      "# TYPE admin_data_export_queue_failed gauge",
      `admin_data_export_queue_failed ${exportMetrics.queueFailed}`,
      "# HELP admin_data_export_queue_completed BullMQ completed jobs in queue backend",
      "# TYPE admin_data_export_queue_completed gauge",
      `admin_data_export_queue_completed ${exportMetrics.queueCompleted}`,
      "# HELP admin_data_export_last_job_duration_ms Last export job duration",
      "# TYPE admin_data_export_last_job_duration_ms gauge",
      `admin_data_export_last_job_duration_ms ${exportMetrics.lastJobDurationMs}`,
      "# HELP admin_data_export_last_success_at Export last success unix timestamp",
      "# TYPE admin_data_export_last_success_at gauge",
      `admin_data_export_last_success_at ${exportMetrics.lastSuccessAtSec}`,
      "# HELP admin_data_export_last_failure_at Export last failure unix timestamp",
      "# TYPE admin_data_export_last_failure_at gauge",
      `admin_data_export_last_failure_at ${exportMetrics.lastFailureAtSec}`,
      "# HELP admin_data_export_retention_sweeps_total Export retention sweeps executed",
      "# TYPE admin_data_export_retention_sweeps_total counter",
      `admin_data_export_retention_sweeps_total ${exportMetrics.retentionSweepTotal}`,
      "# HELP admin_data_export_retention_expired_total Export artifacts expired by retention sweeps",
      "# TYPE admin_data_export_retention_expired_total counter",
      `admin_data_export_retention_expired_total ${exportMetrics.retentionExpiredTotal}`,
      "# HELP admin_data_rollup_refresh_running Whether rollup refresh is currently running",
      "# TYPE admin_data_rollup_refresh_running gauge",
      `admin_data_rollup_refresh_running ${rollupMetrics.runningGauge}`,
      "# HELP admin_data_rollup_refresh_last_run_at Last rollup refresh run unix timestamp",
      "# TYPE admin_data_rollup_refresh_last_run_at gauge",
      `admin_data_rollup_refresh_last_run_at ${rollupMetrics.lastRunAtSec}`,
      "# HELP admin_data_rollup_refresh_last_success_at Last successful rollup refresh unix timestamp",
      "# TYPE admin_data_rollup_refresh_last_success_at gauge",
      `admin_data_rollup_refresh_last_success_at ${rollupMetrics.lastSuccessAtSec}`,
      "# HELP admin_data_rollup_refresh_last_failure_at Last failed rollup refresh unix timestamp",
      "# TYPE admin_data_rollup_refresh_last_failure_at gauge",
      `admin_data_rollup_refresh_last_failure_at ${rollupMetrics.lastFailureAtSec}`,
      "# HELP admin_data_rollup_refresh_last_duration_ms Last rollup refresh duration in milliseconds",
      "# TYPE admin_data_rollup_refresh_last_duration_ms gauge",
      `admin_data_rollup_refresh_last_duration_ms ${rollupMetrics.lastDurationMs}`,
      "# HELP admin_data_rollup_refresh_total Total rollup refresh runs",
      "# TYPE admin_data_rollup_refresh_total counter",
      `admin_data_rollup_refresh_total ${rollupMetrics.refreshTotal}`,
      "# HELP admin_data_rollup_refresh_failed_total Total failed rollup refresh runs",
      "# TYPE admin_data_rollup_refresh_failed_total counter",
      `admin_data_rollup_refresh_failed_total ${rollupMetrics.refreshFailedTotal}`,
      "# HELP admin_data_rollup_recompute_total Total rollup recomputations triggered",
      "# TYPE admin_data_rollup_recompute_total counter",
      `admin_data_rollup_recompute_total ${rollupMetrics.recomputeTotal}`,
      "# HELP admin_data_rollup_last_refreshed_metric_count Number of metric/window entries refreshed in last run",
      "# TYPE admin_data_rollup_last_refreshed_metric_count gauge",
      `admin_data_rollup_last_refreshed_metric_count ${rollupMetrics.lastRefreshedMetricCount}`,
      "# HELP clickhouse_sync_running Whether ClickHouse sync tick is currently running",
      "# TYPE clickhouse_sync_running gauge",
      `clickhouse_sync_running ${clickhouseSyncMetrics.runningGauge}`,
      "# HELP clickhouse_sync_last_run_at Last ClickHouse sync run unix timestamp",
      "# TYPE clickhouse_sync_last_run_at gauge",
      `clickhouse_sync_last_run_at ${clickhouseSyncMetrics.lastRunAtSec}`,
      "# HELP clickhouse_sync_last_success_at Last successful ClickHouse sync unix timestamp",
      "# TYPE clickhouse_sync_last_success_at gauge",
      `clickhouse_sync_last_success_at ${clickhouseSyncMetrics.lastSuccessAtSec}`,
      "# HELP clickhouse_sync_last_failure_at Last failed ClickHouse sync unix timestamp",
      "# TYPE clickhouse_sync_last_failure_at gauge",
      `clickhouse_sync_last_failure_at ${clickhouseSyncMetrics.lastFailureAtSec}`,
      "# HELP clickhouse_sync_last_duration_ms Last ClickHouse sync tick duration (ms)",
      "# TYPE clickhouse_sync_last_duration_ms gauge",
      `clickhouse_sync_last_duration_ms ${clickhouseSyncMetrics.lastDurationMs}`,
      "# HELP clickhouse_sync_last_rows_total Rows synced in last ClickHouse sync tick",
      "# TYPE clickhouse_sync_last_rows_total gauge",
      `clickhouse_sync_last_rows_total ${clickhouseSyncMetrics.lastSyncedRowsTotal}`,
      "# HELP clickhouse_sync_rows_total Total rows synced to ClickHouse",
      "# TYPE clickhouse_sync_rows_total counter",
      `clickhouse_sync_rows_total ${clickhouseSyncMetrics.syncedRowsTotal}`,
      "# HELP clickhouse_sync_last_users_rows Rows synced for admin_users in last tick",
      "# TYPE clickhouse_sync_last_users_rows gauge",
      `clickhouse_sync_last_users_rows ${clickhouseSyncMetrics.lastSyncedUsersRows}`,
      "# HELP clickhouse_sync_last_trades_rows Rows synced for admin_trades in last tick",
      "# TYPE clickhouse_sync_last_trades_rows gauge",
      `clickhouse_sync_last_trades_rows ${clickhouseSyncMetrics.lastSyncedTradesRows}`,
      "# HELP clickhouse_sync_last_daily_rows Rows synced for admin_daily_closes in last tick",
      "# TYPE clickhouse_sync_last_daily_rows gauge",
      `clickhouse_sync_last_daily_rows ${clickhouseSyncMetrics.lastSyncedDailyRows}`,
      "# HELP clickhouse_sync_last_event_rows Rows synced for admin_user_account_events in last tick",
      "# TYPE clickhouse_sync_last_event_rows gauge",
      `clickhouse_sync_last_event_rows ${clickhouseSyncMetrics.lastSyncedEventRows}`,
      "# HELP clickhouse_sync_last_trade_audit_rows Rows synced for admin_trade_audit in last tick",
      "# TYPE clickhouse_sync_last_trade_audit_rows gauge",
      `clickhouse_sync_last_trade_audit_rows ${clickhouseSyncMetrics.lastSyncedTradeAuditRows}`,
      "# HELP clickhouse_sync_last_order_intent_rows Rows synced for admin_order_intent_audit in last tick",
      "# TYPE clickhouse_sync_last_order_intent_rows gauge",
      `clickhouse_sync_last_order_intent_rows ${clickhouseSyncMetrics.lastSyncedOrderIntentRows}`,
      "",
    ].join("\n"),
  );
});

const wsTransportTlsRequired =
  process.env.NODE_ENV === "production" &&
  process.env.COOKIE_SECURE !== "false" &&
  !["0", "false", "off", "no"].includes(
    String(process.env.WS_TRANSPORT_REQUIRE_TLS ?? "1").trim().toLowerCase(),
  );
const wsOriginValidationEnabled = !["0", "false", "off", "no"].includes(
  String(process.env.WS_ORIGIN_VALIDATION_ENABLED ?? "1").trim().toLowerCase(),
);
const wsAllowMissingOrigin = ["1", "true", "on", "yes"].includes(
  String(process.env.WS_ORIGIN_ALLOW_MISSING ?? (process.env.NODE_ENV === "production" ? "0" : "1"))
    .trim()
    .toLowerCase(),
);
const wsUserConnectionLimit = Math.max(
  1,
  Math.min(100, Math.trunc(Number(process.env.WS_MAX_CONNECTIONS_PER_USER ?? 5) || 5)),
);
const wsMessageRateLimitPerWindow = Math.max(
  1,
  Math.min(5000, Math.trunc(Number(process.env.WS_MESSAGE_RATE_LIMIT ?? 120) || 120)),
);
const wsMessageRateWindowMs = Math.max(
  1000,
  Math.min(600_000, Math.trunc(Number(process.env.WS_MESSAGE_RATE_WINDOW_MS ?? 10_000) || 10_000)),
);
const wsAllowedOrigins = new Set<string>();
const wsAllowedOriginsRaw = String(process.env.WS_ALLOWED_ORIGINS ?? "").trim();
if (wsAllowedOriginsRaw) {
  for (const candidate of wsAllowedOriginsRaw.split(",")) {
    const normalized = normalizeWsOrigin(candidate);
    if (normalized) wsAllowedOrigins.add(normalized);
  }
}
{
  const appOrigin = normalizeWsOrigin(process.env.APP_URL);
  if (appOrigin) wsAllowedOrigins.add(appOrigin);
}

function clampWsPushFrequencyMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1_000, Math.max(0, Math.trunc(n)));
}

let liveWsPushFrequencyMs = 0;
const queuedQuoteRowsBySymbol = new Map<string, any>();
let queuedQuoteSeq = 0;
let queuedQuoteAsOf = 0;
let queuedQuoteFlushTimer: ReturnType<typeof setTimeout> | null = null;
let queuedQuoteAnonRowId = 0;

function applyLiveWsPushFrequencyMs(value: unknown) {
  liveWsPushFrequencyMs = clampWsPushFrequencyMs(value);
  if (liveWsPushFrequencyMs <= 0 && queuedQuoteFlushTimer) {
    clearTimeout(queuedQuoteFlushTimer);
    queuedQuoteFlushTimer = null;
    flushQueuedQuoteBroadcast();
  }
}

async function refreshLiveWsPushFrequencyMs() {
  try {
    const [row] = await db
      .select({ wsPushFrequencyMs: globalSettings.wsPushFrequencyMs })
      .from(globalSettings)
      .where(eq(globalSettings.id, 1))
      .limit(1);
    applyLiveWsPushFrequencyMs(row?.wsPushFrequencyMs);
  } catch {
    applyLiveWsPushFrequencyMs(0);
  }
}

void refreshLiveWsPushFrequencyMs();

function normalizeWsOrigin(raw: unknown): string | null {
  const source = String(raw ?? "").trim();
  if (!source) return null;
  try {
    const parsed = new URL(source);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return null;
    return `${proto}//${parsed.host.toLowerCase()}`;
  } catch {
    return null;
  }
}

function getWsRequestPrimaryHeader(req: any, headerName: string): string {
  const rawValue = req?.headers?.[headerName];
  const first = Array.isArray(rawValue) ? rawValue[0] : String(rawValue ?? "");
  return first.split(",")[0]?.trim() || "";
}

function expectedWsOriginFromRequest(req: any): string | null {
  const hostRaw = getWsRequestPrimaryHeader(req, "x-forwarded-host") || getWsRequestPrimaryHeader(req, "host");
  if (!hostRaw) return null;

  const secure = isWsRequestTransportSecure(req);
  const proto = secure ? "https" : "http";
  return normalizeWsOrigin(`${proto}://${hostRaw}`);
}

function isWsOriginAllowed(req: any): boolean {
  if (!wsOriginValidationEnabled) return true;
  const origin = normalizeWsOrigin(req?.headers?.origin);
  if (!origin) return wsAllowMissingOrigin;
  if (wsAllowedOrigins.has(origin)) return true;
  const expected = expectedWsOriginFromRequest(req);
  if (expected && origin === expected) return true;
  return false;
}

function countWsConnectionsForUser(userId: number, exclude?: LiveClient): number {
  let count = 0;
  for (const ws of wss.clients as Set<LiveClient>) {
    if (ws === exclude) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (Number(ws.userId) === userId) count += 1;
  }
  return count;
}

function consumeWsMessageRate(client: LiveClient): boolean {
  const nowMs = Date.now();
  const windowStartMs = Number(client.wsMsgWindowStartMs ?? 0);
  if (!windowStartMs || nowMs - windowStartMs >= wsMessageRateWindowMs) {
    client.wsMsgWindowStartMs = nowMs;
    client.wsMsgCount = 1;
    return true;
  }
  const nextCount = Number(client.wsMsgCount ?? 0) + 1;
  client.wsMsgCount = nextCount;
  return nextCount <= wsMessageRateLimitPerWindow;
}

function computeQuoteKey(symbols: Set<string> | undefined): string {
  if (!symbols || symbols.size === 0) return "";
  return Array.from(symbols)
    .map((s) => String(s).toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");
}

function syncClientQuoteKey(client: LiveClient) {
  client.quoteKey = computeQuoteKey(client.quoteSymbols);
}

function normIso2(v: any): string | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : undefined;
}

function readWsHeaderIso2(req: any): string | undefined {
  return getTrustedProxyCountryIso2(req as Request);
}

function isWsRequestTransportSecure(req: any): boolean {
  if (Boolean(req?.socket?.encrypted)) return true;
  const protoHeaderRaw = req?.headers?.["x-forwarded-proto"];
  const protoHeader = Array.isArray(protoHeaderRaw) ? protoHeaderRaw[0] : String(protoHeaderRaw ?? "");
  const proto = protoHeader.split(",")[0]?.trim().toLowerCase();
  return proto === "https" || proto === "wss";
}

function getWsSessionIdFromCookies(req: any): string | undefined {
  const rawCookieHeader = req?.headers?.cookie;
  if (!rawCookieHeader) return undefined;

  try {
    const cookies = cookie.parse(String(rawCookieHeader));
    const cookieVal = cookies?.[SESSION_COOKIE_NAME];
    if (!cookieVal) return undefined;

    const decoded = decodeURIComponent(String(cookieVal));
    if (decoded.startsWith("s:")) {
      const unsigned = signature.unsign(decoded.slice(2), SESSION_SECRET);
      return unsigned === false ? undefined : String(unsigned);
    }
    return decoded;
  } catch {
    return undefined;
  }
}

async function getWsSession(req: any): Promise<{ sid: string; sess: any } | null> {
  const sid = getWsSessionIdFromCookies(req);
  if (!sid) return null;

  try {
    const sess = await new Promise<any | null>((resolve) => {
      if (typeof sessionStore.get !== "function") return resolve(null);
      sessionStore.get(sid, (err: any, sessionValue: any) => {
        if (err || !sessionValue) return resolve(null);
        resolve(sessionValue);
      });
    });

    if (!sess) return null;
    const resolved = typeof sess === "string" ? JSON.parse(sess) : sess;
    return { sid, sess: resolved };
  } catch {
    return null;
  }
}

async function destroyCookieSession(sid: string) {
  try {
    await new Promise<void>((resolve) => {
      if (typeof sessionStore.destroy !== "function") return resolve();
      sessionStore.destroy(sid, () => resolve());
    });
  } catch {
    // ignore
  }
}

function wsSendJson(socket: WebSocket, payload: any) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

async function wsCloseWithPolicy(socket: WebSocket, client: LiveClient, decision: any) {
  wsSendJson(socket, {
    type: WS_MSG_ERROR,
    code: decision?.code ?? "JURISDICTION_RESTRICTED",
    reasonCode: decision?.reasonCode ?? null,
    message: decision?.message ?? "Access restricted.",
    blockedBy: decision?.blockedBy ?? null,
  });

  // Best-effort revoke+destroy so the user is kicked immediately across HTTP + WS
  if (client.sessionId && client.userId) {
    try {
      await revokeSession({
        actorUserId: 0,
        targetUserId: Number(client.userId),
        sessionId: String(client.sessionId),
        reason: String(decision?.reasonCode ?? decision?.code ?? "JURISDICTION_RESTRICTED"),
      });
    } catch { }

    await destroyCookieSession(String(client.sessionId));
  }

  try {
    socket.close(4403, "JURISDICTION_BLOCKED");
  } catch {
    // ignore
  }
}

function wsCloseUnauthorized(socket: WebSocket, reason: string) {
  wsSendJson(socket, { type: WS_MSG_ERROR, code: "WS_UNAUTHORIZED", message: "Unauthorized", reason });
  try {
    socket.close(4401, "UNAUTHORIZED");
  } catch { }
}

function isImpersonationTtlExpired(startedAtMs: unknown, nowMs = Date.now()): boolean {
  const started = Number(startedAtMs ?? 0);
  if (!Number.isFinite(started) || started <= 0) return true;
  return nowMs - started > IMPERSONATION_TTL_MS;
}

function closeImpersonationTtlExpired(socket: WebSocket, client: LiveClient) {
  if (client.impersonationTtlCloseIssued) return;
  client.impersonationTtlCloseIssued = true;

  appendIdentityAudit({
    userId: typeof client.userId === "number" ? client.userId : null,
    email: client.sessionEmail ?? null,
    category: "SECURITY",
    type: "IMPERSONATION_WS_TTL_EXPIRED",
    title: "Impersonation websocket session expired",
    description: "WebSocket connection closed because impersonation TTL elapsed",
    ip: client.clientIp ?? null,
    userAgent: client.clientUserAgent ?? null,
    actorAdminId: typeof client.realAdminId === "number" ? client.realAdminId : null,
    actorType: "ADMIN",
    actorUserId: typeof client.realAdminId === "number" ? client.realAdminId : null,
    sessionId: client.sessionId ?? null,
    data: {
      wsPath: "/ws",
      reason: "IMPERSONATION_TTL_EXPIRED",
      startedAtMs: client.impersonationStartedAtMs ?? null,
      ttlMs: IMPERSONATION_TTL_MS,
      origin: client.wsOrigin ?? null,
    },
  });

  wsSendJson(socket, {
    type: WS_MSG_ERROR,
    code: "IMPERSONATION_EXPIRED",
    message: "Impersonation websocket session expired",
  });
  try {
    socket.close(1008, "IMPERSONATION_TTL_EXPIRED");
  } catch {
    // ignore close race
  }
}

function appendImpersonationWsConnectAudit(client: LiveClient) {
  if (!client.isImpersonating) return;
  if (!Number.isFinite(Number(client.realAdminId ?? 0)) || Number(client.realAdminId) <= 0) return;
  if (!Number.isFinite(Number(client.userId ?? 0)) || Number(client.userId) <= 0) return;

  appendIdentityAudit({
    userId: Number(client.userId),
    email: client.sessionEmail ?? null,
    category: "SECURITY",
    type: "IMPERSONATION_WS_CONNECTED",
    title: "Impersonation websocket session opened",
    description: "Admin established websocket connection while impersonating a trader session",
    ip: client.clientIp ?? null,
    userAgent: client.clientUserAgent ?? null,
    actorAdminId: Number(client.realAdminId),
    actorType: "ADMIN",
    actorUserId: Number(client.realAdminId),
    sessionId: client.sessionId ?? null,
    data: {
      wsPath: "/ws",
      startedAtMs: client.impersonationStartedAtMs ?? null,
      ttlMs: IMPERSONATION_TTL_MS,
      origin: client.wsOrigin ?? null,
    },
  });
}

function broadcast(event: any, filter?: (client: LiveClient) => boolean) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients as Set<LiveClient>) {
    if (client.readyState === WebSocket.OPEN && (!filter || filter(client))) {
      client.send(payload);
    }
  }
}

function normalizeSymbolsInput(raw: any): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);
}

function maskUserId(userId?: number): string | null {
  if (!userId || !Number.isFinite(userId)) return null;
  const raw = String(userId);
  if (raw.length <= 2) return `**`;
  return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
}

async function sendQuoteSnapshot(socket: WebSocket, symbols?: string[]) {
  if (Array.isArray(symbols) && symbols.length === 0) {
    wsSendJson(socket, {
      type: WS_MSG_QUOTES_SNAPSHOT,
      protocolVersion: WS_PROTOCOL_VERSION,
      seq: 0,
      asOf: Date.now(),
      rows: [],
    });
    return;
  }

  const snapshot = await buildQuoteSnapshotResponse(symbols);
  wsSendJson(socket, {
    type: WS_MSG_QUOTES_SNAPSHOT,
    protocolVersion: WS_PROTOCOL_VERSION,
    seq: snapshot.seq,
    asOf: snapshot.asOf,
    rows: snapshot.rows,
  });
}

function filterQuoteRowsForClient(rows: any[], client: LiveClient) {
  const symbols = client.quoteSymbols;
  if (!symbols || symbols.size === 0) return [];
  return rows.filter((row) => row?.symbol && symbols.has(String(row.symbol).toUpperCase()));
}

async function refreshClientAllowedQuoteSymbols(client: LiveClient) {
  const userId = typeof client.userId === "number" && Number.isFinite(client.userId) ? client.userId : null;
  const allowedSymbols = await getAllowedSymbolsForUser(userId);
  client.allowedQuoteSymbols = allowedSymbols;

  if (client.wantsQuotesAll) {
    client.quoteSymbols = new Set(allowedSymbols);
    syncClientQuoteKey(client);
    return;
  }

  const current = client.quoteSymbols ?? new Set<string>();
  const filtered = new Set<string>();
  for (const symbol of current) {
    if (allowedSymbols.has(symbol)) filtered.add(symbol);
  }
  client.quoteSymbols = filtered;
  syncClientQuoteKey(client);
}

async function refreshWsQuotePermissions(targetUserIds?: Set<number>) {
  const tasks: Array<Promise<void>> = [];

  for (const ws of wss.clients as Set<LiveClient>) {
    const client = ws as LiveClient;
    if (client.readyState !== WebSocket.OPEN) continue;

    const userId = typeof client.userId === "number" ? client.userId : null;
    if (targetUserIds) {
      if (!userId || !targetUserIds.has(userId)) continue;
    }

    tasks.push(
      (async () => {
        await refreshClientAllowedQuoteSymbols(client);
        const snapshotSymbols = Array.from(client.quoteSymbols ?? []);
        await sendQuoteSnapshot(client, snapshotSymbols);
      })(),
    );
  }

  if (tasks.length) {
    const settled = await Promise.allSettled(tasks);
    addWsQuotePermissionRefreshTotal(tasks.length);
    addWsQuotePermissionRefreshErrorsTotal(settled.filter((entry) => entry.status === "rejected").length);
  }
}

wss.on("connection", async (socket, req) => {
  const client = socket as LiveClient;
  const pendingMessages: any[] = [];
  let wsReady = false;

  if (wsTransportTlsRequired && !isWsRequestTransportSecure(req)) {
    wsSendJson(socket, {
      type: WS_MSG_ERROR,
      code: "TRANSPORT_TLS_REQUIRED",
      message: "Secure transport required",
    });
    try {
      socket.close(4401, "TLS_REQUIRED");
    } catch {
      // ignore close race
    }
    return;
  }

  if (!isWsOriginAllowed(req)) {
    incWsOriginRejectedTotal();
    wsSendJson(socket, {
      type: WS_MSG_ERROR,
      code: "WS_ORIGIN_FORBIDDEN",
      message: "WebSocket origin not allowed",
    });
    try {
      socket.close(4403, "ORIGIN_FORBIDDEN");
    } catch {
      // ignore close race
    }
    return;
  }

  const handleMessage = async (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg !== "object") return;
      const type = String((msg as any).type ?? "");

      if (type === "auth" && typeof (msg as any).userId === "number") {
        const requested = Number((msg as any).userId);

        // If we have a session-bound userId, require it to match.
        if (client.userId && requested === client.userId) {
          return;
        }

        // Otherwise, do not allow client-controlled user binding.
        return wsCloseUnauthorized(socket, "AUTH_MISMATCH");
      }

      if (type === WS_MSG_AUTH_HELLO) {
        const scopes = [
          "quotes",
          client.userId ? "trades" : null,
          client.userId ? "account" : null,
          client.isAdmin ? "admin" : null,
        ].filter(Boolean);
        return wsSendJson(socket, {
          type: WS_MSG_AUTH_OK,
          userIdMasked: maskUserId(client.userId),
          isAdmin: client.isAdmin,
          scopes,
          protocolVersion: WS_PROTOCOL_VERSION,
        });
      }

      if (type === WS_MSG_QUOTES_SUBSCRIBE) {
        const symbols = normalizeSymbolsInput((msg as any).symbols);
        const allowedSymbols = client.allowedQuoteSymbols ?? new Set<string>();
        if (!symbols.length) {
          client.wantsQuotesAll = true;
          client.quoteSymbols = new Set(allowedSymbols);
        } else {
          client.wantsQuotesAll = false;
          for (const symbol of symbols) {
            if (allowedSymbols.has(symbol)) {
              client.quoteSymbols?.add(symbol);
            }
          }
        }
        syncClientQuoteKey(client);
        const snapshotSymbols = Array.from(client.quoteSymbols ?? []);
        await sendQuoteSnapshot(socket, snapshotSymbols);
        return;
      }

      if (type === WS_MSG_QUOTES_UNSUBSCRIBE) {
        const symbols = normalizeSymbolsInput((msg as any).symbols);
        if (!symbols.length) {
          client.wantsQuotesAll = false;
          client.quoteSymbols?.clear();
          syncClientQuoteKey(client);
          return;
        }
        for (const symbol of symbols) {
          client.quoteSymbols?.delete(symbol);
        }
        if ((client.quoteSymbols?.size ?? 0) === 0) {
          client.wantsQuotesAll = false;
        }
        syncClientQuoteKey(client);
        return;
      }

      if (type === WS_MSG_TRADES_SUBSCRIBE) {
        if (!client.userId) return wsCloseUnauthorized(socket, "AUTH_REQUIRED");
        client.wantsTrades = true;
        return;
      }

      if (type === WS_MSG_TRADES_UNSUBSCRIBE) {
        client.wantsTrades = false;
        return;
      }

      if (type === WS_MSG_ACCOUNT_SUBSCRIBE) {
        if (!client.userId) return wsCloseUnauthorized(socket, "AUTH_REQUIRED");
        client.wantsAccount = true;
        try {
          const { recalcAccount } = await import("../recalcAccount");
          const metrics = await recalcAccount(client.userId);
          if (metrics) {
            wsSendJson(socket, {
              type: WS_MSG_ACCOUNT_SNAPSHOT,
              protocolVersion: WS_PROTOCOL_VERSION,
              userId: client.userId,
              payload: {
                summary: {
                  startingBalance: metrics.startingBalance,
                  balance: metrics.balance,
                  equity: metrics.equity,
                  floatingPnl: metrics.floatingPnl,
                  usedMargin: metrics.usedMargin,
                  freeMargin: metrics.freeMargin,
                  marginLevel: metrics.marginLevel,
                  openPositions: metrics.openPositions,
                  pricingStale: metrics.pricingStale,
                  staleSymbols: metrics.staleSymbols,
                  asOf: metrics.asOf.toISOString(),
                },
              },
            });
          }
        } catch (e) {
          console.warn("[WS] Failed to send account snapshot:", e);
        }
        return;
      }

      if (type === WS_MSG_ACCOUNT_UNSUBSCRIBE) {
        client.wantsAccount = false;
        return;
      }

      if (type === WS_MSG_PING) {
        return wsSendJson(socket, { type: WS_MSG_PONG });
      }
    } catch (err) {
      console.error("Invalid WS message:", err);
    }
  };

  // Attach immediately so we don't drop messages sent right after the handshake.
  socket.on("message", (raw) => {
    if (client.isImpersonating && isImpersonationTtlExpired(client.impersonationStartedAtMs)) {
      closeImpersonationTtlExpired(socket, client);
      return;
    }

    if (!consumeWsMessageRate(client)) {
      incWsMessageRateLimitedTotal();
      wsSendJson(socket, {
        type: WS_MSG_ERROR,
        code: "WS_MESSAGE_RATE_LIMITED",
        message: "Message rate limit exceeded",
        retryAfterMs: wsMessageRateWindowMs,
      });
      try {
        socket.close(4408, "RATE_LIMITED");
      } catch {
        // ignore close race
      }
      return;
    }

    if (!wsReady) {
      if (pendingMessages.length < 50) pendingMessages.push(raw);
      else wsCloseUnauthorized(socket, "WS_BACKPRESSURE");
      return;
    }
    void handleMessage(raw);
  });
  client.userId = undefined;
  client.sessionId = undefined;
  client.isAdmin = false;
  client.isImpersonating = false;
  client.realAdminId = undefined;
  client.impersonationStartedAtMs = undefined;
  client.sessionEmail = undefined;
  client.impersonationTtlCloseIssued = false;
  client.clientIp = undefined;
  client.clientUserAgent = undefined;
  client.wsOrigin = normalizeWsOrigin(req?.headers?.origin);
  client.ipCountryIso2 = undefined;
  client.userCountryIso2 = undefined;
  client.allowedQuoteSymbols = new Set();
  client.quoteSymbols = new Set();
  client.wantsQuotesAll = false;
  client.quoteKey = "";
  client.wantsTrades = false;
  client.wantsAccount = false;
  client.wsMsgWindowStartMs = Date.now();
  client.wsMsgCount = 0;

  // Resolve IP country once at connect time (proxy headers preferred).
  try {
    const ip = getClientIp(req as any);
    client.clientIp = ip;
    client.clientUserAgent = getUserAgent(req as any);
    const geo = buildGeoContext(ip, extractGeoHints(req as any));
    client.ipCountryIso2 = readWsHeaderIso2(req) ?? (geo?.countryCode ? normIso2(geo.countryCode) : undefined);
  } catch {
    client.clientIp = getClientIp(req as any);
    client.clientUserAgent = getUserAgent(req as any);
    client.ipCountryIso2 = readWsHeaderIso2(req);
  }

  // Bind WS auth to the cookie session (do not trust client-provided userId).
  try {
    const wsSess = await getWsSession(req);
    if (wsSess?.sid && wsSess?.sess) {
      const sess = wsSess.sess as any;
      const sessionUserId = Number(sess?.userId);
      if (Number.isFinite(sessionUserId) && sessionUserId > 0) {
        client.sessionId = String(wsSess.sid);
        client.isAdmin = Boolean(sess?.isAdmin);
        client.isImpersonating = Boolean(sess?.isImpersonating);
        client.sessionEmail = typeof sess?.email === "string" ? sess.email : undefined;
        const realAdminId = Number(sess?.realAdminId ?? 0);
        client.realAdminId = Number.isFinite(realAdminId) && realAdminId > 0 ? realAdminId : undefined;
        const impersonationStartedAtMs = Number(sess?.impersonationStartedAt ?? 0);
        client.impersonationStartedAtMs =
          Number.isFinite(impersonationStartedAtMs) && impersonationStartedAtMs > 0
            ? impersonationStartedAtMs
            : undefined;

        if (client.isImpersonating) {
          const impersonatedUserId = Number(sess?.impersonatedUserId ?? 0);
          const validImpersonatedUserId =
            Number.isFinite(impersonatedUserId) && impersonatedUserId > 0 && impersonatedUserId === sessionUserId;
          if (!client.realAdminId || !client.impersonationStartedAtMs || !validImpersonatedUserId) {
            wsCloseUnauthorized(socket, "IMPERSONATION_STATE_INVALID");
            return;
          }
          if (isImpersonationTtlExpired(client.impersonationStartedAtMs)) {
            closeImpersonationTtlExpired(socket, client);
            return;
          }
        }

        const [userRow] = await db
          .select({ countryIso2: users.countryIso2, countryLegacy: users.country })
          .from(users)
          .where(eq(users.id, sessionUserId))
          .limit(1);

        if (!userRow) {
          await destroyCookieSession(String(client.sessionId));
          wsCloseUnauthorized(socket, "USER_NOT_FOUND");
          return;
        }

        const userCountryIso2 =
          normIso2(userRow?.countryIso2) ??
          (typeof userRow?.countryLegacy === "string" && userRow.countryLegacy.trim().length === 2
            ? normIso2(userRow.countryLegacy)
            : undefined);

        client.userCountryIso2 = userCountryIso2;

        // Enforce jurisdiction login policy for WS connections (admins cannot be locked out).
        if (!(client.isAdmin && !client.isImpersonating)) {
          const decision = evaluateLoginJurisdiction({
            ipCountryIso2: client.ipCountryIso2 ?? null,
            userCountryIso2: userCountryIso2 ?? null,
          });

          if (!decision.allowed) {
            await wsCloseWithPolicy(socket, client, decision);
            return;
          }
        }

        client.userId = sessionUserId;

        const concurrentConnections = countWsConnectionsForUser(sessionUserId, client);
        if (concurrentConnections >= wsUserConnectionLimit) {
          incWsUserConnectionLimitRejectedTotal();
          wsSendJson(socket, {
            type: WS_MSG_ERROR,
            code: "WS_CONNECTION_LIMIT_REACHED",
            message: "Too many active websocket connections for this user",
            limit: wsUserConnectionLimit,
          });
          try {
            socket.close(4409, "CONNECTION_LIMIT");
          } catch {
            // ignore close race
          }
          return;
        }

        appendImpersonationWsConnectAudit(client);
      }
    }
  } catch (e) {
    console.warn("[WS] Failed to bind session to websocket:", e);
  }

  try {
    await refreshClientAllowedQuoteSymbols(client);
  } catch (e) {
    console.warn("[WS] Failed to resolve allowed quote symbols:", e);
    client.allowedQuoteSymbols = new Set();
    client.quoteSymbols = new Set();
    client.wantsQuotesAll = false;
    syncClientQuoteKey(client);
  }

  wsReady = true;
  if (pendingMessages.length) {
    const queued = pendingMessages.splice(0);
    for (const raw of queued) {
      if (socket.readyState !== WebSocket.OPEN) break;
      await handleMessage(raw);
    }
  }
});

// Periodically re-check the login jurisdiction policy for connected clients.
// This ensures users are disconnected if an admin enables blocking after they are already connected.
const wsPolicyRecheckMs = Number(process.env.WS_JURISDICTION_RECHECK_MS ?? 30_000);
const wsPolicyRecheckTimer = setInterval(() => {
  for (const ws of wss.clients as Set<LiveClient>) {
    const client = ws as LiveClient;
    if (client.readyState !== WebSocket.OPEN) continue;
    if (!client.userId || !client.sessionId) continue;
    if (client.isImpersonating && isImpersonationTtlExpired(client.impersonationStartedAtMs)) {
      closeImpersonationTtlExpired(client, client);
      continue;
    }
    if (client.isAdmin && !client.isImpersonating) continue;

    const decision = evaluateLoginJurisdiction({
      ipCountryIso2: client.ipCountryIso2 ?? null,
      userCountryIso2: client.userCountryIso2 ?? null,
    });

    if (!decision.allowed) {
      wsCloseWithPolicy(client as any, client, decision);
    }
  }
}, wsPolicyRecheckMs);
wsPolicyRecheckTimer.unref?.();

function broadcastQuoteRowsUpdate(rows: any[], seq: number, asOf: number) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  // Pre-serialize per subscription key to avoid per-socket JSON.stringify work.
  const groups = new Map<string, LiveClient[]>();
  for (const ws of wss.clients as Set<LiveClient>) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const client = ws as LiveClient;
    const key = client.quoteKey ?? computeQuoteKey(client.quoteSymbols);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(client);
    else groups.set(key, [client]);
  }

  if (groups.size === 0) return;

  const rowsWithSymbols = rows
    .map((row: any) => {
      if (!row?.symbol) return null;
      return { row, symbol: String(row.symbol).toUpperCase() };
    })
    .filter(Boolean) as Array<{ row: any; symbol: string }>;

  for (const [, clients] of groups.entries()) {
    const symbols = clients[0]?.quoteSymbols;
    if (!symbols || symbols.size === 0) continue;

    const rowsForGroup: any[] = [];
    for (const item of rowsWithSymbols) {
      if (symbols.has(item.symbol)) rowsForGroup.push(item.row);
    }
    if (rowsForGroup.length === 0) continue;

    let serialized = "";
    try {
      serialized = JSON.stringify({
        type: WS_MSG_QUOTES_UPDATE,
        protocolVersion: WS_PROTOCOL_VERSION,
        seq,
        asOf,
        rows: rowsForGroup,
      });
    } catch {
      continue;
    }

    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(serialized);
      } catch {
        // ignore
      }
    }
  }
}

function flushQueuedQuoteBroadcast() {
  if (queuedQuoteRowsBySymbol.size === 0) {
    queuedQuoteSeq = 0;
    queuedQuoteAsOf = 0;
    return;
  }

  const rows = Array.from(queuedQuoteRowsBySymbol.values());
  queuedQuoteRowsBySymbol.clear();

  const seq = queuedQuoteSeq;
  const asOf = queuedQuoteAsOf || Date.now();
  queuedQuoteSeq = 0;
  queuedQuoteAsOf = 0;

  broadcastQuoteRowsUpdate(rows, seq, asOf);
}

function queueQuoteRowsForBroadcast(rows: any[], seq: number, asOf: number) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  queuedQuoteSeq = Math.max(queuedQuoteSeq, Number.isFinite(seq) ? seq : 0);
  queuedQuoteAsOf = Math.max(queuedQuoteAsOf, Number.isFinite(asOf) ? asOf : Date.now());

  for (const row of rows) {
    const symbol = row?.symbol ? String(row.symbol).toUpperCase() : "";
    const key = symbol || `__anon_${++queuedQuoteAnonRowId}`;
    queuedQuoteRowsBySymbol.set(key, row);
  }

  if (queuedQuoteFlushTimer) return;
  queuedQuoteFlushTimer = setTimeout(() => {
    queuedQuoteFlushTimer = null;
    flushQueuedQuoteBroadcast();
  }, liveWsPushFrequencyMs);
}

// Bridge internal live events to WebSocket clients (user-scoped when userId is present)
onLiveEvent((event) => {
  const ev = event as any;
  if (ev?.type === "global-settings:updated") {
    const payloadPushMs = ev?.payload?.wsPushFrequencyMs;
    if (payloadPushMs !== undefined && payloadPushMs !== null) {
      applyLiveWsPushFrequencyMs(payloadPushMs);
    } else {
      void refreshLiveWsPushFrequencyMs();
    }
  }

  if (ev?.type === WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED) {
    const userIds = Array.isArray(ev?.payload?.userIds)
      ? new Set(
        (ev.payload.userIds as any[])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      )
      : undefined;

    const targetUserIds = userIds && userIds.size > 0 ? userIds : undefined;
    const eventPayload = {
      type: WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED,
      payload: ev?.payload ?? null,
    };

    void (async () => {
      await refreshWsQuotePermissions(targetUserIds);
      // Broadcast config-change signal to all connected clients so query caches
      // refresh even for sockets that have not yet bound a userId.
      broadcast(eventPayload);
    })();
    return;
  }

  if (ev?.type === WS_MSG_QUOTES_UPDATE && Array.isArray(ev?.payload?.rows)) {
    const seq = Number(ev.payload?.seq ?? 0);
    const asOf = Number(ev.payload?.asOf ?? Date.now());
    const source = typeof ev.payload?.source === "string" ? String(ev.payload.source).trim() : undefined;
    applyQuoteUpdate(ev.payload.rows, { seq, asOf, source });

    const rows = ev.payload.rows as any[];
    if (liveWsPushFrequencyMs > 0) {
      queueQuoteRowsForBroadcast(rows, seq, asOf);
    } else {
      broadcastQuoteRowsUpdate(rows, seq, asOf);
    }
    return;
  }

  const userId = ev?.userId;
  if (ev?.type === WS_MSG_TRADES_UPDATED || ev?.type === WS_MSG_TRADES_UPDATE) {
    if (typeof userId === "number") {
      broadcast(ev, (client) => client.userId === userId && client.wantsTrades);
    } else {
      broadcast(ev, (client) => client.wantsTrades);
    }
    return;
  }

  if (ev?.type === WS_MSG_ACCOUNT_UPDATED || ev?.type === WS_MSG_ACCOUNT_UPDATE) {
    if (typeof userId === "number") {
      broadcast(ev, (client) => client.userId === userId && client.wantsAccount);
    } else {
      broadcast(ev, (client) => client.wantsAccount);
    }
    return;
  }

  if (typeof userId === "number") {
    broadcast(ev, (client) => client.userId === userId);
    return;
  }
  broadcast(ev);
});

// Quote ingestion/simulation is handled by the ingestor role (quoteFeed.ts).
  return { httpServer, broadcast };
}
