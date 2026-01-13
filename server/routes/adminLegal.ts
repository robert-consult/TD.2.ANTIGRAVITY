import { Router, Request, Response } from "express";
import { z } from "zod";
import { dbClient } from "@db";
import { sha256 } from "../legal/cryptoUtils";
import { getCoverageStats, isEnforcementEnabled, setEnforcementEnabled } from "../legal/coverageGate";
import { REGIONS } from "../legal/regionRules";

const router = Router();

// Admin auth middleware (applied to all routes)
router.use((req: Request, res: Response, next) => {
  if (!(req as any).session?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
});

const LEGACY_DOC_SET = "DOC1";
const LEGACY_DOC_TYPES = ["GLOBAL_MASTER_TERMS", "REGION_ADDENDUM", "COUNTRY_ADDENDUM"] as const;

type LegacyDocType = (typeof LEGACY_DOC_TYPES)[number];
type JurisdictionType = "DEFAULT" | "REGION" | "COUNTRY";

function normalizeLegacyDocType(value: unknown): LegacyDocType | null {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase();
  return LEGACY_DOC_TYPES.includes(raw as LegacyDocType) ? (raw as LegacyDocType) : null;
}

function parseLegacyScopeKey(scopeKey?: string): { jurisdictionType: JurisdictionType; jurisdictionKey: string } | null {
  if (!scopeKey) return null;
  const trimmed = String(scopeKey).trim();
  if (!trimmed) return null;

  const parts = trimmed.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { jurisdictionType: "DEFAULT", jurisdictionKey: parts[0].toUpperCase() };
  }

  const type = parts[0].toUpperCase();
  const key = parts.slice(1).join("/").trim();
  if (!key) return null;

  if (type !== "DEFAULT" && type !== "REGION" && type !== "COUNTRY") {
    return { jurisdictionType: "DEFAULT", jurisdictionKey: trimmed.toUpperCase() };
  }

  return { jurisdictionType: type as JurisdictionType, jurisdictionKey: key.toUpperCase() };
}

function resolveLegacyTarget(docType: LegacyDocType, scopeKey: string) {
  const parsed = parseLegacyScopeKey(scopeKey);
  let jurisdictionType: JurisdictionType = parsed?.jurisdictionType ?? "DEFAULT";
  let jurisdictionKey = parsed?.jurisdictionKey ?? "GLOBAL";

  if (docType === "GLOBAL_MASTER_TERMS") jurisdictionType = "DEFAULT";
  if (docType === "REGION_ADDENDUM") jurisdictionType = "REGION";
  if (docType === "COUNTRY_ADDENDUM") jurisdictionType = "COUNTRY";

  return {
    docSet: LEGACY_DOC_SET,
    docType: docType === "GLOBAL_MASTER_TERMS" ? "GLOBAL_MASTER" : "ADDENDUM",
    jurisdictionType,
    jurisdictionKey,
  };
}

function legacyDocTypeFromTarget(docType: string, jurisdictionType: string): LegacyDocType {
  if (docType === "GLOBAL_MASTER") return "GLOBAL_MASTER_TERMS";
  if (jurisdictionType === "COUNTRY") return "COUNTRY_ADDENDUM";
  return "REGION_ADDENDUM";
}

function legacyScopeKeyFromTarget(jurisdictionType: string, jurisdictionKey: string): string {
  return `${String(jurisdictionType).toUpperCase()}/${String(jurisdictionKey).toUpperCase()}`;
}

function toUnixSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function formatLegacyDoc(row: any) {
  const docType = legacyDocTypeFromTarget(row.doc_type, row.jurisdiction_type);
  const scopeKey = legacyScopeKeyFromTarget(row.jurisdiction_type, row.jurisdiction_key);
  return {
    id: row.id,
    doc_type: docType,
    scope_key: scopeKey,
    version: row.version,
    locale: row.locale ?? "en",
    title: row.title ?? "",
    body: row.content,
    content_hash: row.sha256,
    is_active: row.active_document_id === row.id,
    created_by: row.created_by_admin_user_id ?? null,
    created_at: toUnixSeconds(row.created_at),
    updated_by: row.updated_by_admin_user_id ?? null,
    updated_at: toUnixSeconds(row.updated_at),
    activated_by: row.activated_by ?? null,
    activated_at: toUnixSeconds(row.activated_at),
  };
}

