import { Router } from "express";
import { and, asc, desc, eq, like, gte, lte, sql } from "drizzle-orm";
import { db } from "@db";
import { requireAdmin } from "../middleware/requireAdmin";
import { legalAcceptances } from "../../shared/schema";
import { sha256, stableStringify } from "../legal/cryptoUtils";

export const adminLegalAcceptancesRouter = Router();
adminLegalAcceptancesRouter.use(requireAdmin);

function toMs(value: any): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeIso2(v: any): string | null {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{2}$/.test(s)) return null;
  return s;
}

function buildWhere(params: {
  countryIso2?: any;
  userId?: any;
  email?: any;
  fromMs?: any;
  toMs?: any;
}) {
  const clauses: any[] = [];

  const iso2 = normalizeIso2(params.countryIso2);
  if (iso2) clauses.push(eq(legalAcceptances.countryIso2, iso2));

  const uid = params.userId != null && params.userId !== "" ? Number(params.userId) : null;
  if (uid && Number.isFinite(uid)) clauses.push(eq(legalAcceptances.userId, uid));

  const email = String(params.email || "").trim();
  if (email) clauses.push(like(legalAcceptances.emailAtAcceptance, `%${email}%`));

  const fromMs = toMs(params.fromMs);
  const toMsVal = toMs(params.toMs);

  if (fromMs != null) clauses.push(gte(legalAcceptances.acceptedAt, new Date(fromMs)));
  if (toMsVal != null) clauses.push(lte(legalAcceptances.acceptedAt, new Date(toMsVal)));

  if (clauses.length === 0) return undefined;
  return and(...clauses);
}

adminLegalAcceptancesRouter.get("/list", (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const where = buildWhere({
      countryIso2: req.query.countryIso2,
      userId: req.query.userId,
      email: req.query.email,
      fromMs: req.query.fromMs,
      toMs: req.query.toMs,
    });

    const totalRow = db
      .select({ count: sql<number>`count(*)` })
      .from(legalAcceptances)
      .where(where as any)
      .get();

    const rows = db
      .select({
        id: legalAcceptances.id,
        userId: legalAcceptances.userId,
        emailAtAcceptance: legalAcceptances.emailAtAcceptance,
        countryIso2: legalAcceptances.countryIso2,
        regionKey: legalAcceptances.regionKey,
        globalDocId: legalAcceptances.globalDocId,
        globalDocVersion: legalAcceptances.globalDocVersion,
        globalDocSha256: legalAcceptances.globalDocSha256,
        addendumId: legalAcceptances.addendumId,
        addendumVersion: legalAcceptances.addendumVersion,
        addendumSha256: legalAcceptances.addendumSha256,
        combinedSha256: legalAcceptances.combinedSha256,
        acceptedAt: legalAcceptances.acceptedAt,
        ipAddress: legalAcceptances.ipAddress,
        userAgent: legalAcceptances.userAgent,
        ledgerSeq: legalAcceptances.ledgerSeq,
        prevLedgerHash: legalAcceptances.prevLedgerHash,
        ledgerHash: legalAcceptances.ledgerHash,
      })
      .from(legalAcceptances)
      .where(where as any)
      .orderBy(desc(legalAcceptances.acceptedAt))
      .limit(limit)
      .offset(offset)
      .all();

    return res.json({
      ok: true,
      total: Number(totalRow?.count || 0),
      limit,
      offset,
      rows,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to list acceptances." });
  }
});

// NOTE: validate :id is digits in handler since path-to-regexp v8 dropped inline regex
adminLegalAcceptancesRouter.get("/:id", (req, res) => {
  // Skip if not numeric (let other routes handle it)
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id format." });
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "Bad id." });

    const row = db.select().from(legalAcceptances).where(eq(legalAcceptances.id, id)).get();
    if (!row) return res.status(404).json({ ok: false, error: "Not found." });

    return res.json({ ok: true, row });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to fetch acceptance." });
  }
});

