// FILE: /server/routes/adminLegalDocs.ts
import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@db";
import { legalDocuments, legalDocPointers, legalDocChangeAudit } from "../../shared/schema";
import { createDocumentVersion, getActiveDoc, listVersions, upsertPointer } from "../legal/legalDocsRepo";
import { appendLegalDocChangeAudit, verifyLegalDocChangeAuditChain } from "../legal/legalDocChangeAuditService";
import { assembleDoc1Terms } from "../legal/termsEngineDb";
import { getCoverageStats, isEnforcementEnabled, setEnforcementEnabled } from "../legal/coverageGate";
import { REGION_RULES_IN_ORDER, REGIONS } from "../legal/regionRules";

export const adminLegalDocsRouter = Router();
adminLegalDocsRouter.use(requireAdmin);

const normalizeTimestamp = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
};

// Targets for dropdowns
adminLegalDocsRouter.get("/targets", (_req, res) => {
  const regionKeys = Array.from(new Set(REGION_RULES_IN_ORDER.map((r) => r.regionKey)));
  return res.json({
    ok: true,
    docSets: ["DOC1"],
    docTypes: ["GLOBAL_MASTER", "ADDENDUM"],
    jurisdictionTypes: ["DEFAULT", "COUNTRY", "REGION"],
    defaultKeys: ["GLOBAL", "ROW"],
    regionKeys,
  });
});

// List pointer for a target
adminLegalDocsRouter.get("/pointer", async (req, res) => {
  const docSet = String(req.query.docSet || "DOC1");
  const docType = String(req.query.docType || "");
  const jurisdictionType = String(req.query.jurisdictionType || "");
  const jurisdictionKey = String(req.query.jurisdictionKey || "");

  const [pointer] = await db
    .select()
    .from(legalDocPointers)
    .where(
      and(
        eq(legalDocPointers.docSet, docSet),
        eq(legalDocPointers.docType, docType),
        eq(legalDocPointers.jurisdictionType, jurisdictionType),
        eq(legalDocPointers.jurisdictionKey, jurisdictionKey)
      )
    )
    .limit(1);

  return res.json({ ok: true, pointer: pointer ?? null });
});

// List versions for a target + active doc
adminLegalDocsRouter.get("/versions", async (req, res) => {
  const docSet = String(req.query.docSet || "DOC1");
  const docType = String(req.query.docType || "");
  const jurisdictionType = String(req.query.jurisdictionType || "");
  const jurisdictionKey = String(req.query.jurisdictionKey || "");

  const target = {
    docSet,
    docType: docType as any,
    jurisdictionType: jurisdictionType as any,
    jurisdictionKey,
  };

  const versions = (await listVersions(target)).map((v) => ({
    ...v,
    createdAt: normalizeTimestamp((v as any).createdAt),
    updatedAt: normalizeTimestamp((v as any).updatedAt),
  }));
  const active = await getActiveDoc(target);

  return res.json({
    ok: true,
    activeDocumentId: active.doc?.id ?? null,
    versions,
  });
});

// Get document content by id
adminLegalDocsRouter.get("/document/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id)).limit(1);
  if (!doc) return res.status(404).json({ ok: false, error: "Not found." });
  return res.json({
    ok: true,
    doc: {
      ...doc,
      createdAt: normalizeTimestamp((doc as any).createdAt),
      updatedAt: normalizeTimestamp((doc as any).updatedAt),
    },
  });
});

// Replace active: creates new version and activates it atomically + logs audit chain
adminLegalDocsRouter.post("/replace-active", async (req, res) => {
  const body = req.body || {};
  const target = body.target as {
    docSet: string;
    docType: "GLOBAL_MASTER" | "ADDENDUM";
    jurisdictionType: "DEFAULT" | "COUNTRY" | "REGION";
    jurisdictionKey: string;
  };

  const version = String(body.version || "").trim();
  const content = String(body.content || "");
  const note = String(body.note || "");
  const adminUserId = Number((req as any).user?.id || 0) || null;

  if (!target?.docSet || !target?.docType || !target?.jurisdictionType || !target?.jurisdictionKey) {
    return res.status(400).json({ ok: false, error: "Missing target." });
  }
  if (!version) return res.status(400).json({ ok: false, error: "Missing version." });
  if (!content || content.length < 50) return res.status(400).json({ ok: false, error: "Content too short." });

  try {
    const result = await db.transaction(async (tx) => {
      const [oldPointer] = await tx
        .select()
        .from(legalDocPointers)
        .where(
          and(
            eq(legalDocPointers.docSet, target.docSet),
            eq(legalDocPointers.docType, target.docType),
            eq(legalDocPointers.jurisdictionType, target.jurisdictionType),
            eq(legalDocPointers.jurisdictionKey, target.jurisdictionKey)
          )
        )
        .limit(1);

      const oldActiveId = oldPointer?.activeDocumentId ?? null;

      const newDoc = await createDocumentVersion({
        target,
        version,
        content,
        notes: note || null,
        adminUserId,
      }, tx as any);

      await upsertPointer({
        target,
        activeDocumentId: Number(newDoc.id),
        adminUserId,
      }, tx as any);

      const audit = await appendLegalDocChangeAudit({
        adminUserId,
        action: "REPLACE_ACTIVE",
        docSet: target.docSet,
        docType: target.docType,
        jurisdictionType: target.jurisdictionType,
        jurisdictionKey: target.jurisdictionKey,
        oldActiveDocumentId: oldActiveId,
        newActiveDocumentId: Number(newDoc.id),
        note: note || null,
      }, tx as any);

      return { newDoc, audit, oldActiveId };
    });

    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Replace failed." });
  }
});

