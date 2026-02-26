import path from "path";

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseIntBounded(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export type PetascaleRuntimeConfig = {
  allowInsecureInternalTransport: boolean;
  queueEnabled: boolean;
  queueName: string;
  queueConcurrency: number;
  queueMaxAttempts: number;
  queueBackoffMs: number;
  queueStallSeconds: number;
  queuePrefix: string;
  valkeyUrl: string | null;
  objectStorageEnabled: boolean;
  objectStorageBucket: string;
  objectStoragePrefix: string;
  objectStorageLinkTtlSec: number;
  objectStorageEndpoint: string | null;
  objectStoragePort: number;
  objectStorageUseSsl: boolean;
  objectStorageAccessKey: string | null;
  objectStorageSecretKey: string | null;
  objectStorageRegion: string;
  localExportDir: string;
  localExportLinkBase: string;
  clickhouseEnabled: boolean;
  clickhouseUrl: string | null;
  clickhouseUsername: string | null;
  clickhousePassword: string | null;
  clickhouseDatabase: string;
  clickhouseRequestTimeoutMs: number;
};

let cached: PetascaleRuntimeConfig | null = null;

export function getPetascaleRuntimeConfig(): PetascaleRuntimeConfig {
  if (cached) return cached;

  const cfg: PetascaleRuntimeConfig = {
    allowInsecureInternalTransport: parseBool(process.env.ALLOW_INSECURE_INTERNAL_TRANSPORT, false),
    queueEnabled: parseBool(process.env.ADMIN_DATA_EXPORT_QUEUE_ENABLED, true),
    queueName: String(process.env.ADMIN_DATA_EXPORT_QUEUE_NAME || "admin-export-v1").trim(),
    queueConcurrency: parseIntBounded(process.env.ADMIN_DATA_EXPORT_QUEUE_CONCURRENCY, 2, 1, 32),
    queueMaxAttempts: parseIntBounded(process.env.ADMIN_DATA_EXPORT_MAX_ATTEMPTS, 6, 1, 20),
    queueBackoffMs: parseIntBounded(process.env.ADMIN_DATA_EXPORT_BACKOFF_MS, 10_000, 1000, 300_000),
    queueStallSeconds: parseIntBounded(process.env.ADMIN_DATA_EXPORT_STALL_SECONDS, 120, 30, 1800),
    queuePrefix: String(process.env.ADMIN_DATA_EXPORT_QUEUE_PREFIX || "tradehub").trim() || "tradehub",
    valkeyUrl: process.env.VALKEY_URL ? String(process.env.VALKEY_URL).trim() : null,

    objectStorageEnabled: parseBool(process.env.EXPORT_OBJECT_STORAGE_ENABLED, true),
    objectStorageBucket: String(process.env.EXPORT_OBJECT_STORAGE_BUCKET || "admin-data-exports").trim(),
    objectStoragePrefix: String(process.env.EXPORT_OBJECT_STORAGE_PREFIX || "admin-data").trim(),
    objectStorageLinkTtlSec: parseIntBounded(process.env.EXPORT_OBJECT_STORAGE_LINK_TTL_SEC, 900, 60, 86_400),
    objectStorageEndpoint: process.env.EXPORT_OBJECT_STORAGE_ENDPOINT
      ? String(process.env.EXPORT_OBJECT_STORAGE_ENDPOINT).trim()
      : null,
    objectStoragePort: parseIntBounded(process.env.EXPORT_OBJECT_STORAGE_PORT, 9000, 1, 65535),
    objectStorageUseSsl: parseBool(process.env.EXPORT_OBJECT_STORAGE_USE_SSL, false),
    objectStorageAccessKey: process.env.EXPORT_OBJECT_STORAGE_ACCESS_KEY
      ? String(process.env.EXPORT_OBJECT_STORAGE_ACCESS_KEY).trim()
      : null,
    objectStorageSecretKey: process.env.EXPORT_OBJECT_STORAGE_SECRET_KEY
      ? String(process.env.EXPORT_OBJECT_STORAGE_SECRET_KEY).trim()
      : null,
    objectStorageRegion: String(process.env.EXPORT_OBJECT_STORAGE_REGION || "us-east-1").trim(),

    localExportDir: path.resolve(process.cwd(), process.env.ADMIN_DATA_EXPORT_LOCAL_DIR || "admin_data_exports"),
    localExportLinkBase: String(process.env.ADMIN_DATA_EXPORT_LOCAL_LINK_BASE || "/api/admin/data-exports/files").trim(),

    clickhouseEnabled: parseBool(process.env.CLICKHOUSE_ENABLED, false),
    clickhouseUrl: process.env.CLICKHOUSE_URL ? String(process.env.CLICKHOUSE_URL).trim() : null,
    clickhouseUsername: process.env.CLICKHOUSE_USER ? String(process.env.CLICKHOUSE_USER).trim() : null,
    clickhousePassword: process.env.CLICKHOUSE_PASSWORD ? String(process.env.CLICKHOUSE_PASSWORD) : null,
    clickhouseDatabase: String(process.env.CLICKHOUSE_DATABASE || "tradehub").trim(),
    clickhouseRequestTimeoutMs: parseIntBounded(process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS, 120_000, 5000, 600_000),
  };

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !cfg.allowInsecureInternalTransport) {
    if (cfg.objectStorageEnabled && cfg.objectStorageEndpoint && !cfg.objectStorageUseSsl) {
      throw new Error(
        "EXPORT_OBJECT_STORAGE_USE_SSL must be enabled in production. " +
          "For private-network exceptions, set ALLOW_INSECURE_INTERNAL_TRANSPORT=1 explicitly.",
      );
    }

    if (cfg.clickhouseEnabled && cfg.clickhouseUrl && /^http:\/\//i.test(cfg.clickhouseUrl)) {
      throw new Error(
        "CLICKHOUSE_URL must use https:// in production. " +
          "For private-network exceptions, set ALLOW_INSECURE_INTERNAL_TRANSPORT=1 explicitly.",
      );
    }
  }

  cached = cfg;
  return cfg;
}
