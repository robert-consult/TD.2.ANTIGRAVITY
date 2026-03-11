import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type GeneratedSecretSet = {
  POSTGRES_USER: string;
  POSTGRES_DB: string;
  POSTGRES_PASSWORD: string;
  DATABASE_URL: string;
  VALKEY_URL: string;
  SESSION_SECRET: string;
  LEGAL_TERMS_HMAC_SECRET: string;
  ENCRYPTION_KEY: string;
  EMAIL_VERIFY_TOKEN_SECRET: string;
  SMS_OTP_SECRET: string;
  CHALLENGE_CERT_VERIFICATION_SECRET: string;
  EXPORT_LOCAL_LINK_SIGNING_SECRET: string;
  METRICS_AUTH_TOKEN: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  EXPORT_OBJECT_STORAGE_ACCESS_KEY: string;
  EXPORT_OBJECT_STORAGE_SECRET_KEY: string;
  GRAFANA_ADMIN_PASSWORD: string;
};

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomBase64Url(bytes: number): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomAlphaNumeric(prefix: string, bytes: number): string {
  const suffix = crypto
    .randomBytes(bytes)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, Math.max(8, bytes));
  return `${prefix}${suffix}`;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

function writeSecureFile(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function resolveOutDir(): string {
  const outFlag = process.argv.find((arg) => arg.startsWith("--out-dir="));
  if (outFlag) {
    const value = outFlag.slice("--out-dir=".length).trim();
    if (value) return path.resolve(process.cwd(), value);
  }
  return path.resolve(process.cwd(), "PRODUCTION READINESS/generated");
}

function buildSecrets(): GeneratedSecretSet {
  const POSTGRES_USER = "tradehub";
  const POSTGRES_DB = "tradehub";
  const POSTGRES_PASSWORD = randomBase64Url(36);
  const DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres.tradehub.svc.cluster.local:5432/${POSTGRES_DB}`;
  const VALKEY_URL = "redis://valkey.tradehub.svc.cluster.local:6379/0";

  return {
    POSTGRES_USER,
    POSTGRES_DB,
    POSTGRES_PASSWORD,
    DATABASE_URL,
    VALKEY_URL,
    SESSION_SECRET: randomBase64Url(48),
    LEGAL_TERMS_HMAC_SECRET: randomBase64Url(48),
    ENCRYPTION_KEY: randomHex(32),
    EMAIL_VERIFY_TOKEN_SECRET: randomBase64Url(48),
    SMS_OTP_SECRET: randomBase64Url(48),
    CHALLENGE_CERT_VERIFICATION_SECRET: randomBase64Url(48),
    EXPORT_LOCAL_LINK_SIGNING_SECRET: randomBase64Url(48),
    METRICS_AUTH_TOKEN: randomBase64Url(48),
    CLICKHOUSE_USER: "tradehub",
    CLICKHOUSE_PASSWORD: randomBase64Url(36),
    EXPORT_OBJECT_STORAGE_ACCESS_KEY: randomAlphaNumeric("tradehub", 12),
    EXPORT_OBJECT_STORAGE_SECRET_KEY: randomBase64Url(36),
    GRAFANA_ADMIN_PASSWORD: randomBase64Url(32),
  };
}

function buildEnvFile(secrets: GeneratedSecretSet, generatedAt: string): string {
  return [
    "# TradeHub production bootstrap secrets",
    `# Generated at ${generatedAt}`,
    "# Store securely, do not commit, and rotate after any accidental exposure.",
    "",
    `POSTGRES_USER=${secrets.POSTGRES_USER}`,
    `POSTGRES_DB=${secrets.POSTGRES_DB}`,
    `POSTGRES_PASSWORD=${secrets.POSTGRES_PASSWORD}`,
    `DATABASE_URL=${secrets.DATABASE_URL}`,
    `VALKEY_URL=${secrets.VALKEY_URL}`,
    `SESSION_SECRET=${secrets.SESSION_SECRET}`,
    `LEGAL_TERMS_HMAC_SECRET=${secrets.LEGAL_TERMS_HMAC_SECRET}`,
    `ENCRYPTION_KEY=${secrets.ENCRYPTION_KEY}`,
    `EMAIL_VERIFY_TOKEN_SECRET=${secrets.EMAIL_VERIFY_TOKEN_SECRET}`,
    `SMS_OTP_SECRET=${secrets.SMS_OTP_SECRET}`,
    `CHALLENGE_CERT_VERIFICATION_SECRET=${secrets.CHALLENGE_CERT_VERIFICATION_SECRET}`,
    `EXPORT_LOCAL_LINK_SIGNING_SECRET=${secrets.EXPORT_LOCAL_LINK_SIGNING_SECRET}`,
    `METRICS_AUTH_TOKEN=${secrets.METRICS_AUTH_TOKEN}`,
    `CLICKHOUSE_USER=${secrets.CLICKHOUSE_USER}`,
    `CLICKHOUSE_PASSWORD=${secrets.CLICKHOUSE_PASSWORD}`,
    `EXPORT_OBJECT_STORAGE_ACCESS_KEY=${secrets.EXPORT_OBJECT_STORAGE_ACCESS_KEY}`,
    `EXPORT_OBJECT_STORAGE_SECRET_KEY=${secrets.EXPORT_OBJECT_STORAGE_SECRET_KEY}`,
    `GRAFANA_ADMIN_PASSWORD=${secrets.GRAFANA_ADMIN_PASSWORD}`,
    "TWELVE_DATA_API_KEY=SET_ME",
    "RESEND_API_KEY=SET_ME",
    "TWILIO_ACCOUNT_SID=SET_ME",
    "TWILIO_AUTH_TOKEN=SET_ME",
    "TWILIO_MESSAGING_SERVICE_SID=SET_ME_OR_USE_TWILIO_FROM_NUMBER",
    "TWILIO_FROM_NUMBER=SET_ME_OPTIONAL",
    "",
  ].join("\n");
}