// Set active to an existing version (rollback or switch)
adminLegalDocsRouter.post("/set-active", async (req, res) => {
  const { target, documentId, note } = req.body || {};
  const adminUserId = Number((req as any).user?.id || 0) || null;

  if (!target || !documentId) return res.status(400).json({ ok: false, error: "Missing target/documentId." });

  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, Number(documentId))).limit(1);
  if (!doc) return res.status(404).json({ ok: false, error: "Document not found." });

  if (
    doc.docSet !== target.docSet ||
    doc.docType !== target.docType ||
    doc.jurisdictionType !== target.jurisdictionType ||
    doc.jurisdictionKey !== target.jurisdictionKey
  ) {
    return res.status(400).json({
      ok: false,
      error: `Document ${documentId} belongs to target ${doc.docSet}/${doc.docType}/${doc.jurisdictionType}/${doc.jurisdictionKey}, not ${target.docSet}/${target.docType}/${target.jurisdictionType}/${target.jurisdictionKey}. Cannot set as active for mismatched target.`,
    });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [oldPointer] = await tx
        .select()
        .from(legalDocPointers)
        .where(
          and(
            eq(legalDocPointers.docSet, target.docSet),
            eq(legalDocPointers.docType, target.docType),
            eq(legalDocPointers.jurisdictionType, target.jurisdictionType),
            eq(legalDocPointers.jurisdictionKey, target.jurisdictionKey)
          )
        )
        .limit(1);

      const oldActiveId = oldPointer?.activeDocumentId ?? null;

      await upsertPointer({ target, activeDocumentId: Number(documentId), adminUserId }, tx as any);

      const audit = await appendLegalDocChangeAudit({
        adminUserId,
        action: "SET_ACTIVE",
        docSet: target.docSet,
        docType: target.docType,
        jurisdictionType: target.jurisdictionType,
        jurisdictionKey: target.jurisdictionKey,
        oldActiveDocumentId: oldActiveId,
        newActiveDocumentId: Number(documentId),
        note: String(note || "") || null,
      }, tx as any);

      return { oldActiveId, newActiveId: Number(documentId), audit };
    });

    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Set active failed." });
  }
});

// Assemble preview for a country (admin QA)
adminLegalDocsRouter.post("/preview-assemble", async (req, res) => {
  const { countryIso2 } = req.body || {};
  try {
    const assembled = await assembleDoc1Terms(String(countryIso2 || ""), { purpose: "ADMIN_VIEW" });
    return res.json({
      ok: true,
      countryIso2: assembled.meta.countryIso2,
      regionKey: assembled.meta.regionKey,
      combinedSha256: assembled.combined.sha256,
      global: assembled.global,
      addendum: assembled.addendum,
      token: assembled.token,
      text: assembled.combined.text,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Preview failed." });
  }
});

// Coverage stats for admin dashboard (Postgres)
adminLegalDocsRouter.get("/coverage/stats", async (_req, res) => {
  try {
    const stats = await getCoverageStats();
    return res.json({ ...stats, regions: Object.values(REGIONS) });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get coverage stats." });
  }
});

// Get enforcement toggle
adminLegalDocsRouter.get("/system-config/enforcement", async (_req, res) => {
  return res.json({ enforced: await isEnforcementEnabled() });
});

// Set enforcement toggle
adminLegalDocsRouter.patch("/system-config/enforcement", async (req, res) => {
  const { enforce } = req.body;
  if (typeof enforce !== "boolean") return res.status(400).json({ error: "enforce must be boolean" });
  await setEnforcementEnabled(enforce);
  return res.json({ success: true, enforced: enforce });
});

// View change audit chain
adminLegalDocsRouter.get("/change-audit", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  const rows = await db.select().from(legalDocChangeAudit).orderBy(desc(legalDocChangeAudit.seq)).limit(limit);
  return res.json({ ok: true, rows });
});

// Verify change audit chain integrity
adminLegalDocsRouter.get("/change-audit/verify", async (_req, res) => {
  try {
    const result = await verifyLegalDocChangeAuditChain();
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "VERIFY_FAILED" });
  }
});
