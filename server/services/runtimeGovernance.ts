import fs from "node:fs";
import path from "node:path";
import type {
  ControlledReloadStatus,
  RuntimeDocumentationReconciliation,
  RuntimeGovernanceEntry,
  RuntimeGovernanceSnapshot,
  RuntimeGovernanceValue,
} from "@shared/runtimeConfig";
import { getAppliedQuoteTransportConfig } from "../feeds/quoteFeed";
import { getControlledReloadStatus } from "./controlledReload";
import { getPetascaleRuntimeConfig } from "./petascaleEnv";
import { getAutoCloseRuntimeConfig } from "./runtimeConfig/autoClose";
import { getChallengeSchedulerEffectiveState } from "./runtimeConfig/challengeScheduler";
import { resolveEffectiveProviderSelection } from "./runtimeConfig/marketDataProviders";
import { buildSystemConfigAdminSnapshot, ensureSystemConfigRow } from "./systemConfig";

const CONFIGMAP_PATH = "k8s/01-configmap.yaml";
const API_DEPLOYMENT_PATH = "k8s/10-api-deployment.yaml";
const HPA_PATH = "k8s/40-hpa.yaml";
const ALERTS_PATH = "ops/prometheus-config/tradehub-alerts.yml";
const AUDIT_README_PATH = "REPORTS AND REVIEWS/HARDCODING AUDIT/README.md";
const FIX_RECOMMENDATION_PATH =
  "REPORTS AND REVIEWS/HARDCODING AUDIT/06_GOLD_STANDARD_FIX_EXECUTION_RECOMMENDATION.md";
const WAVE4_COMPLETION_PATH = "REPORTS AND REVIEWS/HARDCODING AUDIT/08_WAVE_4_COMPLETION.md";
const WAVE5_COMPLETION_PATH = "REPORTS AND REVIEWS/HARDCODING AUDIT/09_WAVE_5_COMPLETION.md";
const PROD_REQUIREMENTS_PATH = ".agents/PRODUCTION_REQUIREMENTS.md";
const WORKER_CANARY_RUNBOOK_PATH = "k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function readRepoFile(relPath: string): string | null {
  const absPath = path.resolve(process.cwd(), relPath);
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function getFileModifiedAt(relPath: string): number | null {
  const absPath = path.resolve(process.cwd(), relPath);
  try {
    return Math.floor(fs.statSync(absPath).mtimeMs / 1000);
  } catch {
    return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseConfigMapDataValue(content: string | null | undefined, key: string): string | null {
  if (!content) return null;
  const pattern = new RegExp(
    `^\\s{2}${escapeRegex(key)}:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+))\\s*(?:#.*)?$`,
    "m",
  );
  const match = content.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseMaybeNumber(value: string | null): number | string | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function extractFirst(content: string | null | undefined, regex: RegExp): string | null {
  if (!content) return null;
  const match = content.match(regex);
  const value = match?.[1]?.trim() ?? "";
  return value || null;
}

export function parseApiDeploymentManifest(content: string | null | undefined) {
  return {
    replicas: parseMaybeNumber(extractFirst(content, /^\s*replicas:\s*(\d+)\s*$/m)),
    readinessInitialDelaySeconds: parseMaybeNumber(
      extractFirst(content, /readinessProbe:[\s\S]*?initialDelaySeconds:\s*(\d+)/m),
    ),
    readinessPeriodSeconds: parseMaybeNumber(extractFirst(content, /readinessProbe:[\s\S]*?periodSeconds:\s*(\d+)/m)),
    livenessInitialDelaySeconds: parseMaybeNumber(
      extractFirst(content, /livenessProbe:[\s\S]*?initialDelaySeconds:\s*(\d+)/m),
    ),
    livenessPeriodSeconds: parseMaybeNumber(extractFirst(content, /livenessProbe:[\s\S]*?periodSeconds:\s*(\d+)/m)),
    cpuRequest: extractFirst(content, /requests:[\s\S]*?cpu:\s*"([^"]+)"/m),
    memoryRequest: extractFirst(content, /requests:[\s\S]*?memory:\s*"([^"]+)"/m),
    cpuLimit: extractFirst(content, /limits:[\s\S]*?cpu:\s*"([^"]+)"/m),
    memoryLimit: extractFirst(content, /limits:[\s\S]*?memory:\s*"([^"]+)"/m),
    image: extractFirst(content, /^\s*image:\s*([^\s]+)\s*$/m),
  };
}