function buildTradehubSecretManifest(secrets: GeneratedSecretSet, generatedAt: string): string {
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: tradehub-secrets",
    "  namespace: tradehub",
    "  annotations:",
    `    tradehub.io/generated-at: "${generatedAt}"`,
    '    tradehub.io/bootstrap-only: "encrypt with SOPS before GitOps sync"',
    "type: Opaque",
    "stringData:",
    `  POSTGRES_USER: "${secrets.POSTGRES_USER}"`,
    `  POSTGRES_DB: "${secrets.POSTGRES_DB}"`,
    `  POSTGRES_PASSWORD: "${secrets.POSTGRES_PASSWORD}"`,
    `  DATABASE_URL: "${secrets.DATABASE_URL}"`,
    `  VALKEY_URL: "${secrets.VALKEY_URL}"`,
    `  SESSION_SECRET: "${secrets.SESSION_SECRET}"`,
    `  LEGAL_TERMS_HMAC_SECRET: "${secrets.LEGAL_TERMS_HMAC_SECRET}"`,
    `  ENCRYPTION_KEY: "${secrets.ENCRYPTION_KEY}"`,
    `  EMAIL_VERIFY_TOKEN_SECRET: "${secrets.EMAIL_VERIFY_TOKEN_SECRET}"`,
    `  SMS_OTP_SECRET: "${secrets.SMS_OTP_SECRET}"`,
    `  CHALLENGE_CERT_VERIFICATION_SECRET: "${secrets.CHALLENGE_CERT_VERIFICATION_SECRET}"`,
    `  EXPORT_LOCAL_LINK_SIGNING_SECRET: "${secrets.EXPORT_LOCAL_LINK_SIGNING_SECRET}"`,
    `  METRICS_AUTH_TOKEN: "${secrets.METRICS_AUTH_TOKEN}"`,
    '  TWELVE_DATA_API_KEY: "SET_ME"',
    '  FORGE_KEY: ""',
    '  RESEND_API_KEY: "SET_ME"',
    '  TWILIO_ACCOUNT_SID: "SET_ME"',
    '  TWILIO_AUTH_TOKEN: "SET_ME"',
    '  TWILIO_MESSAGING_SERVICE_SID: "SET_ME_OR_USE_TWILIO_FROM_NUMBER"',
    '  TWILIO_FROM_NUMBER: "SET_ME_OPTIONAL"',
    `  CLICKHOUSE_USER: "${secrets.CLICKHOUSE_USER}"`,
    `  CLICKHOUSE_PASSWORD: "${secrets.CLICKHOUSE_PASSWORD}"`,
    `  EXPORT_OBJECT_STORAGE_ACCESS_KEY: "${secrets.EXPORT_OBJECT_STORAGE_ACCESS_KEY}"`,
    `  EXPORT_OBJECT_STORAGE_SECRET_KEY: "${secrets.EXPORT_OBJECT_STORAGE_SECRET_KEY}"`,
    "",
  ].join("\n");
}

function buildGrafanaSecretManifest(secrets: GeneratedSecretSet, generatedAt: string): string {
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: grafana-admin",
    "  namespace: tradehub",
    "  annotations:",
    `    tradehub.io/generated-at: "${generatedAt}"`,
    '    tradehub.io/bootstrap-only: "encrypt with SOPS before GitOps sync"',
    "type: Opaque",
    "stringData:",
    '  username: "admin"',
    `  password: "${secrets.GRAFANA_ADMIN_PASSWORD}"`,
    "",
  ].join("\n");
}

function main() {
  const outDir = resolveOutDir();
  const generatedAt = new Date().toISOString();
  const secrets = buildSecrets();

  ensureDir(outDir);

  writeSecureFile(path.join(outDir, "tradehub-production-secrets.env"), buildEnvFile(secrets, generatedAt));
  writeSecureFile(path.join(outDir, "tradehub-secrets.stringData.yaml"), buildTradehubSecretManifest(secrets, generatedAt));
  writeSecureFile(path.join(outDir, "grafana-admin.stringData.yaml"), buildGrafanaSecretManifest(secrets, generatedAt));
  writeSecureFile(path.join(outDir, "tradehub-production-secrets.json"), `${JSON.stringify({ generatedAt, secrets }, null, 2)}\n`);

  process.stdout.write(`Generated bootstrap secrets in ${outDir}\n`);
}

main();
