import type { Express, Request, Response } from "express";
import { requireAdmin } from "../middleware/auth";
import {
  evaluateUserRisk,
  getConfig,
  getLinkedAccounts,
  invalidateConfigCache,
  recomputeUserAggregates,
} from "../grift/griftEngine";
import type { GriftSignalStatus, GriftSeverity } from "../grift/griftTypes";
import { enrichIpAsnCacheBatch } from "../grift/griftIpAsn";
import { getIp2AsnDatasetPath, maybeImportIp2AsnDataset } from "../grift/griftIp2AsnDataset";
import { Parser } from "json2csv";
import { appendAuditEntry, getAuditLog, verifyAuditChain } from "../grift/griftAdminAudit";
import { storage } from "../storage";
import { withGriftClient } from "../grift/griftDb";
import { registerGriftOpsRoutes } from "./grift-admin/ops";
import { buildProvenance, getDb } from "./grift-admin/shared";

export function registerGriftRoutes(app: Express) {
  registerGriftOpsRoutes(app);

  app.get("/api/admin/grift/tier-counts", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const rows = await db.prepare(`
        SELECT tier, COUNT(*) as count FROM grift_user_scores GROUP BY tier
      `).all() as { tier: string; count: number }[];

      const counts: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0, CRITICAL: 0 };
      for (const row of rows) {
        counts[row.tier] = row.count;
      }

      res.json(counts);
    } catch (error) {
      console.error("Grift tier counts error:", error);
      res.status(500).json({ message: "Failed to fetch tier counts" });
    } finally {
    }
  });

  app.get("/api/admin/grift/signals", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const status = req.query.status as string | undefined;
      const ruleCode = req.query.ruleCode as string | undefined;
      const severity = req.query.severity as string | undefined;
      const userId = req.query.userId ? Number(req.query.userId) : undefined;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0));

      let sql = `
        SELECT s.*, u.username, u.email
        FROM grift_signals s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (status) {
        sql += " AND s.status = ?";
        params.push(status);
      }
      if (ruleCode) {
        sql += " AND s.rule_code = ?";
        params.push(ruleCode);
      }
      if (severity) {
        sql += " AND s.severity = ?";
        params.push(severity);
      }
      if (Number.isFinite(userId)) {
        sql += " AND (s.user_id = ? OR s.related_user_id = ?)";
        params.push(userId, userId);
      }

      sql += " ORDER BY s.created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const signals = await db.prepare(sql).all(...params);
      res.json({ signals });
    } catch (error) {
      console.error("Grift signals error:", error);
      res.status(500).json({ message: "Failed to fetch grift signals" });
    } finally {
    }
  });

  app.post("/api/admin/grift/signals/:id/close", requireAdmin, async (req: Request, res: Response) => {
    const signalId = Number(req.params.id);
    if (!signalId || isNaN(signalId)) {
      return res.status(400).json({ message: "Invalid signal ID" });
    }

    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const note = (req.body as any)?.note as string | undefined;
      const now = Date.now();

      const signal = await db.prepare(`
        SELECT user_id as userId, related_user_id as relatedUserId
        FROM grift_signals WHERE id = ?
      `).get(signalId) as { userId?: number; relatedUserId?: number } | undefined;

      await db.prepare(`
        UPDATE grift_signals
        SET status = 'CLOSED', closed_at = ?, closed_by_admin_id = ?, closure_note = ?, updated_at = ?
        WHERE id = ?
      `).run(now, adminId, note ?? null, now, signalId);

      if (signal?.userId) {
        await recomputeUserAggregates(db, signal.userId);
      }
      if (signal?.relatedUserId) {
        await recomputeUserAggregates(db, signal.relatedUserId);
      }

      await appendAuditEntry(db, adminId, "SIGNAL_CLOSE", "signal", signalId, { note });
      
      res.json({ ok: true });
    } catch (error) {
      console.error("Close signal error:", error);
      res.status(500).json({ message: "Failed to close signal" });
    } finally {
    }
  });

  app.get("/api/admin/grift/summary", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const openAlerts = (await db.prepare(`
        SELECT COUNT(*) as count FROM grift_signals WHERE status = 'OPEN'
      `).get() as any)?.count || 0;

      const highRiskUsers = (await db.prepare(`
        SELECT COUNT(*) as count FROM grift_user_scores WHERE score_current >= 50
      `).get() as any)?.count || 0;

      const linkedClusters = (await db.prepare(`
        SELECT COUNT(DISTINCT user_a) as count FROM grift_linked_account_edges
      `).get() as any)?.count || 0;

      const tierRows = await db.prepare(`
        SELECT tier, COUNT(*) as count FROM grift_user_scores GROUP BY tier
      `).all() as { tier: string; count: number }[];

      const tierCounts: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0, CRITICAL: 0 };
      for (const row of tierRows) {
        const key = row.tier === "MEDIUM" ? "MED" : row.tier;
        if (key in tierCounts) {
          tierCounts[key] = row.count;
        }
      }

      res.json({ openAlerts, highRiskUsers, linkedClusters, tierCounts });
    } catch (error) {
      console.error("Grift summary error:", error);
      res.status(500).json({ message: "Failed to fetch grift summary" });
    } finally {
    }
  });

  app.get("/api/admin/grift/alerts", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const status = req.query.status as GriftSignalStatus | undefined;
      const severity = req.query.severity as GriftSeverity | undefined;
      const userId = req.query.userId ? Number(req.query.userId) : undefined;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0));

      let sql = `
        SELECT id, rule_code, severity, points, status, user_id, related_user_id, created_at, evidence_json
        FROM grift_signals
        WHERE 1=1
      `;
      const params: any[] = [];

      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      if (severity) {
        sql += " AND severity = ?";
        params.push(severity);
      }
      if (Number.isFinite(userId)) {
        sql += " AND (user_id = ? OR related_user_id = ?)";
        params.push(userId, userId);
      }

      sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const alerts = (await db.prepare(sql).all(...params)).map((row: any) => ({
        id: row.id,
        rule_type: row.rule_code,
        severity: row.severity,
        score: row.points,
        status: row.status,
        user_id: row.user_id,
        related_user_id: row.related_user_id,
        created_at: row.created_at,
        details_json: row.evidence_json,
      }));

      res.json({ alerts });
    } catch (error) {
      console.error("Grift alerts error:", error);
      res.status(500).json({ message: "Failed to fetch grift alerts" });
    } finally {
    }
  });

  app.get("/api/admin/grift/flagged-users", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const minScore = Math.max(0, Number(req.query.minScore || 25));
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));

      const users = await db.prepare(`
        SELECT
          us.user_id,
          u.username,
          u.email,
          us.score_current,
          us.score_7d,
          us.score_30d,
          us.tier,
          us.open_signals_count,
          us.last_evaluated_at,
          us.score_current as total_score,
          us.score_7d as last_7d_score,
          us.score_30d as last_30d_score,
          us.open_signals_count as open_signal_count
        FROM grift_user_scores us
        LEFT JOIN users u ON us.user_id = u.id
        WHERE us.score_current >= ?
        ORDER BY us.score_current DESC
        LIMIT ?
      `).all(minScore, limit);

      res.json({ users });
    } catch (error) {
      console.error("Grift flagged users error:", error);
      res.status(500).json({ message: "Failed to fetch flagged users" });
    } finally {
    }
  });

  app.get("/api/admin/users/:userId/grift-profile", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const userId = Number(req.params.userId);
      if (!userId || isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const scoreRow = await db.prepare(`
        SELECT * FROM grift_user_scores WHERE user_id = ?
      `).get(userId) as any;

      const riskFactors = scoreRow ? {
        score_current: scoreRow.score_current,
        score_7d: scoreRow.score_7d,
        score_30d: scoreRow.score_30d,
        devices_7d: scoreRow.devices_7d,
        ips_7d: scoreRow.ips_7d,
        user_agents_7d: scoreRow.user_agents_7d,
        countries_7d: scoreRow.countries_7d,
        asns_7d: scoreRow.asns_7d,
        linked_accounts_30d: scoreRow.linked_accounts_30d,
        hedge_pairs_7d: scoreRow.hedge_pairs_7d,
        open_signals_count: scoreRow.open_signals_count,
        last_evaluated_at: scoreRow.last_evaluated_at,
      } : {};

      const risk = scoreRow ? {
        risk_score: scoreRow.score_current,
        risk_tier: scoreRow.tier,
        risk_factors_json: JSON.stringify(riskFactors),
      } : { risk_score: 0, risk_tier: "LOW", risk_factors_json: "[]" };

      const linkedAccounts = await db.prepare(`
        SELECT DISTINCT u.id, u.email, u.username
        FROM grift_linked_account_edges e
        JOIN users u ON u.id = CASE WHEN e.user_a = ? THEN e.user_b ELSE e.user_a END
        WHERE e.user_a = ? OR e.user_b = ?
        ORDER BY e.last_confirmed_at DESC
        LIMIT 200
      `).all(userId, userId, userId);

      const alerts = await db.prepare(`
        SELECT id, rule_code as rule_type, severity, points as score, created_at
        FROM grift_signals
        WHERE (user_id = ? OR related_user_id = ?) AND status = 'OPEN'
        ORDER BY created_at DESC
        LIMIT 20
      `).all(userId, userId);

      const signals = await db.prepare(`
        SELECT id, rule_code, points as score, status, created_at, evidence_json, related_user_id
        FROM grift_signals
        WHERE user_id = ? OR related_user_id = ?
        ORDER BY created_at DESC
        LIMIT 200
      `).all(userId, userId);

      const sessions = await db.prepare(`
        SELECT id, ip, device_fp, device_install_id, country_code, city, created_at as login_time
        FROM user_login_history
        WHERE user_id = ? AND success = 1
        ORDER BY created_at DESC
        LIMIT 200
      `).all(userId);

      const devices = await db.prepare(`
        SELECT device_fp, device_install_id,
               COUNT(*) as session_count,
               MIN(created_at) as first_seen,
               MAX(created_at) as last_seen
        FROM user_login_history
        WHERE user_id = ? AND success = 1 AND (device_fp IS NOT NULL OR device_install_id IS NOT NULL)
        GROUP BY device_fp, device_install_id
        ORDER BY last_seen DESC
        LIMIT 200
      `).all(userId);

      const ips = await db.prepare(`
        SELECT ip, country_code, city,
               COUNT(*) as session_count,
               MIN(created_at) as first_seen,
               MAX(created_at) as last_seen
        FROM user_login_history
        WHERE user_id = ? AND success = 1 AND ip IS NOT NULL
        GROUP BY ip, country_code, city
        ORDER BY last_seen DESC
        LIMIT 200
      `).all(userId);

      const enforcement = await db.prepare(`
        SELECT frozen_at, disabled_at, notes
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      res.json({
        userId,
        risk,
        linkedAccounts,
        alerts,
        signals,
        sessions,
        devices,
        ips,
        enforcement: enforcement || undefined,
      });
    } catch (error) {
      console.error("Grift profile error:", error);
      res.status(500).json({ message: "Failed to fetch grift profile" });
    } finally {
    }
  });

  app.get("/api/admin/users/:userId/linked-accounts", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const userId = Number(req.params.userId);
      if (!userId || isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const linkedAccounts = await getLinkedAccounts(db, userId);
      res.json({ linkedAccounts });
    } catch (error) {
      console.error("Linked accounts error:", error);
      res.status(500).json({ message: "Failed to fetch linked accounts" });
    } finally {
    }
  });

  app.post("/api/admin/grift/alerts/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
    const alertId = Number(req.params.id);
    if (!alertId || isNaN(alertId)) {
      return res.status(400).json({ message: "Invalid alert ID" });
    }

    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const rawStatus = String((req.body as any)?.status ?? "CLOSED").toUpperCase();
      const note = (req.body as any)?.note as string | undefined;

      let status: GriftSignalStatus;
      if (rawStatus === "RESOLVED") status = "CLOSED";
      else if (rawStatus === "DISMISSED") status = "IGNORED";
      else if (rawStatus === "IN_REVIEW") status = "IN_REVIEW";
      else if (rawStatus === "OPEN") status = "OPEN";
      else if (rawStatus === "CLOSED") status = "CLOSED";
      else if (rawStatus === "IGNORED") status = "IGNORED";
      else return res.status(400).json({ message: "Invalid status" });

      const signal = await db.prepare(`
        SELECT user_id as userId, related_user_id as relatedUserId, status as prevStatus
        FROM grift_signals WHERE id = ?
      `).get(alertId) as { userId?: number; relatedUserId?: number; prevStatus?: string } | undefined;

      if (!signal) {
        return res.status(404).json({ message: "Alert not found" });
      }

      const now = Date.now();
      if (status === "CLOSED" || status === "IGNORED") {
        await db.prepare(`
          UPDATE grift_signals
          SET status = ?, closed_at = ?, closed_by_admin_id = ?, closure_note = ?, updated_at = ?
          WHERE id = ?
        `).run(status, now, adminId, note ?? null, now, alertId);
      } else {
        await db.prepare(`
          UPDATE grift_signals
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(status, now, alertId);
      }

      if (signal.userId) {
        await recomputeUserAggregates(db, signal.userId);
      }
      if (signal.relatedUserId) {
        await recomputeUserAggregates(db, signal.relatedUserId);
      }

      const action =
        status === "IGNORED" ? "SIGNAL_IGNORE" :
        status === "IN_REVIEW" ? "SIGNAL_REVIEW" :
        status === "CLOSED" ? "SIGNAL_CLOSE" : "SIGNAL_REVIEW";
      await appendAuditEntry(db, adminId, action, "signal", alertId, {
        status,
        note,
        previousStatus: signal.prevStatus,
      });
      
      res.json({ ok: true });
    } catch (error) {
      console.error("Resolve alert error:", error);
      res.status(500).json({ message: "Failed to resolve alert" });
    } finally {
    }
  });

  app.post("/api/admin/users/:userId/evaluate-risk", requireAdmin, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const result = await evaluateUserRisk(db, userId);
      
      await appendAuditEntry(db, adminId, "RISK_REEVALUATE", "user", userId, { result });
      
      res.json(result);
    } catch (error) {
      console.error("Evaluate risk error:", error);
      res.status(500).json({ message: "Failed to evaluate risk" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // SIGNAL LIFECYCLE (IN_REVIEW, IGNORE)
// ---------------------------------------------------------------------
  app.post("/api/admin/grift/signals/:id/review", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const signalId = Number(req.params.id);
      const adminId = req.session.userId!;

      await db.prepare(`UPDATE grift_signals SET status = 'IN_REVIEW', updated_at = ? WHERE id = ?`).run(Date.now(), signalId);
      await appendAuditEntry(db, adminId, "SIGNAL_REVIEW", "signal", signalId);

      res.json({ success: true });
    } catch (error) {
      console.error("Signal review error:", error);
      res.status(500).json({ message: "Failed to set signal to review" });
    } finally {
    }
  });

  app.post("/api/admin/grift/signals/:id/ignore", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const signalId = Number(req.params.id);
      const adminId = req.session.userId!;
      const { reason } = req.body as { reason?: string };

      await db.prepare(`
        UPDATE grift_signals
        SET status = 'IGNORED', closed_at = ?, closed_by_admin_id = ?, closure_note = ?, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), adminId, reason || null, Date.now(), signalId);

      await appendAuditEntry(db, adminId, "SIGNAL_IGNORE", "signal", signalId, { reason });

      res.json({ success: true });
    } catch (error) {
      console.error("Signal ignore error:", error);
      res.status(500).json({ message: "Failed to ignore signal" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // CASES WORKFLOW
// ---------------------------------------------------------------------
  app.get("/api/admin/grift/cases", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const { status, priority, limit } = req.query;
      let sql = "SELECT * FROM grift_cases WHERE 1=1";
      const params: any[] = [];

      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      if (priority) {
        sql += " AND priority = ?";
        params.push(priority);
      }
      sql += " ORDER BY created_at DESC";
      if (limit) {
        sql += " LIMIT ?";
        params.push(parseInt(limit as string));
      }

      const cases = await db.prepare(sql).all(...params);
      res.json({ cases });
    } catch (error) {
      console.error("Cases fetch error:", error);
      res.status(500).json({ message: "Failed to fetch cases" });
    } finally {
    }
  });

  app.post("/api/admin/grift/cases", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const { title, priority, signalIds } = req.body as { title: string; priority?: string; signalIds?: number[] };
      const now = Date.now();

      const result = await db.prepare(`
        INSERT INTO grift_cases (title, priority, created_by_admin_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(title, priority || "MEDIUM", adminId, now, now);

      const caseId = Number(result.lastInsertRowid);

      if (signalIds && Array.isArray(signalIds)) {
        for (const signalId of signalIds) {
          await db.prepare(`
            INSERT INTO grift_case_signals (case_id, signal_id, added_at)
            VALUES (?, ?, ?)
            ON CONFLICT DO NOTHING
          `).run(caseId, signalId, now);
        }
      }

      await appendAuditEntry(db, adminId, "CASE_CREATE", "case", caseId, { title, priority, signalIds });

      res.status(201).json({ id: caseId });
    } catch (error) {
      console.error("Case create error:", error);
      res.status(500).json({ message: "Failed to create case" });
    } finally {
    }
  });

  app.get("/api/admin/grift/cases/:id", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const caseId = Number(req.params.id);

      const caseData = await db.prepare(`SELECT * FROM grift_cases WHERE id = ?`).get(caseId);
      if (!caseData) {
        return res.status(404).json({ message: "Case not found" });
      }

      const signals = await db.prepare(`
        SELECT s.* FROM grift_signals s
        JOIN grift_case_signals cs ON s.id = cs.signal_id
        WHERE cs.case_id = ?
      `).all(caseId);

      const notes = await db.prepare(`
        SELECT * FROM grift_case_notes WHERE case_id = ? ORDER BY created_at DESC
      `).all(caseId);

      res.json({ ...caseData, signals, notes });
    } catch (error) {
      console.error("Case fetch error:", error);
      res.status(500).json({ message: "Failed to fetch case" });
    } finally {
    }
  });

  app.put("/api/admin/grift/cases/:id", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const caseId = Number(req.params.id);
      const adminId = req.session.userId!;
      const { status, priority, assignedAdminId, resolution } = req.body as { status?: string; priority?: string; assignedAdminId?: number; resolution?: string };
      const now = Date.now();

      const updates: string[] = ["updated_at = ?"];
      const values: any[] = [now];

      if (status) {
        updates.push("status = ?");
        values.push(status);
        if (status === "CLOSED") {
          updates.push("closed_at = ?");
          values.push(now);
        }
      }
      if (priority) {
        updates.push("priority = ?");
        values.push(priority);
      }
      if (assignedAdminId !== undefined) {
        updates.push("assigned_admin_id = ?");
        values.push(assignedAdminId);
      }
      if (resolution) {
        updates.push("resolution = ?");
        values.push(resolution);
      }

      values.push(caseId);
      await db.prepare(`UPDATE grift_cases SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      await appendAuditEntry(db, adminId, "CASE_UPDATE", "case", caseId, { status, priority, assignedAdminId, resolution });

      res.json({ success: true });
    } catch (error) {
      console.error("Case update error:", error);
      res.status(500).json({ message: "Failed to update case" });
    } finally {
    }
  });

  app.post("/api/admin/grift/cases/:id/notes", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const caseId = Number(req.params.id);
      const adminId = req.session.userId!;
      const { note } = req.body as { note: string };

      const result = await db.prepare(`
        INSERT INTO grift_case_notes (case_id, admin_id, note, created_at) VALUES (?, ?, ?, ?)
      `).run(caseId, adminId, note, Date.now());

      await appendAuditEntry(db, adminId, "CASE_NOTE", "case", caseId, { note: note.substring(0, 100) });

      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
      console.error("Case note error:", error);
      res.status(500).json({ message: "Failed to add note" });
    } finally {
    }
  });

  app.post("/api/admin/grift/cases/:id/signals", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const caseId = Number(req.params.id);
      const { signalId } = req.body as { signalId: number };

      await db.prepare(`
        INSERT INTO grift_case_signals (case_id, signal_id, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT DO NOTHING
      `).run(caseId, signalId, Date.now());

      res.json({ success: true });
    } catch (error) {
      console.error("Case signal link error:", error);
      res.status(500).json({ message: "Failed to link signal" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // ENFORCEMENT ACTIONS
// ---------------------------------------------------------------------
  app.post("/api/admin/users/:userId/grift/freeze", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const userId = Number(req.params.userId);
      const adminId = req.session.userId!;
      const { notes } = req.body as { notes?: string };
      const now = Date.now();

      const existing = await db.prepare(`
        SELECT frozen_at, disabled_at
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      const oldStatus = Boolean(existing?.disabled_at)
        ? "DISABLED"
        : Boolean(existing?.frozen_at)
          ? "FROZEN"
          : "ACTIVE";

      await db.prepare(`
        INSERT INTO grift_user_enforcements (user_id, frozen_at, frozen_by_admin_id, notes)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET frozen_at = ?, frozen_by_admin_id = ?, notes = COALESCE(?, notes)
      `).run(userId, now, adminId, notes, now, adminId, notes);

      const newStatus = Boolean(existing?.disabled_at) ? "DISABLED" : "FROZEN";
      const riskScore = (await db.prepare(`
        SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
      `).get(userId) as any)?.scoreCurrent ?? null;

      await db.prepare(`
        INSERT INTO grift_enforcement_log (
          user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, "FREEZE", oldStatus, newStatus, adminId, notes ?? null, riskScore, now);

      await appendAuditEntry(db, adminId, "ENFORCEMENT_FREEZE", "user", userId, { notes, oldStatus, newStatus, riskScore });

      await storage.freezeUserAccount({
        userId,
        adminId,
        reasonCode: "GRIFT_ENFORCEMENT",
        reasonText: notes || "Grift enforcement",
        provenance: buildProvenance(req, adminId),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("User freeze error:", error);
      res.status(500).json({ message: "Failed to freeze user" });
    } finally {
    }
  });

  app.post("/api/admin/users/:userId/grift/unfreeze", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const userId = Number(req.params.userId);
      const adminId = req.session.userId!;
      const now = Date.now();

      const existing = await db.prepare(`
        SELECT frozen_at, disabled_at
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      const oldStatus = Boolean(existing?.disabled_at)
        ? "DISABLED"
        : Boolean(existing?.frozen_at)
          ? "FROZEN"
          : "ACTIVE";

      await db.prepare(`
        UPDATE grift_user_enforcements SET frozen_at = NULL, frozen_by_admin_id = NULL WHERE user_id = ?
      `).run(userId);

      const newStatus = Boolean(existing?.disabled_at) ? "DISABLED" : "ACTIVE";
      const riskScore = (await db.prepare(`
        SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
      `).get(userId) as any)?.scoreCurrent ?? null;

      await db.prepare(`
        INSERT INTO grift_enforcement_log (
          user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, "UNFREEZE", oldStatus, newStatus, adminId, "Grift enforcement removal", riskScore, now);

      await appendAuditEntry(db, adminId, "ENFORCEMENT_UNFREEZE", "user", userId, { oldStatus, newStatus, riskScore });

      await storage.unfreezeUserAccount({
        userId,
        adminId,
        reason: "Grift enforcement removal",
        provenance: buildProvenance(req, adminId),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("User unfreeze error:", error);
      res.status(500).json({ message: "Failed to unfreeze user" });
    } finally {
    }
  });

  app.post("/api/admin/users/:userId/grift/disable", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const userId = Number(req.params.userId);
      const adminId = req.session.userId!;
      const { notes } = req.body as { notes?: string };
      const now = Date.now();

      const existing = await db.prepare(`
        SELECT frozen_at, disabled_at
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      const oldStatus = Boolean(existing?.disabled_at)
        ? "DISABLED"
        : Boolean(existing?.frozen_at)
          ? "FROZEN"
          : "ACTIVE";

      await db.prepare(`
        INSERT INTO grift_user_enforcements (user_id, disabled_at, disabled_by_admin_id, notes)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET disabled_at = ?, disabled_by_admin_id = ?, notes = COALESCE(?, notes)
      `).run(userId, now, adminId, notes, now, adminId, notes);

      const newStatus = "DISABLED";
      const riskScore = (await db.prepare(`
        SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
      `).get(userId) as any)?.scoreCurrent ?? null;

      await db.prepare(`
        INSERT INTO grift_enforcement_log (
          user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, "DISABLE", oldStatus, newStatus, adminId, notes ?? null, riskScore, now);

      await appendAuditEntry(db, adminId, "ENFORCEMENT_DISABLE", "user", userId, { notes, oldStatus, newStatus, riskScore });

      await storage.setUserDisabled(userId, true, adminId, buildProvenance(req, adminId));

      res.json({ success: true });
    } catch (error) {
      console.error("User disable error:", error);
      res.status(500).json({ message: "Failed to disable user" });
    } finally {
    }
  });

  app.post("/api/admin/users/:userId/grift/enable", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const userId = Number(req.params.userId);
      const adminId = req.session.userId!;
      const now = Date.now();

      const existing = await db.prepare(`
        SELECT frozen_at, disabled_at
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      const oldStatus = Boolean(existing?.disabled_at)
        ? "DISABLED"
        : Boolean(existing?.frozen_at)
          ? "FROZEN"
          : "ACTIVE";

      await db.prepare(`
        UPDATE grift_user_enforcements SET disabled_at = NULL, disabled_by_admin_id = NULL WHERE user_id = ?
      `).run(userId);

      const newStatus = Boolean(existing?.frozen_at) ? "FROZEN" : "ACTIVE";
      const riskScore = (await db.prepare(`
        SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
      `).get(userId) as any)?.scoreCurrent ?? null;

      await db.prepare(`
        INSERT INTO grift_enforcement_log (
          user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, "ENABLE", oldStatus, newStatus, adminId, "Grift enforcement removal", riskScore, now);

      await appendAuditEntry(db, adminId, "ENFORCEMENT_ENABLE", "user", userId, { oldStatus, newStatus, riskScore });

      await storage.setUserDisabled(userId, false, adminId, buildProvenance(req, adminId));

      res.json({ success: true });
    } catch (error) {
      console.error("User enable error:", error);
      res.status(500).json({ message: "Failed to enable user" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // CSV EXPORTS
// ---------------------------------------------------------------------
  app.get("/api/admin/grift/export/signals", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const { status, ruleCode, since } = req.query;
      let sql = "SELECT * FROM grift_signals WHERE 1=1";
      const params: any[] = [];

      if (status) {
        sql += " AND status = ?";
        params.push(status);
      }
      if (ruleCode) {
        sql += " AND rule_code = ?";
        params.push(ruleCode);
      }
      if (since) {
        sql += " AND created_at >= ?";
        params.push(parseInt(since as string));
      }

      sql += " ORDER BY created_at DESC";

      const signals = await db.prepare(sql).all(...params);

      const fields = [
        "id",
        "rule_code",
        "severity",
        "user_id",
        "related_user_id",
        "points",
        "status",
        "created_at",
        "updated_at",
        "closed_at",
        "device_id",
        "device_install_id",
        "device_fp",
        "client_tz",
        "client_lang",
        "ip",
        "user_agent",
        "geo_country",
        "geo_region",
        "geo_city",
        "latitude",
        "longitude",
        "asn",
        "org",
        "symbol",
        "trade_id",
        "evidence_json",
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(signals);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=grift_signals.csv");
      res.send(csv);
    } catch (error) {
      console.error("Signal export error:", error);
      res.status(500).json({ message: "Failed to export signals" });
    } finally {
    }
  });

  app.get("/api/admin/grift/export/flagged-users", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const users = await db.prepare(`
        SELECT
          us.user_id,
          us.score_current,
          us.score_7d,
          us.score_30d,
          us.tier,
          us.open_signals_count,
          us.last_evaluated_at,
          us.score_current as total_score,
          us.score_7d as last_7d_score,
          us.score_30d as last_30d_score,
          us.open_signals_count as open_signal_count,
          u.username,
          u.email
        FROM grift_user_scores us
        LEFT JOIN users u ON us.user_id = u.id
        WHERE us.tier IN ('MED', 'MEDIUM', 'HIGH', 'CRITICAL')
        ORDER BY us.score_current DESC
      `).all();

      const fields = ["user_id", "username", "email", "total_score", "last_7d_score", "last_30d_score", "tier", "open_signal_count", "last_evaluated_at"];
      const parser = new Parser({ fields });
      const csv = parser.parse(users);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=flagged_users.csv");
      res.send(csv);
    } catch (error) {
      console.error("Flagged users export error:", error);
      res.status(500).json({ message: "Failed to export flagged users" });
    } finally {
    }
  });

  app.get("/api/admin/grift/export/observations", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const { userId, since, limit } = req.query;
      let sql = "SELECT * FROM grift_observations WHERE 1=1";
      const params: any[] = [];

      if (userId) {
        sql += " AND user_id = ?";
        params.push(parseInt(userId as string));
      }
      if (since) {
        sql += " AND observed_at >= ?";
        params.push(parseInt(since as string));
      }

      sql += " ORDER BY observed_at DESC";

      if (limit) {
        sql += " LIMIT ?";
        params.push(parseInt(limit as string));
      } else {
        sql += " LIMIT 10000";
      }

      const observations = await db.prepare(sql).all(...params);

      const fields = [
        "id",
        "user_id",
        "event_type",
        "session_id",
        "device_id",
        "device_install_id",
        "device_fp",
        "client_tz",
        "client_lang",
        "ip",
        "user_agent",
        "geo_country",
        "geo_region",
        "geo_city",
        "latitude",
        "longitude",
        "asn",
        "org",
        "observed_at",
      ];
      const parser = new Parser({ fields });
      const csv = parser.parse(observations);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=grift_observations.csv");
      res.send(csv);
    } catch (error) {
      console.error("Observations export error:", error);
      res.status(500).json({ message: "Failed to export observations" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // AUDIT LOG
// ---------------------------------------------------------------------
  app.get("/api/admin/grift/audit-log", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const { adminId, action, targetType, since, limit } = req.query;
      const logs = await getAuditLog(db, {
        adminId: adminId ? parseInt(adminId as string) : undefined,
        action: action as any,
        targetType: targetType as string,
        since: since ? parseInt(since as string) : undefined,
        limit: limit ? parseInt(limit as string) : 100,
      });
      res.json({ logs });
    } catch (error) {
      console.error("Audit log error:", error);
      res.status(500).json({ message: "Failed to fetch audit log" });
    } finally {
    }
  });

  app.get("/api/admin/grift/audit-log/verify", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const result = await verifyAuditChain(db);
      res.json(result);
    } catch (error) {
      console.error("Audit verify error:", error);
      res.status(500).json({ message: "Failed to verify audit chain" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // LINKED NETWORKS
// ---------------------------------------------------------------------
  app.get("/api/admin/grift/networks", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const edges = await db.prepare(`
        SELECT user_a, user_b, link_type, confidence FROM grift_linked_account_edges
        ORDER BY confidence DESC LIMIT 500
      `).all() as { user_a: number; user_b: number; link_type: string; confidence: number }[];

      const adjacency = new Map<number, Set<number>>();
      for (const e of edges) {
        if (!adjacency.has(e.user_a)) adjacency.set(e.user_a, new Set());
        if (!adjacency.has(e.user_b)) adjacency.set(e.user_b, new Set());
        adjacency.get(e.user_a)!.add(e.user_b);
        adjacency.get(e.user_b)!.add(e.user_a);
      }

      const visited = new Set<number>();
      const clusters: number[][] = [];

      const nodeList = Array.from(adjacency.keys());
      for (const startNode of nodeList) {
        if (visited.has(startNode)) continue;

        const cluster: number[] = [];
        const stack: number[] = [startNode];

        while (stack.length > 0) {
          const node = stack.pop()!;
          if (visited.has(node)) continue;
          visited.add(node);
          cluster.push(node);

          const neighbors = adjacency.get(node);
          if (neighbors) {
            for (const neighbor of Array.from(neighbors)) {
              if (!visited.has(neighbor)) {
                stack.push(neighbor);
              }
            }
          }
        }

        if (cluster.length > 1) {
          clusters.push(cluster);
        }
      }

      res.json({
        totalEdges: edges.length,
        clusterCount: clusters.length,
        clusters: clusters.slice(0, 20).map(c => ({
          size: c.length,
          userIds: c,
        })),
      });
    } catch (error) {
      console.error("Networks error:", error);
      res.status(500).json({ message: "Failed to fetch networks" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // IDENTITY LINKS (fingerprints / install IDs / IPs)
// ---------------------------------------------------------------------

  app.get("/api/admin/grift/identity-links", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const linkType = typeof req.query.linkType === "string" && req.query.linkType ? req.query.linkType : null;
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const minUsers = Math.max(2, Math.min(1000, Number(req.query.minUsers ?? 2) || 2));
      const limit = Math.max(10, Math.min(1000, Number(req.query.limit ?? 200) || 200));

      const where: string[] = [];
      const params: any[] = [];

      if (linkType) {
        where.push("link_type = ?");
        params.push(linkType);
      }
      if (search) {
        where.push("link_value LIKE ?");
        params.push(`%${search}%`);
      }

      const sql = `
        SELECT
          link_type,
          link_value,
          COUNT(DISTINCT user_id) as user_count,
          MAX(last_seen_at) as last_seen_at
        FROM grift_identity_links
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY link_type, link_value
        HAVING COUNT(DISTINCT user_id) >= ?
        ORDER BY user_count DESC, last_seen_at DESC
        LIMIT ?
      `;

      const rows = await db.prepare(sql).all(...params, minUsers, limit) as any[];
      res.json({ links: rows, minUsers, limit });
    } catch (error) {
      console.error("Grift identity-links error:", error);
      res.status(500).json({ message: "Failed to fetch identity links" });
    } finally {
    }
  });

  app.get("/api/admin/grift/identity-links/users", requireAdmin, async (req: Request, res: Response) => {
    const linkType = typeof req.query.linkType === "string" ? req.query.linkType : "";
    const linkValue = typeof req.query.linkValue === "string" ? req.query.linkValue : "";
    if (!linkType || !linkValue) {
      return res.status(400).json({ message: "linkType and linkValue are required" });
    }

    const db = getDb();
    try {
      const users = db
        .prepare(
          `
          SELECT
            u.id,
            u.username,
            u.email,
            MAX(l.last_seen_at) as last_seen_at
          FROM grift_identity_links l
          LEFT JOIN users u ON u.id = l.user_id
          WHERE l.link_type = ? AND l.link_value = ?
          GROUP BY u.id
          ORDER BY last_seen_at DESC
          LIMIT 200
        `
        )
        .all(linkType, linkValue);

      res.json({ linkType, linkValue, users });
    } catch (error) {
      console.error("Grift identity-links users error:", error);
      res.status(500).json({ message: "Failed to fetch identity link users" });
    } finally {
    }
  });

  app.get("/api/admin/grift/users/:userId/identity-links", requireAdmin, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const db = getDb();
    try {
      const rows = db
        .prepare(
          `
          SELECT
            l.link_type,
            l.link_value,
            l.first_seen_at,
            l.last_seen_at,
            l.occurrence_count,
            l.metadata_json,
            (
              SELECT COUNT(DISTINCT user_id)
              FROM grift_identity_links l2
              WHERE l2.link_type = l.link_type AND l2.link_value = l.link_value
            ) as user_count
          FROM grift_identity_links l
          WHERE l.user_id = ?
          ORDER BY user_count DESC, l.last_seen_at DESC
          LIMIT 500
        `
        )
        .all(userId);

      res.json({ userId, links: rows });
    } catch (error) {
      console.error("Grift user identity-links error:", error);
      res.status(500).json({ message: "Failed to fetch user identity links" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // ENFORCEMENT ACTIONS
// ---------------------------------------------------------------------
  
  app.get("/api/admin/grift/users/:userId/enforcement", requireAdmin, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const db = getDb();
    try {
      const enforcement = await db.prepare(`
        SELECT user_id, frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      const log = await db.prepare(`
        SELECT *
        FROM grift_enforcement_log
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `).all(userId);

      const status = {
        userId,
        frozenAt: enforcement?.frozen_at ?? null,
        frozenByAdminId: enforcement?.frozen_by_admin_id ?? null,
        disabledAt: enforcement?.disabled_at ?? null,
        disabledByAdminId: enforcement?.disabled_by_admin_id ?? null,
        notes: enforcement?.notes ?? null,
        isFrozen: Boolean(enforcement?.frozen_at),
        isDisabled: Boolean(enforcement?.disabled_at),
      };

      res.json({ status, log });
    } catch (error) {
      console.error("Enforcement status error:", error);
      res.status(500).json({ message: "Failed to fetch enforcement status" });
    } finally {
    }
  });

  app.post("/api/admin/grift/users/:userId/enforcement", requireAdmin, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const db = getDb();
    try {
      const adminId = req.session.userId!;
      const { action, reason } = req.body as { action: 'FREEZE' | 'UNFREEZE' | 'DISABLE' | 'ENABLE'; reason?: string };

      if (!['FREEZE', 'UNFREEZE', 'DISABLE', 'ENABLE'].includes(action)) {
        return res.status(400).json({ message: "Invalid action. Must be FREEZE, UNFREEZE, DISABLE, or ENABLE" });
      }

      const existing = await db.prepare(`
        SELECT frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
        FROM grift_user_enforcements
        WHERE user_id = ?
      `).get(userId) as any;

      const wasFrozen = Boolean(existing?.frozen_at);
      const wasDisabled = Boolean(existing?.disabled_at);
      const oldStatus = wasDisabled ? "DISABLED" : wasFrozen ? "FROZEN" : "ACTIVE";

      const now = Date.now();
      let newFrozenAt = existing?.frozen_at ?? null;
      let newFrozenBy = existing?.frozen_by_admin_id ?? null;
      let newDisabledAt = existing?.disabled_at ?? null;
      let newDisabledBy = existing?.disabled_by_admin_id ?? null;
      let newNotes = existing?.notes ?? null;
      let actionTaken = false;

      if (action === "FREEZE" && !wasFrozen) {
        newFrozenAt = now;
        newFrozenBy = adminId;
        actionTaken = true;
      } else if (action === "UNFREEZE" && wasFrozen) {
        newFrozenAt = null;
        newFrozenBy = adminId;
        actionTaken = true;
      } else if (action === "DISABLE" && !wasDisabled) {
        newDisabledAt = now;
        newDisabledBy = adminId;
        actionTaken = true;
      } else if (action === "ENABLE" && wasDisabled) {
        newDisabledAt = null;
        newDisabledBy = adminId;
        actionTaken = true;
      }

      if (reason) {
        newNotes = reason;
      }

      const newStatus = newDisabledAt ? "DISABLED" : newFrozenAt ? "FROZEN" : "ACTIVE";

      if (actionTaken) {
        await db.prepare(`
          INSERT INTO grift_user_enforcements (
            user_id, frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            frozen_at = excluded.frozen_at,
            frozen_by_admin_id = excluded.frozen_by_admin_id,
            disabled_at = excluded.disabled_at,
            disabled_by_admin_id = excluded.disabled_by_admin_id,
            notes = excluded.notes
        `).run(userId, newFrozenAt, newFrozenBy, newDisabledAt, newDisabledBy, newNotes);

        const riskScore = (await db.prepare(`
          SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
        `).get(userId) as any)?.scoreCurrent ?? null;

        await db.prepare(`
          INSERT INTO grift_enforcement_log (
            user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, action, oldStatus, newStatus, adminId, reason ?? null, riskScore, now);

        await appendAuditEntry(db, adminId, `ENFORCEMENT_${action}`, "user", userId, {
          oldStatus,
          newStatus,
          riskScore,
          reason,
        });

        const provenance = buildProvenance(req, adminId);
        if (action === "FREEZE") {
          await storage.freezeUserAccount({
            userId,
            adminId,
            reasonCode: "GRIFT_ENFORCEMENT",
            reasonText: reason || "Grift enforcement",
            provenance,
          });
        } else if (action === "UNFREEZE") {
          await storage.unfreezeUserAccount({
            userId,
            adminId,
            reason: reason || "Grift enforcement removal",
            provenance,
          });
        } else if (action === "DISABLE") {
          await storage.setUserDisabled(userId, true, adminId, provenance);
        } else if (action === "ENABLE") {
          await storage.setUserDisabled(userId, false, adminId, provenance);
        }
      }

      res.json({
        action,
        actionTaken,
        oldStatus,
        newStatus,
        frozenAt: newFrozenAt,
        disabledAt: newDisabledAt,
      });
    } catch (error) {
      console.error("Enforcement action error:", error);
      res.status(500).json({ message: "Failed to apply enforcement action" });
    } finally {
    }
  });

  app.get("/api/admin/grift/enforcement/log", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0));

      const logs = await db.prepare(`
        SELECT el.*, u.email, u.username 
        FROM grift_enforcement_log el
        LEFT JOIN users u ON el.user_id = u.id
        ORDER BY el.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      res.json({ logs });
    } catch (error) {
      console.error("Enforcement log error:", error);
      res.status(500).json({ message: "Failed to fetch enforcement log" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // DASHBOARD OVERVIEW
// ---------------------------------------------------------------------
  app.get("/api/admin/grift/overview", requireAdmin, async (_req: Request, res: Response) => {
    const db = getDb();
    try {
      const now = Date.now();
      const d7 = now - 7 * 24 * 60 * 60 * 1000;
      const d30 = now - 30 * 24 * 60 * 60 * 1000;

      const openSignalsCount = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals WHERE status = 'OPEN'
      `).get() as any)?.cnt || 0;

      const hedgePairs7d = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals 
        WHERE rule_code = 'HEDGE_PAIR' AND created_at >= ?
      `).get(d7) as any)?.cnt || 0;

      const linkedAccounts30d = (await db.prepare(`
        SELECT COUNT(DISTINCT user_a || '-' || user_b) as cnt 
        FROM grift_linked_account_edges 
        WHERE last_confirmed_at >= ?
      `).get(d30) as any)?.cnt || 0;

      const topUsersByScore = await db.prepare(`
        SELECT us.user_id, us.score_current as score_current, us.tier, u.username, u.email
        FROM grift_user_scores us
        LEFT JOIN users u ON us.user_id = u.id
        ORDER BY us.score_current DESC
        LIMIT 10
      `).all() as any[];

      const ipChurnHits7d = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals 
        WHERE rule_code = 'IP_CHURN' AND created_at >= ?
      `).get(d7) as any)?.cnt || 0;

      const uaChurnHits7d = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals 
        WHERE rule_code = 'UA_CHURN' AND created_at >= ?
      `).get(d7) as any)?.cnt || 0;

      const deviceChurnHits7d = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals 
        WHERE rule_code = 'DEVICE_CHURN' AND created_at >= ?
      `).get(d7) as any)?.cnt || 0;

      const geoVelocityHits7d = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals 
        WHERE rule_code = 'GEO_VELOCITY' AND created_at >= ?
      `).get(d7) as any)?.cnt || 0;

      const concurrentSessionsHits7d = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals 
        WHERE rule_code = 'CONCURRENT_SESSIONS' AND created_at >= ?
      `).get(d7) as any)?.cnt || 0;

      const tierRows = await db.prepare(`
        SELECT tier, COUNT(*) as count FROM grift_user_scores GROUP BY tier
      `).all() as { tier: string; count: number }[];

      const tierCounts: Record<string, number> = { LOW: 0, MED: 0, HIGH: 0, CRITICAL: 0 };
      for (const r of tierRows) {
        const key = r.tier === "MEDIUM" ? "MED" : r.tier;
        if (key in tierCounts) {
          tierCounts[key] = r.count;
        }
      }

      res.json({
        openSignalsCount,
        hedgePairs7d,
        linkedAccounts30d,
        topUsersByScore,
        ipChurnHits7d,
        uaChurnHits7d,
        deviceChurnHits7d,
        geoVelocityHits7d,
        concurrentSessionsHits7d,
        tierCounts,
      });
    } catch (error) {
      console.error("Grift overview error:", error);
      res.status(500).json({ message: "Failed to fetch grift overview" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // HEDGE PAIRS LIST
// ---------------------------------------------------------------------
  app.get("/api/admin/grift/pairs", requireAdmin, async (req: Request, res: Response) => {
    const db = getDb();
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0));

      const pairs = await db.prepare(`
        SELECT 
          s.id, s.user_id, s.related_user_id, s.evidence_json, s.created_at, s.status, s.points, s.severity, s.symbol,
          u1.username as user_username, u1.email as user_email,
          u2.username as related_username, u2.email as related_email
        FROM grift_signals s
        LEFT JOIN users u1 ON s.user_id = u1.id
        LEFT JOIN users u2 ON s.related_user_id = u2.id
        WHERE s.rule_code = 'HEDGE_PAIR'
        ORDER BY s.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset) as any[];

      const parsedPairs = pairs.map(p => {
        let evidence = {};
        try {
          evidence = p.evidence_json ? JSON.parse(p.evidence_json) : {};
        } catch {}
        return {
          id: p.id,
          userId: p.user_id,
          relatedUserId: p.related_user_id,
          userUsername: p.user_username,
          userEmail: p.user_email,
          relatedUsername: p.related_username,
          relatedEmail: p.related_email,
          symbol: p.symbol ?? (evidence && typeof evidence === 'object' ? (evidence as any).symbol : null),
          evidence,
          createdAt: p.created_at,
          status: p.status,
          points: p.points,
          severity: p.severity,
        };
      });

      const total = (await db.prepare(`
        SELECT COUNT(*) as cnt FROM grift_signals WHERE rule_code = 'HEDGE_PAIR'
      `).get() as any)?.cnt || 0;

      res.json({ pairs: parsedPairs, total, limit, offset });
    } catch (error) {
      console.error("Grift pairs error:", error);
      res.status(500).json({ message: "Failed to fetch hedge pairs" });
    } finally {
    }
  });

// ---------------------------------------------------------------------
  // FORCE RECOMPUTE USER AGGREGATES
// ---------------------------------------------------------------------
  app.post("/api/admin/grift/recompute/:userId", requireAdmin, async (req: Request, res: Response) => {
    const userId = Number(req.params.userId);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const db = getDb();
    try {
      const adminId = req.session.userId!;

      const result = await evaluateUserRisk(db, userId);

      await appendAuditEntry(db, adminId, "RISK_RECOMPUTE", "user", userId, { result });

      const updatedScore = await db.prepare(`
        SELECT user_id, score_current, score_7d, score_30d, 
               tier, open_signals_count, last_evaluated_at
        FROM grift_user_scores 
        WHERE user_id = ?
      `).get(userId) as any;

      res.json({
        success: true,
        userId,
        score: updatedScore || { score_current: result.totalScore, tier: result.tier },
        riskEvaluation: result,
      });
    } catch (error) {
      console.error("Grift recompute error:", error);
      res.status(500).json({ message: "Failed to recompute user aggregates" });
    } finally {
    }
  });
}