export function parseHpaManifest(content: string | null | undefined) {
  return {
    minReplicas: parseMaybeNumber(extractFirst(content, /^\s*minReplicas:\s*(\d+)\s*$/m)),
    maxReplicas: parseMaybeNumber(extractFirst(content, /^\s*maxReplicas:\s*(\d+)\s*$/m)),
    cpuAverageUtilization: parseMaybeNumber(extractFirst(content, /averageUtilization:\s*(\d+)/m)),
    wsActiveConnectionsTarget: extractFirst(content, /averageValue:\s*"([^"]+)"/m),
  };
}

function normalizeComparableValue(value: RuntimeGovernanceValue): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function alignWithManifest(value: RuntimeGovernanceValue, manifestValue: RuntimeGovernanceValue): boolean | null {
  const normalizedValue = normalizeComparableValue(value);
  const normalizedManifest = normalizeComparableValue(manifestValue);
  if (normalizedManifest == null) return null;
  return normalizedValue === normalizedManifest;
}

function redactUrlCredentials(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return raw.replace(/\/\/[^@]+@/, "//");
  }
}

function buildEntry(args: {
  key: string;
  label: string;
  value: RuntimeGovernanceValue;
  source: RuntimeGovernanceEntry["source"];
  mutability: RuntimeGovernanceEntry["mutability"];
  secret?: boolean;
  secretConfigured?: boolean | null;
  manifestValue?: RuntimeGovernanceValue;
  manifestPath?: string | null;
  notes?: string | null;
}): RuntimeGovernanceEntry {
  const manifestValue = args.manifestValue ?? null;
  return {
    key: args.key,
    label: args.label,
    value: args.value,
    source: args.source,
    mutability: args.mutability,
    secret: Boolean(args.secret),
    secretConfigured: args.secret ? args.secretConfigured ?? null : null,
    manifestValue,
    manifestPath: args.manifestPath ?? null,
    alignedWithManifest: alignWithManifest(args.value, manifestValue),
    notes: args.notes ?? null,
  };
}

function resolveSessionCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.NODE_ENV === "production";
}

function resolveSessionCookieSameSite(env: NodeJS.ProcessEnv = process.env): "lax" | "strict" | "none" {
  const configured = String(env.COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (configured === "strict") return "strict";
  if (configured === "none") return "none";
  return "lax";
}

function resolveCsrfCookieSameSite(env: NodeJS.ProcessEnv = process.env): "lax" | "strict" {
  const configured = String(env.COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (configured === "strict") return "strict";
  return "lax";
}

function resolveTransportRequireTls(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanEnv(
    env.TRANSPORT_REQUIRE_TLS,
    env.NODE_ENV === "production" && env.COOKIE_SECURE !== "false",
  );
}

function resolveWsTransportRequireTls(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === "production" &&
    env.COOKIE_SECURE !== "false" &&
    !["0", "false", "off", "no"].includes(String(env.WS_TRANSPORT_REQUIRE_TLS ?? "1").trim().toLowerCase())
  );
}

function resolveWsOriginValidationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !["0", "false", "off", "no"].includes(
    String(env.WS_ORIGIN_VALIDATION_ENABLED ?? "1").trim().toLowerCase(),
  );
}

function buildDocumentationStatus(args: {
  id: string;
  label: string;
  docPath: string;
  liveChecks: string[];
  notes?: string | null;
}): RuntimeDocumentationReconciliation {
  const exists = Boolean(readRepoFile(args.docPath));
  return {
    id: args.id,
    label: args.label,
    docPath: args.docPath,
    exists,
    lastModifiedAt: exists ? getFileModifiedAt(args.docPath) : null,
    liveStatus: exists ? "aligned" : "missing-doc",
    liveChecks: args.liveChecks,
    notes: args.notes ?? null,
  };
}

