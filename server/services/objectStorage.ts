import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Client as MinioClient } from "minio";
import { getPetascaleRuntimeConfig } from "./petascaleEnv";

type UploadedArtifact = {
  objectKey: string;
  bytesWritten: number;
  storageBackend: "minio" | "local";
};

let minioClient: MinioClient | null = null;
let minioBucketChecked = false;

function getMinioClient(): MinioClient | null {
  const cfg = getPetascaleRuntimeConfig();
  if (
    !cfg.objectStorageEnabled ||
    !cfg.objectStorageEndpoint ||
    !cfg.objectStorageAccessKey ||
    !cfg.objectStorageSecretKey
  ) {
    return null;
  }
  if (minioClient) return minioClient;
  minioClient = new MinioClient({
    endPoint: cfg.objectStorageEndpoint,
    port: cfg.objectStoragePort,
    useSSL: cfg.objectStorageUseSsl,
    accessKey: cfg.objectStorageAccessKey,
    secretKey: cfg.objectStorageSecretKey,
    region: cfg.objectStorageRegion,
  });
  return minioClient;
}

async function ensureBucketExists(client: MinioClient): Promise<void> {
  if (minioBucketChecked) return;
  const cfg = getPetascaleRuntimeConfig();
  const exists = await client.bucketExists(cfg.objectStorageBucket).catch(() => false);
  if (!exists) {
    await client.makeBucket(cfg.objectStorageBucket, cfg.objectStorageRegion);
  }
  minioBucketChecked = true;
}

function normalizeFileName(value: string): string {
  const safe = String(value || "export")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
  return safe || "export";
}

function getLocalLinkSigningSecret(): string {
  const explicit = String(process.env.EXPORT_LOCAL_LINK_SIGNING_SECRET ?? "").trim();
  if (explicit.length >= 32) return explicit;
  const legal = String(process.env.LEGAL_TERMS_HMAC_SECRET ?? "").trim();
  if (legal.length >= 32) return legal;
  const session = String(process.env.SESSION_SECRET ?? "").trim();
  if (session.length >= 32) return session;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EXPORT_LOCAL_LINK_SIGNING_SECRET (or LEGAL_TERMS_HMAC_SECRET/SESSION_SECRET >= 32 chars) is required in production",
    );
  }
  return "dev-local-link-signing-secret-not-for-production";
}

function signLocalDownloadPayload(payload: string): string {
  return crypto.createHmac("sha256", getLocalLinkSigningSecret()).update(payload).digest("hex");
}

function buildLocalDownloadPayload(params: {
  objectKey: string;
  fileName: string;
  expiresAt: number;
}): string {
  return `${params.objectKey}|${normalizeFileName(params.fileName)}|${Math.max(
    0,
    Math.trunc(params.expiresAt),
  )}`;
}

export async function uploadExportArtifact(params: {
  jobId: string;
  sourcePath: string;
  filename: string;
  contentType: string;
}): Promise<UploadedArtifact> {
  const cfg = getPetascaleRuntimeConfig();
  const stats = fs.statSync(params.sourcePath);
  const bytesWritten = Number(stats.size || 0);
  const safeName = normalizeFileName(params.filename);
  const objectKey = `${cfg.objectStoragePrefix}/${params.jobId}/${Date.now()}_${safeName}`;

  const client = getMinioClient();
  if (client) {
    await ensureBucketExists(client);
    await client.fPutObject(cfg.objectStorageBucket, objectKey, params.sourcePath, {
      "Content-Type": params.contentType,
      "Cache-Control": "private, max-age=0, no-store",
    });
    return {
      objectKey,
      bytesWritten,
      storageBackend: "minio",
    };
  }

  // Local disk fallback keeps the pipeline functional for self-hosted bootstrap.
  fs.mkdirSync(cfg.localExportDir, { recursive: true });
  const localName = `${params.jobId}-${Date.now()}-${safeName}`;
  const localPath = path.join(cfg.localExportDir, localName);
  fs.copyFileSync(params.sourcePath, localPath);
  return {
    objectKey: `local/${localName}`,
    bytesWritten,
    storageBackend: "local",
  };
}

export async function getExportDownloadLink(params: {
  objectKey: string;
  fileName: string;
}): Promise<{ url: string; expiresAt: number }> {
  const cfg = getPetascaleRuntimeConfig();
  const expiresAt = Math.floor(Date.now() / 1000) + cfg.objectStorageLinkTtlSec;

  if (params.objectKey.startsWith("local/")) {
    const normalizedName = normalizeFileName(params.fileName);
    const safeName = encodeURIComponent(normalizedName);
    const encoded = encodeURIComponent(params.objectKey);
    const payload = buildLocalDownloadPayload({
      objectKey: params.objectKey,
      fileName: normalizedName,
      expiresAt,
    });
    const sig = signLocalDownloadPayload(payload);
    return {
      url: `${cfg.localExportLinkBase}?key=${encoded}&name=${safeName}&exp=${expiresAt}&sig=${sig}`,
      expiresAt,
    };
  }

  const client = getMinioClient();
  if (!client) {
    throw new Error("Object storage is disabled and local object key is not available");
  }
  await ensureBucketExists(client);
  const signed = await client.presignedGetObject(
    cfg.objectStorageBucket,
    params.objectKey,
    cfg.objectStorageLinkTtlSec,
    {
      "response-content-disposition": `attachment; filename="${normalizeFileName(params.fileName)}"`,
    },
  );
  return { url: signed, expiresAt };
}

export function verifyLocalDownloadLink(params: {
  objectKey: string;
  fileName: string;
  expiresAt: number;
  signature: string;
}): boolean {
  const expected = signLocalDownloadPayload(
    buildLocalDownloadPayload({
      objectKey: params.objectKey,
      fileName: params.fileName,
      expiresAt: params.expiresAt,
    }),
  );
  const actual = String(params.signature || "");
  if (!expected || !actual || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function resolveLocalObjectKeyPath(objectKey: string): string | null {
  if (!objectKey.startsWith("local/")) return null;
  const cfg = getPetascaleRuntimeConfig();
  const suffix = objectKey.slice("local/".length);
  if (!suffix || suffix.includes("..") || suffix.includes("/")) return null;
  return path.join(cfg.localExportDir, suffix);
}

export async function deleteExportArtifact(objectKey: string): Promise<void> {
  if (!objectKey) return;

  if (objectKey.startsWith("local/")) {
    const localPath = resolveLocalObjectKeyPath(objectKey);
    if (!localPath) return;
    fs.rmSync(localPath, { force: true });
    return;
  }

  const client = getMinioClient();
  if (!client) return;
  const cfg = getPetascaleRuntimeConfig();
  await ensureBucketExists(client);
  await client.removeObject(cfg.objectStorageBucket, objectKey).catch(() => {});
}