adminLegalAcceptancesRouter.post("/validate-chain", (req, res) => {
  try {
    const body = req.body || {};
    const mode = String(body.mode || "lastN");

    let rows: any[] = [];

    if (mode === "range") {
      const fromSeq = Number(body.fromSeq);
      const toSeq = Number(body.toSeq);
      if (!Number.isFinite(fromSeq) || !Number.isFinite(toSeq) || fromSeq <= 0 || toSeq < fromSeq) {
        return res.status(400).json({ ok: false, error: "Invalid seq range." });
      }

      rows = db
        .select()
        .from(legalAcceptances)
        .where(and(gte(legalAcceptances.ledgerSeq, fromSeq), lte(legalAcceptances.ledgerSeq, toSeq)) as any)
        .orderBy(asc(legalAcceptances.ledgerSeq))
        .all();
    } else {
      const n = Math.min(5000, Math.max(1, Number(body.n || 500)));
      rows = db
        .select()
        .from(legalAcceptances)
        .orderBy(desc(legalAcceptances.ledgerSeq))
        .limit(n)
        .all()
        .reverse();
    }

    if (rows.length === 0) return res.json({ ok: true, summary: { rows: 0, ok: true }, issues: [] });

    const issues: any[] = [];
    
    // For partial validation, we need to fetch the actual previous record's hash
    const firstRowSeq = Number(rows[0].ledgerSeq);
    let prevHash = "GENESIS";
    let prevSeq = 0;
    
    if (firstRowSeq > 1) {
      // Fetch the record immediately before our validation range
      const prevRecord = db
        .select({ ledgerSeq: legalAcceptances.ledgerSeq, ledgerHash: legalAcceptances.ledgerHash })
        .from(legalAcceptances)
        .where(eq(legalAcceptances.ledgerSeq, firstRowSeq - 1))
        .get();
      
      if (prevRecord) {
        prevHash = String(prevRecord.ledgerHash);
        prevSeq = Number(prevRecord.ledgerSeq);
      } else {
        // Gap in sequence - previous record doesn't exist
        issues.push({
          type: "MISSING_PREDECESSOR",
          ledgerSeq: firstRowSeq,
          message: `Record with ledgerSeq=${firstRowSeq - 1} not found; chain continuity cannot be verified from this point.`,
        });
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      const ledgerSeq = Number(r.ledgerSeq);
      const prevLedgerHash = String(r.prevLedgerHash);
      const ledgerHash = String(r.ledgerHash);
      // Use acceptedAtMs (precise milliseconds) if available, otherwise flag as legacy
      const acceptedAtMs = r.acceptedAtMs != null 
        ? Number(r.acceptedAtMs)
        : null;
      
      if (acceptedAtMs == null) {
        issues.push({
          type: "LEGACY_PRECISION_LOST",
          id: r.id,
          ledgerSeq,
          message: "Record created before acceptedAtMs field was added; hash cannot be verified.",
        });
        prevHash = ledgerHash;
        prevSeq = ledgerSeq;
        continue;
      }

      if (prevSeq > 0 && ledgerSeq !== prevSeq + 1) {
        issues.push({
          type: "SEQ_GAP",
          id: r.id,
          ledgerSeq,
          expected: prevSeq + 1,
          found: ledgerSeq,
        });
      }

      if (prevLedgerHash !== prevHash) {
        issues.push({
          type: "PREV_HASH_MISMATCH",
          id: r.id,
          ledgerSeq,
          expectedPrevHash: prevHash,
          foundPrevHash: prevLedgerHash,
        });
      }

      const payloadForLedger = {
        ledgerSeq,
        prevLedgerHash,
        userId: r.userId ?? null,
        emailAtAcceptance: r.emailAtAcceptance ?? null,
        countryIso2: r.countryIso2,
        regionKey: r.regionKey ?? null,
        global: { id: r.globalDocId, version: r.globalDocVersion, sha256: r.globalDocSha256 },
        addendum: r.addendumId != null
          ? { id: r.addendumId, version: r.addendumVersion, sha256: r.addendumSha256 }
          : null,
        combinedSha256: r.combinedSha256,
        acceptedAtMs,
        ipAddress: r.ipAddress ?? null,
        userAgent: r.userAgent ?? null,
        sessionId: r.sessionId ?? null,
        termsToken: r.termsToken,
      };

      const ledgerPayloadStr = stableStringify(payloadForLedger);
      const expectedLedgerHash = sha256(`${prevLedgerHash}|${ledgerPayloadStr}`);

      if (expectedLedgerHash !== ledgerHash) {
        issues.push({
          type: "LEDGER_HASH_MISMATCH",
          id: r.id,
          ledgerSeq,
          expected: expectedLedgerHash,
          found: ledgerHash,
        });
      }

      const combinedText = String(r.combinedText || "");
      const expectedCombinedSha = sha256(combinedText);
      if (expectedCombinedSha !== String(r.combinedSha256)) {
        issues.push({
          type: "COMBINED_TEXT_SHA_MISMATCH",
          id: r.id,
          ledgerSeq,
          expected: expectedCombinedSha,
          found: String(r.combinedSha256),
        });
      }

      prevHash = ledgerHash;
      prevSeq = ledgerSeq;
    }

    const summary = {
      rows: rows.length,
      ok: issues.length === 0,
      firstSeq: Number(rows[0]?.ledgerSeq || 0),
      lastSeq: Number(rows[rows.length - 1]?.ledgerSeq || 0),
    };

    return res.json({ ok: true, summary, issues });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Validation failed." });
  }
});

adminLegalAcceptancesRouter.get("/:id/diff-current", (req, res) => {
  // Validate :id is numeric
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id format." });
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: "Bad id." });

    const acceptance = db.select().from(legalAcceptances).where(eq(legalAcceptances.id, id)).get();
    if (!acceptance) return res.status(404).json({ ok: false, error: "Acceptance not found." });

    const acceptedText = String(acceptance.combinedText || "");

    let currentText = "";
    let currentSha256 = "";
    let currentGlobalVersion = "";
    let currentAddendumVersion = "";
    let assembleError: string | null = null;

    try {
      const { assembleDoc1Terms } = require("../legal/termsEngineDb");
      const assembled = assembleDoc1Terms(String(acceptance.countryIso2 || ""), { purpose: "ADMIN_VIEW" });

      if (assembled?.blocked) {
        assembleError = String(assembled.blockedReason || "LEGAL_TERMS_BLOCKED");
      } else if (assembled?.combined?.text) {
        currentText = String(assembled.combined.text);
        currentSha256 = String(assembled.combined.sha256 || sha256(currentText));
        currentGlobalVersion = String(assembled.global?.version || "");
        currentAddendumVersion = String(assembled.addendum?.version || "");
      } else {
        assembleError = "No active terms found for this jurisdiction.";
      }
    } catch (e: any) {
      assembleError = e?.message || "Failed to assemble current terms.";
    }

    if (assembleError) {
      return res.json({
        ok: true,
        acceptanceId: id,
        acceptedText,
        acceptedSha256: String(acceptance.combinedSha256 || ""),
        currentText: null,
        currentSha256: null,
        diff: null,
        stats: null,
        warning: assembleError,
      });
    }

    const { computeDiff } = require("../legal/diffUtils");
    const diff = computeDiff(acceptedText, currentText);

    return res.json({
      ok: true,
      acceptanceId: id,
      acceptedVersion: `${acceptance.globalDocVersion || "?"}${acceptance.addendumVersion ? ` + ${acceptance.addendumVersion}` : ""}`,
      acceptedSha256: String(acceptance.combinedSha256 || ""),
      currentVersion: `${currentGlobalVersion || "?"}${currentAddendumVersion ? ` + ${currentAddendumVersion}` : ""}`,
      currentSha256,
      diff: diff.text,
      stats: diff.stats,
      unchanged: diff.stats.inserted === 0 && diff.stats.deleted === 0,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Diff failed." });
  }
});