function appendFilter(
  clauses: string[],
  params: any[],
  sql: string,
  value: any,
) {
  clauses.push(`${sql} $${params.length + 1}`);
  params.push(value);
}

// ==================== DOCUMENTS CRUD ====================

// GET /api/admin/legal-docs - List all documents with pagination
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const docType = normalizeLegacyDocType(req.query.docType as string);
    const scopeKey = parseLegacyScopeKey(req.query.scopeKey as string | undefined);

    const clauses = ["d.doc_set = $1"];
    const params: any[] = [LEGACY_DOC_SET];

    if (docType) {
      const mapped = resolveLegacyTarget(docType, scopeKey?.jurisdictionKey ? `${scopeKey.jurisdictionType}/${scopeKey.jurisdictionKey}` : "DEFAULT/GLOBAL");
      appendFilter(clauses, params, "d.doc_type =", mapped.docType);
      appendFilter(clauses, params, "d.jurisdiction_type =", mapped.jurisdictionType);
    }

    if (scopeKey) {
      appendFilter(clauses, params, "d.jurisdiction_type =", scopeKey.jurisdictionType);
      appendFilter(clauses, params, "d.jurisdiction_key =", scopeKey.jurisdictionKey);
    }

    const whereSql = clauses.join(" AND ");

    const docsRes = await dbClient.query(
      `
      SELECT d.*, p.active_document_id, p.updated_at AS activated_at, p.updated_by_admin_user_id AS activated_by
      FROM legal_documents d
      LEFT JOIN legal_doc_pointers p
        ON p.doc_set = d.doc_set
       AND p.doc_type = d.doc_type
       AND p.jurisdiction_type = d.jurisdiction_type
       AND p.jurisdiction_key = d.jurisdiction_key
      WHERE ${whereSql}
      ORDER BY d.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );

    const totalRes = await dbClient.query(
      `SELECT COUNT(*)::int AS count FROM legal_documents d WHERE ${whereSql}`,
      params,
    );

    const total = totalRes.rows[0]?.count ?? 0;

    res.json({
      documents: docsRes.rows.map(formatLegacyDoc),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[AdminLegal] Error listing documents:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/legal-docs/:id - Get single document
router.get("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid document id" });

  const result = await dbClient.query(
    `
    SELECT d.*, p.active_document_id, p.updated_at AS activated_at, p.updated_by_admin_user_id AS activated_by
    FROM legal_documents d
    LEFT JOIN legal_doc_pointers p
      ON p.doc_set = d.doc_set
     AND p.doc_type = d.doc_type
     AND p.jurisdiction_type = d.jurisdiction_type
     AND p.jurisdiction_key = d.jurisdiction_key
    WHERE d.id = $1
    `,
    [id],
  );

  const doc = result.rows[0];
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.json(formatLegacyDoc(doc));
});

// POST /api/admin/legal-docs - Create new document
router.post("/", async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      docType: z.enum(["GLOBAL_MASTER_TERMS", "REGION_ADDENDUM", "COUNTRY_ADDENDUM"]),
      scopeKey: z.string().min(1),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      locale: z.string().default("en"),
      title: z.string().min(1),
      body: z.string().min(1),
    });

    const data = schema.parse(req.body);
    const target = resolveLegacyTarget(data.docType, data.scopeKey);

    if (!target.jurisdictionKey) {
      return res.status(400).json({ error: "Invalid scopeKey" });
    }

    const contentHash = sha256(data.body);
    const adminId = (req as any).session.userId;
    const nowMs = Date.now();

    const insertRes = await dbClient.query(
      `
      INSERT INTO legal_documents
        (doc_set, doc_type, jurisdiction_type, jurisdiction_key, version, sha256, content, notes, title, locale, created_at, created_by_admin_user_id)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        target.docSet,
        target.docType,
        target.jurisdictionType,
        target.jurisdictionKey,
        data.version,
        contentHash,
        data.body,
        null,
        data.title,
        data.locale,
        nowMs,
        adminId,
      ],
    );

    const doc = insertRes.rows[0];

    await dbClient.query(
      `
      INSERT INTO legal_doc_change_audit (doc_id, action, changed_by, changed_at, new_value)
      VALUES ($1, 'CREATED', $2, $3, $4)
      `,
      [doc.id, adminId, Math.floor(nowMs / 1000), JSON.stringify(data)],
    );

    res.status(201).json(formatLegacyDoc({ ...doc, active_document_id: null, activated_at: null, activated_by: null }));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues });
    console.error("[AdminLegal] Error creating document:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/legal-docs/:id - Update document
router.patch("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid document id" });

  const result = await dbClient.query(
    `
    SELECT d.*, p.active_document_id
    FROM legal_documents d
    LEFT JOIN legal_doc_pointers p
      ON p.doc_set = d.doc_set
     AND p.doc_type = d.doc_type
     AND p.jurisdiction_type = d.jurisdiction_type
     AND p.jurisdiction_key = d.jurisdiction_key
    WHERE d.id = $1
    `,
    [id],
  );
  const doc = result.rows[0];
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.active_document_id === doc.id) return res.status(400).json({ error: "Cannot edit active document" });

  const schema = z.object({
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  });

  const data = schema.parse(req.body);
  const adminId = (req as any).session.userId;
  const nowMs = Date.now();

  const nextContent = data.body ?? doc.content;
  const newHash = sha256(nextContent);

  const updatedRes = await dbClient.query(
    `
    UPDATE legal_documents
    SET title = COALESCE($1, title),
        content = COALESCE($2, content),
        version = COALESCE($3, version),
        sha256 = $4,
        updated_at = $5,
        updated_by_admin_user_id = $6
    WHERE id = $7
    RETURNING *
    `,
    [data.title ?? null, data.body ?? null, data.version ?? null, newHash, nowMs, adminId, id],
  );

  await dbClient.query(
    `
    INSERT INTO legal_doc_change_audit (doc_id, action, changed_by, changed_at, previous_value, new_value)
    VALUES ($1, 'UPDATED', $2, $3, $4, $5)
    `,
    [id, adminId, Math.floor(nowMs / 1000), JSON.stringify(formatLegacyDoc(doc)), JSON.stringify(data)],
  );

  const updated = updatedRes.rows[0];
  res.json(formatLegacyDoc({ ...updated, active_document_id: doc.active_document_id }));
});