export async function getRuntimeGovernanceSnapshot(): Promise<RuntimeGovernanceSnapshot> {
  const env = process.env;
  const configMap = readRepoFile(CONFIGMAP_PATH);
  const apiDeployment = parseApiDeploymentManifest(readRepoFile(API_DEPLOYMENT_PATH));
  const hpa = parseHpaManifest(readRepoFile(HPA_PATH));
  const alertsExists = Boolean(readRepoFile(ALERTS_PATH));

  const system = buildSystemConfigAdminSnapshot(await ensureSystemConfigRow());
  const petascale = getPetascaleRuntimeConfig();
  const autoClose = await getAutoCloseRuntimeConfig();
  const challengeScheduler = await getChallengeSchedulerEffectiveState();
  const providers = await resolveEffectiveProviderSelection();
  const feedReload = await getControlledReloadStatus("quotes.transport.feed");
  const providersReload = await getControlledReloadStatus("quotes.providers");
  const appliedFeed = getAppliedQuoteTransportConfig();

  const sections = [
    {
      id: "identity-session",
      title: "Identity And Session",
      description:
        "Effective session posture across DB-backed user controls and deploy-owned cookie or transport settings.",
      entries: [
        buildEntry({
          key: "rememberMeEnabled",
          label: "Remember Me Enabled",
          value: system.rememberMeEnabled,
          source: "db",
          mutability: "admin-runtime",
          notes: "DB-backed identity control.",
        }),
        buildEntry({
          key: "rememberMeMaxAgeDays",
          label: "Remember Me Max Age Days",
          value: system.rememberMeMaxAgeDays,
          source: "db",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "sessionCookieMaxAgeHours",
          label: "Session Cookie Max Age Hours",
          value: system.sessionCookieMaxAgeHours,
          source: "db",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "sessionIdleTimeoutMinutes",
          label: "Session Idle Timeout Minutes",
          value: system.sessionIdleTimeoutMinutes,
          source: "db",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "appUrl",
          label: "App URL",
          value: String(env.APP_URL ?? "").trim() || null,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "APP_URL"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "cookieSecure",
          label: "Session Cookie Secure",
          value: resolveSessionCookieSecure(env),
          source: "derived",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "COOKIE_SECURE"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "sessionCookieSameSite",
          label: "Session Cookie SameSite",
          value: resolveSessionCookieSameSite(env),
          source: "derived",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "COOKIE_SAMESITE"),
          manifestPath: CONFIGMAP_PATH,
          notes: "Express session cookie posture.",
        }),
        buildEntry({
          key: "csrfCookieSameSite",
          label: "CSRF Cookie SameSite",
          value: resolveCsrfCookieSameSite(env),
          source: "derived",
          mutability: "code-invariant",
          manifestValue: parseConfigMapDataValue(configMap, "COOKIE_SAMESITE"),
          manifestPath: CONFIGMAP_PATH,
          notes: "Falls back to lax when COOKIE_SAMESITE=none to preserve CSRF cookie safety.",
        }),
        buildEntry({
          key: "transportRequireTls",
          label: "HTTP Transport Requires TLS",
          value: resolveTransportRequireTls(env),
          source: "derived",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "TRANSPORT_REQUIRE_TLS"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "wsTransportRequireTls",
          label: "WS Transport Requires TLS",
          value: resolveWsTransportRequireTls(env),
          source: "derived",
          mutability: "deploy-readonly",
          notes: "Derived from NODE_ENV, COOKIE_SECURE, and WS_TRANSPORT_REQUIRE_TLS.",
        }),
        buildEntry({
          key: "wsOriginValidationEnabled",
          label: "WS Origin Validation Enabled",
          value: resolveWsOriginValidationEnabled(env),
          source: "derived",
          mutability: "deploy-readonly",
        }),
      ],
    },
    {
      id: "market-data",
      title: "Market Data Effective State",
      description:
        "Configured versus applied quote transport and deterministic provider selection diagnostics.",
      entries: [
        buildEntry({
          key: "feedConfiguredPollMs",
          label: "Configured Feed Poll (ms)",
          value: system.feedPollMs,
          source: "db",
          mutability: "controlled-reload",
        }),
        buildEntry({
          key: "feedAppliedPollMs",
          label: "Applied Feed Poll (ms)",
          value: appliedFeed.feedPollMs,
          source: "runtime",
          mutability: "controlled-reload",
        }),
        buildEntry({
          key: "feedConfiguredStaleThresholdMs",
          label: "Configured Stale Threshold (ms)",
          value: system.staleThresholdMs,
          source: "db",
          mutability: "controlled-reload",
        }),
        buildEntry({
          key: "feedAppliedStaleThresholdMs",
          label: "Applied Stale Threshold (ms)",
          value: appliedFeed.staleThresholdMs,
          source: "runtime",
          mutability: "controlled-reload",
        }),
        buildEntry({
          key: "effectiveProviderKey",
          label: "Effective Provider Key",
          value: providers.effectiveProviderKey,
          source: "runtime",
          mutability: "controlled-reload",
        }),
        buildEntry({
          key: "configuredProviderOrder",
          label: "Configured Provider Order",
          value: providers.candidateOrder.join(" -> ") || null,
          source: "db",
          mutability: "controlled-reload",
        }),
        buildEntry({
          key: "providerCacheTtlMs",
          label: "Provider Cache TTL (ms)",
          value: providers.diagnostics.providerCacheTtlMs,
          source: "env",
          mutability: "deploy-readonly",
          notes: "Deploy-owned cache TTL for active provider selection.",
        }),
        buildEntry({
          key: "envFallbackMode",
          label: "Legacy Env Fallback Mode",
          value: providers.diagnostics.envFallbackMode,
          source: "derived",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK"),
          manifestPath: CONFIGMAP_PATH,
        }),
      ],
    },
    {
      id: "exports-analytics",
      title: "Exports And Analytics",
      description:
        "Deploy-owned queue, object-storage, and ClickHouse settings, with secrets shown only as readiness booleans.",
      entries: [
        buildEntry({
          key: "queueEnabled",
          label: "Export Queue Enabled",
          value: petascale.queueEnabled,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "ADMIN_DATA_EXPORT_QUEUE_ENABLED"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "queueConcurrency",
          label: "Export Queue Concurrency",
          value: petascale.queueConcurrency,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "ADMIN_DATA_EXPORT_QUEUE_CONCURRENCY"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "queueMaxAttempts",
          label: "Export Queue Max Attempts",
          value: petascale.queueMaxAttempts,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "ADMIN_DATA_EXPORT_MAX_ATTEMPTS"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "allowInsecureInternalTransport",
          label: "Allow Insecure Internal Transport",
          value: petascale.allowInsecureInternalTransport,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "ALLOW_INSECURE_INTERNAL_TRANSPORT"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "objectStorageEnabled",
          label: "Object Storage Enabled",
          value: petascale.objectStorageEnabled,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "EXPORT_OBJECT_STORAGE_ENABLED"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "objectStorageEndpoint",
          label: "Object Storage Endpoint",
          value: petascale.objectStorageEndpoint,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "EXPORT_OBJECT_STORAGE_ENDPOINT"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "objectStorageUseSsl",
          label: "Object Storage Uses SSL",
          value: petascale.objectStorageUseSsl,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "EXPORT_OBJECT_STORAGE_USE_SSL"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "objectStorageAccessKey",
          label: "Object Storage Access Key Ready",
          value: petascale.objectStorageAccessKey ? "configured" : "missing",
          source: "env",
          mutability: "secret-readiness",
          secret: true,
          secretConfigured: Boolean(petascale.objectStorageAccessKey),
          notes: "Access key value is never exposed.",
        }),
        buildEntry({
          key: "objectStorageSecretKey",
          label: "Object Storage Secret Key Ready",
          value: petascale.objectStorageSecretKey ? "configured" : "missing",
          source: "env",
          mutability: "secret-readiness",
          secret: true,
          secretConfigured: Boolean(petascale.objectStorageSecretKey),
          notes: "Secret key value is never exposed.",
        }),
        buildEntry({
          key: "clickhouseEnabled",
          label: "ClickHouse Enabled",
          value: petascale.clickhouseEnabled,
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "CLICKHOUSE_ENABLED"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "clickhouseUrl",
          label: "ClickHouse URL",
          value: redactUrlCredentials(petascale.clickhouseUrl),
          source: "env",
          mutability: "deploy-readonly",
          manifestValue: parseConfigMapDataValue(configMap, "CLICKHOUSE_URL"),
          manifestPath: CONFIGMAP_PATH,
        }),
        buildEntry({
          key: "clickhousePassword",
          label: "ClickHouse Password Ready",
          value: petascale.clickhousePassword ? "configured" : "missing",
          source: "env",
          mutability: "secret-readiness",
          secret: true,
          secretConfigured: Boolean(petascale.clickhousePassword),
          notes: "Password value is never exposed.",
        }),
      ],
    },
    {
      id: "schedulers",
      title: "Scheduler Guardrails",
      description:
        "Business timing versus deploy kill-switches and fallback guards for critical schedulers.",
      entries: [
        buildEntry({
          key: "autoCloseEnabled",
          label: "Auto-Close Enabled",
          value: autoClose.policy.enableAutoClose,
          source: autoClose.source === "DB" ? "db" : "derived",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "autoCloseFrequencyMinutes",
          label: "Auto-Close Check Frequency Minutes",
          value: autoClose.policy.autoCloseCheckFrequencyMinutes,
          source: autoClose.source === "DB" ? "db" : "derived",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "autoCloseAllowStaleClose",
          label: "Allow Stale Auto-Close",
          value: autoClose.deployGuards.allowStaleClose,
          source: "env",
          mutability: "deploy-readonly",
        }),
        buildEntry({
          key: "autoCloseStaleDeferMaxMinutes",
          label: "Auto-Close Stale Defer Max Minutes",
          value: autoClose.deployGuards.staleDeferMaxMinutes,
          source: "env",
          mutability: "deploy-readonly",
        }),
        buildEntry({
          key: "challengeSchedulerEnabled",
          label: "Challenge Scheduler Enabled",
          value: challengeScheduler.runtime.enabled,
          source: challengeScheduler.runtime.source === "DB" ? "db" : "env",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "challengeSchedulerIntervalMinutes",
          label: "Challenge Scheduler Interval Minutes",
          value: challengeScheduler.runtime.intervalMin,
          source: challengeScheduler.runtime.source === "DB" ? "db" : "env",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "challengeSchedulerMaxRows",
          label: "Challenge Scheduler Max Rows",
          value: challengeScheduler.runtime.maxRows,
          source: challengeScheduler.runtime.source === "DB" ? "db" : "env",
          mutability: "admin-runtime",
        }),
        buildEntry({
          key: "challengeSchedulerStartDelaySec",
          label: "Challenge Scheduler Start Delay Sec",
          value: challengeScheduler.deployGuards.startDelaySec,
          source: "env",
          mutability: "deploy-readonly",
        }),
        buildEntry({
          key: "challengeSchedulerDisabledPollSec",
          label: "Challenge Scheduler Disabled Poll Sec",
          value: challengeScheduler.deployGuards.disabledPollSec,
          source: "env",
          mutability: "deploy-readonly",
        }),
      ],
    },
    {
      id: "deployment",
      title: "Deployment Snapshot",
      description:
        "Git-tracked deployment values that remain deploy-owned and are intentionally not writable from admin.",
      entries: [
        buildEntry({
          key: "apiReplicas",
          label: "API Deployment Replicas",
          value: apiDeployment.replicas,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.replicas,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "readinessInitialDelaySeconds",
          label: "Readiness Initial Delay Seconds",
          value: apiDeployment.readinessInitialDelaySeconds,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.readinessInitialDelaySeconds,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "livenessInitialDelaySeconds",
          label: "Liveness Initial Delay Seconds",
          value: apiDeployment.livenessInitialDelaySeconds,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.livenessInitialDelaySeconds,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "cpuRequest",
          label: "API CPU Request",
          value: apiDeployment.cpuRequest,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.cpuRequest,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "memoryRequest",
          label: "API Memory Request",
          value: apiDeployment.memoryRequest,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.memoryRequest,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "cpuLimit",
          label: "API CPU Limit",
          value: apiDeployment.cpuLimit,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.cpuLimit,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "memoryLimit",
          label: "API Memory Limit",
          value: apiDeployment.memoryLimit,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: apiDeployment.memoryLimit,
          manifestPath: API_DEPLOYMENT_PATH,
        }),
        buildEntry({
          key: "hpaMinReplicas",
          label: "HPA Min Replicas",
          value: hpa.minReplicas,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: hpa.minReplicas,
          manifestPath: HPA_PATH,
        }),
        buildEntry({
          key: "hpaMaxReplicas",
          label: "HPA Max Replicas",
          value: hpa.maxReplicas,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: hpa.maxReplicas,
          manifestPath: HPA_PATH,
        }),
        buildEntry({
          key: "hpaCpuAverageUtilization",
          label: "HPA CPU Avg Utilization",
          value: hpa.cpuAverageUtilization,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: hpa.cpuAverageUtilization,
          manifestPath: HPA_PATH,
        }),
        buildEntry({
          key: "hpaWsActiveConnectionsTarget",
          label: "HPA WS Active Connections Target",
          value: hpa.wsActiveConnectionsTarget,
          source: "manifest",
          mutability: "deploy-readonly",
          manifestValue: hpa.wsActiveConnectionsTarget,
          manifestPath: HPA_PATH,
        }),
        buildEntry({
          key: "alertsFilePresent",
          label: "Prometheus Alerts File Present",
          value: alertsExists,
          source: "manifest",
          mutability: "code-invariant",
          manifestValue: alertsExists,
          manifestPath: ALERTS_PATH,
        }),
      ],
    },
  ];

  const reloads: ControlledReloadStatus[] = [feedReload, providersReload];
  const documentation: RuntimeDocumentationReconciliation[] = [
    buildDocumentationStatus({
      id: "hardcoding-audit-readme",
      label: "Hardcoding Audit README",
      docPath: AUDIT_README_PATH,
      liveChecks: ["Hardcoding audit pack index exists"],
    }),
    buildDocumentationStatus({
      id: "fix-recommendation",
      label: "Wave Execution Recommendation",
      docPath: FIX_RECOMMENDATION_PATH,
      liveChecks: [
        "/api/admin/runtime-config/effective/quote-transport",
        "/api/admin/market-data/providers/effective",
        "/api/admin/runtime-config/governance",
      ],
      notes: "Tracks the intended remediation sequence versus live admin surfaces.",
    }),
    buildDocumentationStatus({
      id: "wave4-completion",
      label: "Wave 4 Completion Record",
      docPath: WAVE4_COMPLETION_PATH,
      liveChecks: ["shared/appSurfaceConfig.ts", "server/services/appLinks.ts"],
    }),
    buildDocumentationStatus({
      id: "wave5-completion",
      label: "Wave 5 Completion Record",
      docPath: WAVE5_COMPLETION_PATH,
      liveChecks: ["/api/admin/runtime-config/governance", "Governance dashboard tab"],
      notes: "This file should only exist once the governance inspector and reconciliation surface are live.",
    }),
    buildDocumentationStatus({
      id: "production-requirements-ledger",
      label: "Production Requirements Ledger",
      docPath: PROD_REQUIREMENTS_PATH,
      liveChecks: ["PRD-CONFIG-001", "PRD-SURFACE-001"],
    }),
    buildDocumentationStatus({
      id: "worker-canary-runbook",
      label: "Worker Canary Cutover Runbook",
      docPath: WORKER_CANARY_RUNBOOK_PATH,
      liveChecks: ["Rollback procedure remains documented outside normal admin controls."],
    }),
  ];

  return {
    generatedAt: nowSec(),
    sections,
    reloads,
    documentation,
  };
}