adminLegalAcceptancesRouter.get("/export.csv", (req, res) => {
  try {
    const where = buildWhere({
      countryIso2: req.query.countryIso2,
      userId: req.query.userId,
      email: req.query.email,
      fromMs: req.query.fromMs,
      toMs: req.query.toMs,
    });

    const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 2000)));

    const rows = db
      .select({
        id: legalAcceptances.id,
        userId: legalAcceptances.userId,
        emailAtAcceptance: legalAcceptances.emailAtAcceptance,
        countryIso2: legalAcceptances.countryIso2,
        regionKey: legalAcceptances.regionKey,
        globalDocId: legalAcceptances.globalDocId,
        globalDocVersion: legalAcceptances.globalDocVersion,
        globalDocSha256: legalAcceptances.globalDocSha256,
        addendumId: legalAcceptances.addendumId,
        addendumVersion: legalAcceptances.addendumVersion,
        addendumSha256: legalAcceptances.addendumSha256,
        combinedSha256: legalAcceptances.combinedSha256,
        acceptedAt: legalAcceptances.acceptedAt,
        ipAddress: legalAcceptances.ipAddress,
        userAgent: legalAcceptances.userAgent,
        ledgerSeq: legalAcceptances.ledgerSeq,
        prevLedgerHash: legalAcceptances.prevLedgerHash,
        ledgerHash: legalAcceptances.ledgerHash,
      })
      .from(legalAcceptances)
      .where(where as any)
      .orderBy(desc(legalAcceptances.acceptedAt))
      .limit(limit)
      .all();

    const header = [
      "id","userId","emailAtAcceptance","countryIso2","regionKey",
      "globalDocId","globalDocVersion","globalDocSha256",
      "addendumId","addendumVersion","addendumSha256",
      "combinedSha256","acceptedAtMs","ipAddress","userAgent",
      "ledgerSeq","prevLedgerHash","ledgerHash"
    ];

    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
        return `"${s.replaceAll('"', '""')}"`;
      }
      return s;
    };

    const lines = [header.join(",")];

    for (const r of rows) {
      const acceptedAtMs = Number(r.acceptedAt);

      lines.push(
        [
          r.id,
          r.userId ?? "",
          r.emailAtAcceptance ?? "",
          r.countryIso2 ?? "",
          r.regionKey ?? "",
          r.globalDocId ?? "",
          r.globalDocVersion ?? "",
          r.globalDocSha256 ?? "",
          r.addendumId ?? "",
          r.addendumVersion ?? "",
          r.addendumSha256 ?? "",
          r.combinedSha256 ?? "",
          acceptedAtMs || "",
          r.ipAddress ?? "",
          r.userAgent ?? "",
          r.ledgerSeq ?? "",
          r.prevLedgerHash ?? "",
          r.ledgerHash ?? "",
        ].map(escape).join(",")
      );
    }

    const csv = lines.join("\n");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="legal_acceptances_${Date.now()}.csv"`);
    return res.send(csv);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Export failed." });
  }
});