// POST /api/admin/legal-docs/:id/activate - Activate document
router.post("/:id/activate", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid document id" });

  const result = await dbClient.query(
    `SELECT * FROM legal_documents WHERE id = $1`,
    [id],
  );
  const doc = result.rows[0];
  if (!doc) return res.status(404).json({ error: "Document not found" });

  const adminId = (req as any).session.userId;
  const nowMs = Date.now();

  const pointerRes = await dbClient.query(
    `
    SELECT id FROM legal_doc_pointers
    WHERE doc_set = $1 AND doc_type = $2 AND jurisdiction_type = $3 AND jurisdiction_key = $4
    `,
    [doc.doc_set, doc.doc_type, doc.jurisdiction_type, doc.jurisdiction_key],
  );

  if (pointerRes.rows[0]?.id) {
    await dbClient.query(
      `
      UPDATE legal_doc_pointers
      SET active_document_id = $1, updated_at = $2, updated_by_admin_user_id = $3
      WHERE id = $4
      `,
      [doc.id, nowMs, adminId, pointerRes.rows[0].id],
    );
  } else {
    await dbClient.query(
      `
      INSERT INTO legal_doc_pointers
        (doc_set, doc_type, jurisdiction_type, jurisdiction_key, active_document_id, updated_at, updated_by_admin_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [doc.doc_set, doc.doc_type, doc.jurisdiction_type, doc.jurisdiction_key, doc.id, nowMs, adminId],
    );
  }

  await dbClient.query(
    `
    INSERT INTO legal_doc_change_audit (doc_id, action, changed_by, changed_at)
    VALUES ($1, 'ACTIVATED', $2, $3)
    `,
    [doc.id, adminId, Math.floor(nowMs / 1000)],
  );

  res.json({ success: true, message: "Document activated and set as target" });
});

// ==================== TARGETS ====================

// GET /api/admin/legal-docs/targets - List all targets (pointers)
router.get("/targets/list", async (_req: Request, res: Response) => {
  try {
    const result = await dbClient.query(
      `
      SELECT p.*, d.doc_set, d.doc_type, d.jurisdiction_type, d.jurisdiction_key, d.version
      FROM legal_doc_pointers p
      LEFT JOIN legal_documents d ON p.active_document_id = d.id
      ORDER BY p.doc_set, p.jurisdiction_type, p.jurisdiction_key
      `,
    );

    const targets = result.rows.map((row) => ({
      ...row,
      doc_title: row.doc_set && row.doc_type && row.jurisdiction_type && row.jurisdiction_key
        ? `${row.doc_set}/${row.doc_type}/${row.jurisdiction_type}/${row.jurisdiction_key}`
        : null,
      doc_version: row.version ?? null,
      doc_type: row.doc_type ? legacyDocTypeFromTarget(row.doc_type, row.jurisdiction_type) : null,
    }));

    res.json({ ok: true, targets });
  } catch (err: any) {
    res.json({ ok: false, error: err.message, targets: [] });
  }
});

// ==================== ACCEPTANCES ====================

// GET /api/admin/legal-acceptances - List acceptances with pagination
router.get("/acceptances/list", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const userId = req.query.userId ? Number(req.query.userId) : null;

    const clauses = [] as string[];
    const params: any[] = [];

    if (userId && Number.isFinite(userId)) {
      clauses.push(`a.user_id = $${params.length + 1}`);
      params.push(userId);
    }

    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const acceptancesRes = await dbClient.query(
      `
      SELECT a.*, u.email, u.username,
             d.doc_set || '/' || d.doc_type AS doc_title,
             d.version AS current_doc_version
      FROM legal_acceptances a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN legal_documents d ON a.global_doc_id = d.id
      ${whereSql}
      ORDER BY a.accepted_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, limit, offset],
    );

    const totalRes = await dbClient.query(
      `SELECT COUNT(*)::int AS count FROM legal_acceptances a ${whereSql}`,
      params,
    );

    const total = totalRes.rows[0]?.count ?? 0;

    res.json({
      ok: true,
      acceptances: acceptancesRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err: any) {
    res.json({
      ok: false,
      error: err.message,
      acceptances: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0 },
    });
  }
});

