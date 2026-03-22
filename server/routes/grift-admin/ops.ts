import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { clampInt } from "@shared/scalars";
import { requireAdmin } from "../../middleware/auth";
import { getConfig, invalidateConfigCache } from "../../grift/griftEngine";
import { enrichIpAsnCacheBatch } from "../../grift/griftIpAsn";
import { getIp2AsnDatasetPath, maybeImportIp2AsnDataset } from "../../grift/griftIp2AsnDataset";
import { appendAuditEntry } from "../../grift/griftAdminAudit";
import { withGriftClient } from "../../grift/griftDb";
import { publishLiveEvent } from "../../services/liveBus";
import { getGriftEffectiveConfigState } from "../../services/runtimeConfig/griftConfig";
import { getDb, getDbMaintenanceStats, sanitizeConfigPatch } from "./shared";

export function registerGriftOpsRoutes(app: Express) {
  app.get("/api/admin/grift/ip2asn/status", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const datasetPath = getIp2AsnDatasetPath();
      let file: { path: string; name: string; size: number; mtimeMs: number } | null = null;
      if (datasetPath && fs.existsSync(datasetPath)) {
        const stat = fs.statSync(datasetPath);
        file = { path: datasetPath, name: path.basename(datasetPath), size: stat.size, mtimeMs: stat.mtimeMs };
      }

      const meta = await db
        .prepare(
          `
          SELECT *
          FROM grift_ip_asn_dataset_meta
          WHERE id = 1
        `,
        )
        .get() as any | undefined;

      const ranges = await db
        .prepare(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN ip_version = 4 THEN 1 ELSE 0 END) AS v4,
            SUM(CASE WHEN ip_version = 6 THEN 1 ELSE 0 END) AS v6
          FROM grift_ip_asn_ranges
        `,
        )
        .get() as any;

      const cache = await db
        .prepare(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN asn IS NULL AND org IS NULL THEN 1 ELSE 0 END) AS missing
          FROM grift_ip_asn_cache
        `,
        )
        .get() as any;

      const metaMatchesFile =
        !!meta &&
        !!file &&
        String(meta.file_path) === String(file.path) &&
        Number(meta.file_mtime_ms) === Number(file.mtimeMs) &&
        Number(meta.file_size) === Number(file.size);

      res.json({ datasetPath, file, meta: meta ?? null, metaMatchesFile, ranges, cache });
    } catch (error) {
      console.error("Grift ip2asn status error:", error);
      res.status(500).json({ message: "Failed to fetch ip2asn status" });
    }
  });

  app.post("/api/admin/grift/ip2asn/reimport", requireAdmin, async (req: Request, res: Response) => {
    try {
      await withGriftClient(async (db) => {
        const adminId = req.session.userId!;
        const datasetPath = getIp2AsnDatasetPath();
        if (!datasetPath || !fs.existsSync(datasetPath)) {
          res.status(404).json({ message: "ip2asn dataset TSV not found", datasetPath });
          return;
        }

        const result = await maybeImportIp2AsnDataset(db, { filePath: datasetPath, force: true });
        await appendAuditEntry(db, adminId, "IP2ASN_REIMPORT", "ip2asn", 1, { datasetPath, result });

        res.json({ datasetPath, result });
      });
    } catch (error) {
      console.error("Grift ip2asn reimport error:", error);
      res.status(500).json({ message: "Failed to reimport ip2asn dataset" });
    }
  });

  app.post("/api/admin/grift/ip2asn/enrich", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const limit = clampInt((req.body as any)?.limit, 1, 200) ?? 50;
      const lookbackHours = clampInt((req.body as any)?.lookbackHours, 1, 168) ?? 24;
      const result = await enrichIpAsnCacheBatch(db, { limit, lookbackMs: lookbackHours * 60 * 60 * 1000 });
      await appendAuditEntry(db, adminId, "IP2ASN_ENRICH", "ip2asn", 1, { limit, lookbackHours, result });
      res.json({ limit, lookbackHours, result });
    } catch (error) {
      console.error("Grift ip2asn enrich error:", error);
      res.status(500).json({ message: "Failed to run ip2asn enrich batch" });
    }
  });

  app.get("/api/admin/grift/maintenance/db-stats", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const stats = await getDbMaintenanceStats(db);
      res.json({ stats });
    } catch (error) {
      console.error("Grift db-stats error:", error);
      res.status(500).json({ message: "Failed to read database stats" });
    }
  });

  app.post("/api/admin/grift/maintenance/checkpoint", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const modeRaw = (req.body as any)?.mode;
      const mode = typeof modeRaw === "string" ? modeRaw.toUpperCase() : "DEFAULT";
      const before = await getDbMaintenanceStats(db);
      let checkpointResult: any = null;
      let skipped: { reason: string } | null = null;

      try {
        await db.query("CHECKPOINT");
        checkpointResult = { ok: true };
      } catch (err: any) {
        skipped = { reason: err?.message || "CHECKPOINT not permitted" };
      }

      const after = await getDbMaintenanceStats(db);
      await appendAuditEntry(db, adminId, "MAINTENANCE_WAL_CHECKPOINT", "maintenance", 1, {
        mode,
        skipped,
        checkpointResult,
        before,
        after,
      });

      res.json({ mode, skipped, checkpointResult, before, after });
    } catch (error) {
      console.error("Grift checkpoint error:", error);
      res.status(500).json({ message: "Failed to checkpoint database" });
    }
  });

  app.post("/api/admin/grift/maintenance/vacuum", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const confirm = (req.body as any)?.confirm;
      if (confirm !== "VACUUM") {
        return res.status(400).json({
          message: "Confirmation required to run VACUUM",
          hint: "Send JSON body: { \"confirm\": \"VACUUM\" }",
        });
      }

      const checkpointFirst = (req.body as any)?.checkpointFirst !== false;
      const before = await getDbMaintenanceStats(db);

      let checkpointResult: any = null;
      if (checkpointFirst) {
        try {
          await db.query("CHECKPOINT");
          checkpointResult = { ok: true };
        } catch (error) {
          checkpointResult = { error: String((error as any)?.message ?? error) };
        }
      }

      const startedAt = Date.now();
      await db.query("VACUUM");
      const durationMs = Date.now() - startedAt;

      const after = await getDbMaintenanceStats(db);

      await appendAuditEntry(db, adminId, "MAINTENANCE_VACUUM", "maintenance", 1, {
        durationMs,
        checkpointFirst,
        checkpointResult,
        before,
        after,
      });

      res.json({ durationMs, checkpointFirst, checkpointResult, before, after });
    } catch (error) {
      console.error("Grift vacuum error:", error);
      res.status(500).json({ message: "Failed to VACUUM database" });
    }
  });

  app.get("/api/admin/grift/config", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const config = await getConfig(db);
      const effective = await getGriftEffectiveConfigState(db);
      res.json({ config, effective, engineCaps: effective.engineCaps });
    } catch (error) {
      console.error("Grift config error:", error);
      res.status(500).json({ message: "Failed to fetch grift config" });
    }
  });

  app.get("/api/admin/grift/config/effective", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const effective = await getGriftEffectiveConfigState(db);
      res.json({ ok: true, ...effective });
    } catch (error) {
      console.error("Grift config effective error:", error);
      res.status(500).json({ message: "Failed to fetch effective grift config" });
    }
  });

  app.put("/api/admin/grift/config", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const updates = sanitizeConfigPatch(req.body);
      const next = { ...(await getConfig(db)), ...updates };
      const errors: string[] = [];
      if (!(next.tierMed <= next.tierHigh && next.tierHigh <= next.tierCritical)) {
        errors.push("Tier thresholds must be ordered: tierMed <= tierHigh <= tierCritical");
      }
      if (next.enforcementFreezeThreshold > next.enforcementDisableThreshold) {
        errors.push("Enforcement thresholds must be ordered: freeze <= disable");
      }
      {
        const requiredObsDays = Math.max(7, next.multiAccountWindowDays, Math.ceil(next.churnWindowHours / 24));
        if (next.retentionObservationsDays < requiredObsDays) {
          errors.push(`retentionObservationsDays must be >= ${requiredObsDays} to preserve detection windows`);
        }

        const requiredTradeDays = Math.max(7, next.ladderingWindowDays);
        if (next.retentionTradeObservationsDays < requiredTradeDays) {
          errors.push(`retentionTradeObservationsDays must be >= ${requiredTradeDays} to preserve laddering windows`);
        }

        const requiredAuthDays = Math.max(7, next.multiAccountWindowDays);
        if (next.retentionAuthEventsDays < requiredAuthDays) {
          errors.push(`retentionAuthEventsDays must be >= ${requiredAuthDays} to preserve multi-account windows`);
        }

        if (next.retentionIpAsnCacheDays < 30) {
          errors.push("retentionIpAsnCacheDays must be >= 30 days");
        }
      }
      if (errors.length > 0) {
        return res.status(400).json({ message: "Invalid configuration", errors });
      }

      const allowedFields = [
        "enabled",
        "multiAccountWindowDays", "churnWindowHours", "hedgeWindowMinutes", "concurrentWindowMinutes",
        "ipUniqueThreshold", "uaUniqueThreshold", "deviceUniqueThreshold", "asnUniqueThreshold",
        "geoVelocityKmhThreshold", "geoVelocityMinDistanceKm", "geoVelocityMaxHours",
        "hedgeRequireDeviceMatch", "hedgeAllowIpMatch",
        "tierMed", "tierHigh", "tierCritical",
        "scoreMultiAccountDevice", "scoreMultiAccountFingerprint", "scoreHedgePair", "scoreIpChurn", "scoreUaChurn", "scoreDeviceChurn",
        "scoreGeoVelocity", "scoreConcurrentSessions", "scoreAsnVolatility",
        "scoreSharedIpAsnCluster", "scoreMultiAccountLaddering",
        "clusterMinUsersForIpAsn", "ladderingWindowDays", "ladderingMinSequence",
        "mitigationMfa", "mitigationKycApproved",
        "enforcementFreezeThreshold", "enforcementDisableThreshold",
        "enforcementAutoFreeze", "enforcementAutoDisable",
        "retentionObservationsDays", "retentionTradeObservationsDays", "retentionAuthEventsDays", "retentionIpAsnCacheDays",
      ];

      const fieldMap: Record<string, string> = {
        enabled: "enabled",
        multiAccountWindowDays: "multi_account_window_days",
        churnWindowHours: "churn_window_hours",
        hedgeWindowMinutes: "hedge_window_minutes",
        concurrentWindowMinutes: "concurrent_window_minutes",
        ipUniqueThreshold: "ip_unique_threshold",
        uaUniqueThreshold: "ua_unique_threshold",
        deviceUniqueThreshold: "device_unique_threshold",
        asnUniqueThreshold: "asn_unique_threshold",
        geoVelocityKmhThreshold: "geo_velocity_kmh_threshold",
        geoVelocityMinDistanceKm: "geo_velocity_min_distance_km",
        geoVelocityMaxHours: "geo_velocity_max_hours",
        hedgeRequireDeviceMatch: "hedge_require_device_match",
        hedgeAllowIpMatch: "hedge_allow_ip_match",
        tierMed: "tier_med",
        tierHigh: "tier_high",
        tierCritical: "tier_critical",
        scoreMultiAccountDevice: "score_multi_account_device",
        scoreMultiAccountFingerprint: "score_multi_account_fingerprint",
        scoreHedgePair: "score_hedge_pair",
        scoreIpChurn: "score_ip_churn",
        scoreUaChurn: "score_ua_churn",
        scoreDeviceChurn: "score_device_churn",
        scoreGeoVelocity: "score_geo_velocity",
        scoreConcurrentSessions: "score_concurrent_sessions",
        scoreAsnVolatility: "score_asn_volatility",
        scoreSharedIpAsnCluster: "score_shared_ip_asn_cluster",
        scoreMultiAccountLaddering: "score_multi_account_laddering",
        clusterMinUsersForIpAsn: "cluster_min_users_for_ip_asn",
        ladderingWindowDays: "laddering_window_days",
        ladderingMinSequence: "laddering_min_sequence",
        mitigationMfa: "mitigation_mfa",
        mitigationKycApproved: "mitigation_kyc_approved",
        enforcementFreezeThreshold: "enforcement_freeze_threshold",
        enforcementDisableThreshold: "enforcement_disable_threshold",
        enforcementAutoFreeze: "enforcement_auto_freeze",
        enforcementAutoDisable: "enforcement_auto_disable",
        retentionObservationsDays: "retention_observations_days",
        retentionTradeObservationsDays: "retention_trade_observations_days",
        retentionAuthEventsDays: "retention_auth_events_days",
        retentionIpAsnCacheDays: "retention_ip_asn_cache_days",
      };

      const setClauses: string[] = [];
      const values: any[] = [];
      const filteredUpdates: Partial<any> = {};

      for (const field of allowedFields) {
        const raw = updates[field as keyof typeof updates];
        if (raw === undefined) continue;
        const value = raw;
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const column = fieldMap[field];
        if (!column) continue;
        setClauses.push(`${column} = ?`);
        values.push(value);
        (filteredUpdates as any)[field] = value;
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ message: "No valid config fields provided" });
      }

      setClauses.push("updated_at = ?");
      values.push(Date.now());
      setClauses.push("updated_by_admin_id = ?");
      values.push(adminId);
      values.push(1);

      await db.prepare(`UPDATE grift_config SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
      invalidateConfigCache();
      const updatedConfig = await getConfig(db);
      await appendAuditEntry(db, adminId, "CONFIG_UPDATE", "config", 1, filteredUpdates);
      publishLiveEvent({
        type: "grift-config:updated",
        payload: {
          updatedAt: Date.now(),
          patchKeys: Object.keys(filteredUpdates),
        },
      });

      const effective = await getGriftEffectiveConfigState(db);
      res.json({ config: updatedConfig, effective, engineCaps: effective.engineCaps });
    } catch (error) {
      console.error("Grift config update error:", error);
      res.status(500).json({ message: "Failed to update grift config" });
    }
  });
}
