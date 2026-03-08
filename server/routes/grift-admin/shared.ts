import type { Request } from "express";
import fs from "fs";
import { clampInt, toFiniteNumber } from "@shared/scalars";
import { buildAuditContext } from "../../lib/auditContext";
import type { AccountActionProvenance } from "../../lib/accountEventMirror";
import { getGriftDb } from "../../grift/griftDb";
import type { GriftDb } from "../../grift/griftDb";
import type { GriftConfig } from "../../grift/griftTypes";

export function getDb() {
  return getGriftDb();
}

export function statFileMaybe(filePath: string): { path: string; exists: boolean; size: number; mtimeMs: number | null } {
  try {
    const stat = fs.statSync(filePath);
    return { path: filePath, exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { path: filePath, exists: false, size: 0, mtimeMs: null };
  }
}

export async function getDbMaintenanceStats(db: GriftDb) {
  const nameRow = await db.query<{ db_name: string }>("SELECT current_database() AS db_name");
  const sizeRow = await db.query<{ size_bytes: string | number; size_pretty: string }>(
    "SELECT pg_database_size(current_database()) AS size_bytes, pg_size_pretty(pg_database_size(current_database())) AS size_pretty",
  );
  const statsRow = await db.query(
    `
    SELECT
      numbackends,
      xact_commit,
      xact_rollback,
      blks_read,
      blks_hit,
      tup_returned,
      tup_fetched,
      tup_inserted,
      tup_updated,
      tup_deleted,
      conflicts,
      deadlocks
    FROM pg_stat_database
    WHERE datname = current_database()
  `,
  );

  const dbName = nameRow.rows[0]?.db_name ?? "unknown";
  const sizeBytesRaw = sizeRow.rows[0]?.size_bytes ?? 0;
  const sizeBytes = typeof sizeBytesRaw === "string" ? Number(sizeBytesRaw) : Number(sizeBytesRaw);
  const sizePretty = sizeRow.rows[0]?.size_pretty ?? "";

  return {
    engine: "postgres",
    database: {
      name: dbName,
      sizeBytes,
      sizePretty,
      stats: statsRow.rows[0] ?? null,
    },
    generatedAt: Date.now(),
  };
}

function clampBoolInt(value: unknown): number | null {
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  if (value === false || value === 0 || value === "0" || value === "false") return 0;
  return null;
}

export function sanitizeConfigPatch(input: unknown): Partial<GriftConfig> {
  const body = (input && typeof input === "object" ? (input as Record<string, unknown>) : {}) as Record<string, unknown>;
  const out: Partial<GriftConfig> = {};

  const setInt = (key: keyof GriftConfig, min: number, max: number) => {
    const v = body[key as string];
    if (v === undefined) return;
    const n = clampInt(v, min, max, "round");
    if (n == null) return;
    (out as any)[key] = n;
  };
  const setBool = (key: keyof GriftConfig) => {
    const v = body[key as string];
    if (v === undefined) return;
    const n = clampBoolInt(v);
    if (n == null) return;
    (out as any)[key] = n;
  };

  setBool("enabled");

  setInt("multiAccountWindowDays", 1, 365);
  setInt("churnWindowHours", 1, 168);
  setInt("hedgeWindowMinutes", 1, 240);
  setInt("concurrentWindowMinutes", 1, 120);

  setInt("ipUniqueThreshold", 2, 100);
  setInt("uaUniqueThreshold", 2, 100);
  setInt("deviceUniqueThreshold", 2, 50);
  setInt("asnUniqueThreshold", 2, 100);

  setInt("geoVelocityKmhThreshold", 200, 2500);
  setInt("geoVelocityMinDistanceKm", 50, 20000);
  setInt("geoVelocityMaxHours", 1, 48);

  setBool("hedgeRequireDeviceMatch");
  setBool("hedgeAllowIpMatch");

  setInt("tierMed", 0, 100);
  setInt("tierHigh", 0, 100);
  setInt("tierCritical", 0, 100);

  setInt("scoreMultiAccountDevice", 0, 100);
  setInt("scoreMultiAccountFingerprint", 0, 100);
  setInt("scoreHedgePair", 0, 100);
  setInt("scoreIpChurn", 0, 100);
  setInt("scoreUaChurn", 0, 100);
  setInt("scoreDeviceChurn", 0, 100);
  setInt("scoreGeoVelocity", 0, 100);
  setInt("scoreConcurrentSessions", 0, 100);
  setInt("scoreAsnVolatility", 0, 100);
  setInt("scoreSharedIpAsnCluster", 0, 100);
  setInt("scoreMultiAccountLaddering", 0, 100);

  setInt("clusterMinUsersForIpAsn", 2, 1000);
  setInt("ladderingWindowDays", 1, 365);
  setInt("ladderingMinSequence", 2, 100);

  setInt("mitigationMfa", 0, 100);
  setInt("mitigationKycApproved", 0, 100);

  setInt("enforcementFreezeThreshold", 0, 100);
  setInt("enforcementDisableThreshold", 0, 100);
  setBool("enforcementAutoFreeze");
  setBool("enforcementAutoDisable");

  setInt("retentionObservationsDays", 7, 3650);
  setInt("retentionTradeObservationsDays", 7, 3650);
  setInt("retentionAuthEventsDays", 7, 3650);
  setInt("retentionIpAsnCacheDays", 30, 3650);

  return out;
}

export function buildProvenance(req: Request, actorUserId?: number): AccountActionProvenance {
  const ctx = buildAuditContext(req);
  const resolvedActorUserId =
    typeof actorUserId === "number" && Number.isFinite(actorUserId)
      ? actorUserId
      : typeof ctx.actorUserId === "number" && Number.isFinite(ctx.actorUserId)
        ? ctx.actorUserId
        : undefined;
  return {
    actorType: ctx.actorType,
    actorUserId: resolvedActorUserId,
    sessionId: ctx.sessionId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

export function toFiniteNumberOrNull(value: unknown): number | null {
  return toFiniteNumber(value);
}