// GET /api/admin/legal-acceptances/:id/validate - Validate acceptance chain
router.get("/acceptances/:id/validate", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid acceptance id" });

  try {
    const result = await dbClient.query("SELECT * FROM legal_acceptances WHERE id = $1", [id]);
    const acceptance = result.rows[0];
    if (!acceptance) return res.status(404).json({ ok: false, error: "Acceptance not found" });

    const payload = [
      acceptance.ledger_seq,
      acceptance.prev_ledger_hash,
      acceptance.user_id,
      acceptance.email_at_acceptance,
      acceptance.country_iso2,
      acceptance.global_doc_id,
      acceptance.global_doc_version,
      acceptance.global_doc_sha256,
      acceptance.combined_sha256,
      acceptance.accepted_at,
    ].join("|");

    const expectedHash = sha256(payload);
    const valid = expectedHash === acceptance.ledger_hash;
    res.json({ ok: true, valid, expectedHash, actualHash: acceptance.ledger_hash });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  }
});

// ==================== COVERAGE ====================

// GET /api/admin/legal-docs/coverage - Get coverage stats
router.get("/coverage/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await getCoverageStats();
    res.json({
      ...stats,
      regions: Object.values(REGIONS),
    });
  } finally {
  }
});

// ==================== SYSTEM CONFIG ====================

// GET /api/admin/system-config/legal-enforcement - Get enforcement toggle
router.get("/system-config/enforcement", async (_req: Request, res: Response) => {
  res.json({ enforced: await isEnforcementEnabled() });
});

// PATCH /api/admin/system-config/legal-enforcement - Set enforcement toggle
router.patch("/system-config/enforcement", async (req: Request, res: Response) => {
  const { enforce } = req.body;
  if (typeof enforce !== "boolean") return res.status(400).json({ error: "enforce must be boolean" });
  await setEnforcementEnabled(enforce);
  res.json({ success: true, enforced: enforce });
});

export default router;
