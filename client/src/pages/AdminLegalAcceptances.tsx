import { useEffect, useMemo, useState } from "react";
import {
  getLegalAcceptancesPrefillOnce,
  setLegalDocsPrefill,
  dispatchAdminNavigate,
} from "../lib/adminDeepLink";
import { fetchWithIdentity } from "../lib/fetchWithIdentity";

type ListRow = {
  id: number;
  userId: number | null;
  emailAtAcceptance: string | null;
  countryIso2: string;
  regionKey: string | null;

  globalDocId: string;
  globalDocVersion: string;
  globalDocSha256: string;

  addendumId: string;
  addendumVersion: string;
  addendumSha256: string;

  combinedSha256: string;
  acceptedAt: any;

  ipAddress: string | null;
  userAgent: string | null;

  ledgerSeq: number;
  prevLedgerHash: string;
  ledgerHash: string;
};

export default function AdminLegalAcceptances() {
  const acceptPrefill = useMemo(() => getLegalAcceptancesPrefillOnce(), []);
  const [prefillOpenAcceptanceId, setPrefillOpenAcceptanceId] = useState<number | null>(
    acceptPrefill?.openAcceptanceId != null ? Number(acceptPrefill.openAcceptanceId) : null
  );

  const [countryIso2, setCountryIso2] = useState((acceptPrefill?.countryIso2 || "")?.toUpperCase());
  const [email, setEmail] = useState(acceptPrefill?.emailContains || "");
  const [userId, setUserId] = useState(acceptPrefill?.userId != null ? String(acceptPrefill.userId) : "");

  const [fromDate, setFromDate] = useState(() => {
    if (!acceptPrefill?.fromMs) return "";
    const d = new Date(Number(acceptPrefill.fromMs));
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => {
    if (!acceptPrefill?.toMs) return "";
    const d = new Date(Number(acceptPrefill.toMs));
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  });

  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);

  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const [validateOpen, setValidateOpen] = useState(false);
  const [validateResult, setValidateResult] = useState<any>(null);
  const [validateN, setValidateN] = useState(500);

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffResult, setDiffResult] = useState<any>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const queryParams = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));

    if (countryIso2.trim()) qs.set("countryIso2", countryIso2.trim().toUpperCase());
    if (email.trim()) qs.set("email", email.trim());
    if (userId.trim()) qs.set("userId", userId.trim());

    const toMs = (d: string, endOfDay: boolean) => {
      if (!d) return "";
      const dt = new Date(d + "T00:00:00");
      if (endOfDay) dt.setHours(23, 59, 59, 999);
      return String(dt.getTime());
    };

    if (fromDate) qs.set("fromMs", toMs(fromDate, false));
    if (toDate) qs.set("toMs", toMs(toDate, true));

    return qs.toString();
  }, [countryIso2, email, userId, fromDate, toDate, limit, offset]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchWithIdentity(`/api/admin/legal-acceptances/list?${queryParams}`);
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed to load.");

      setTotal(Number(data.total || 0));
      setRows(data.rows || []);
    } catch (e: any) {
      console.error("Load failed:", e?.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [queryParams]);

  useEffect(() => {
    if (!prefillOpenAcceptanceId) return;

    const hit = rows.find((r) => Number(r.id) === Number(prefillOpenAcceptanceId));
    if (hit) {
      openDetail(hit.id);
      setPrefillOpenAcceptanceId(null);
      return;
    }

    (async () => {
      try {
        const res = await fetchWithIdentity(`/api/admin/legal-acceptances/${prefillOpenAcceptanceId}`);
        const data = await res.json();
        if (data?.ok && data.row) {
          setDetail(data.row);
          setDetailOpen(true);
        }
      } catch {
        // ignore
      } finally {
        setPrefillOpenAcceptanceId(null);
      }
    })();
  }, [rows, prefillOpenAcceptanceId]);

  function fmtTime(v: any) {
    try {
      if (typeof v === "number" && v > 0) {
        // Handle Unix seconds vs milliseconds - if v < 1e12, it's seconds
        const ms = v < 1e12 ? v * 1000 : v;
        return new Date(ms).toLocaleString();
      }
      const d = v instanceof Date ? v : new Date(v);
      return d.toLocaleString();
    } catch {
      return String(v ?? "");
    }
  }

  async function openDetail(id: number) {
    const res = await fetchWithIdentity(`/api/admin/legal-acceptances/${id}`);
    const data = await res.json();
    if (!data?.ok) {
      console.error(data?.error || "Failed to load detail.");
      return;
    }
    setDetail(data.row);
    setDetailOpen(true);
  }

  async function runValidate() {
    setValidateResult(null);
    const res = await fetchWithIdentity(`/api/admin/legal-acceptances/validate-chain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "lastN", n: validateN }),
    });
    const data = await res.json();
    if (!data?.ok) {
      console.error(data?.error || "Validation failed.");
      return;
    }
    setValidateResult(data);
  }

  async function openDiff(acceptanceId: number) {
    setDiffLoading(true);
    setDiffResult(null);
    setDiffOpen(true);
    try {
      const res = await fetchWithIdentity(`/api/admin/legal-acceptances/${acceptanceId}/diff-current`);
      const data = await res.json();
      setDiffResult(data);
    } catch (e: any) {
      setDiffResult({ ok: false, error: e?.message || "Failed to fetch diff." });
    } finally {
      setDiffLoading(false);
    }
  }

  function exportCsv() {
    const qs = new URLSearchParams(queryParams);
    qs.delete("limit");
    qs.delete("offset");
    qs.set("limit", "2000");

    const url = `/api/admin/legal-acceptances/export.csv?${qs.toString()}`;
    window.open(url, "_blank");
  }

  function goToLegalDocsForGlobal(acceptanceId: number, docId: any, docVersion: any) {
    if (!docId) return;

    setLegalDocsPrefill({
      docSet: "DOC1",
      docType: "GLOBAL_MASTER",
      jurisdictionType: "DEFAULT",
      jurisdictionKey: "GLOBAL",
      openDocumentId: null,
      returnTo: { kind: "LEGAL_ACCEPTANCE", acceptanceId: Number(acceptanceId) },
    });

    dispatchAdminNavigate({ target: "legal-docs" });
  }

  function goToLegalDocsForAddendum(acceptanceId: number, addendumId: any, regionKey: any, countryIso2: any) {
    if (!addendumId) return;

    const jurisdictionType = regionKey ? "REGION" : countryIso2 ? "COUNTRY" : "DEFAULT";
    const jurisdictionKey = regionKey || countryIso2 || "ROW";

    setLegalDocsPrefill({
      docSet: "DOC1",
      docType: "ADDENDUM",
      jurisdictionType,
      jurisdictionKey,
      openDocumentId: null,
      returnTo: { kind: "LEGAL_ACCEPTANCE", acceptanceId: Number(acceptanceId) },
    });

    dispatchAdminNavigate({ target: "legal-docs" });
  }

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Legal Acceptances</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", wordBreak: "break-word" }}>
            Hedge-fund-grade acceptance ledger: filter, inspect, validate chain, export.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn} onClick={() => { setValidateOpen(true); runValidate(); }}>
            Validate Ledger
          </button>
          <button style={btn} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      <div style={{ ...card, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Field label="Country ISO2">
          <input value={countryIso2} onChange={(e) => { setOffset(0); setCountryIso2(e.target.value.toUpperCase()); }} style={input} placeholder="KE" />
        </Field>

        <Field label="Email contains">
          <input value={email} onChange={(e) => { setOffset(0); setEmail(e.target.value); }} style={input} placeholder="gmail" />
        </Field>

        <Field label="User ID">
          <input value={userId} onChange={(e) => { setOffset(0); setUserId(e.target.value); }} style={input} placeholder="123" />
        </Field>

        <Field label="From (date)">
          <input type="date" value={fromDate} onChange={(e) => { setOffset(0); setFromDate(e.target.value); }} style={input} />
        </Field>

        <Field label="To (date)">
          <input type="date" value={toDate} onChange={(e) => { setOffset(0); setToDate(e.target.value); }} style={input} />
        </Field>

        <Field label="Limit">
          <select value={limit} onChange={(e) => { setOffset(0); setLimit(Number(e.target.value)); }} style={input}>
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={card}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            {loading ? "Loading..." : `Total: ${total} | Page ${page}/${pageCount}`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnSmall} disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button>
            <button style={btnSmall} disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</button>
          </div>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", minWidth: 600, borderCollapse: "collapse", tableLayout: "auto" }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.2)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.7)" }}>
                <th style={th}>ID</th>
                <th style={th}>Accepted</th>
                <th style={{ ...th, minWidth: 120 }}>Email</th>
                <th style={th}>ISO2</th>
                <th style={{ ...th, minWidth: 100 }}>Addendum</th>
                <th style={th}>Seq</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody style={{ maxHeight: 420, overflowY: "auto" }}>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 12 }}>
                  <td style={td}>{r.id}</td>
                  <td style={{ ...td, fontSize: 11, whiteSpace: "nowrap" }}>{fmtTime(r.acceptedAt)}</td>
                  <td style={{ ...td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.emailAtAcceptance || ""}>
                    {r.emailAtAcceptance || "(none)"}
                  </td>
                  <td style={td}>{r.countryIso2}</td>
                  <td style={{ ...td, fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${r.addendumId} v${r.addendumVersion}`}>
                    {r.addendumId ? `${r.addendumId} v${r.addendumVersion}` : "—"}
                  </td>
                  <td style={td}>{r.ledgerSeq}</td>
                  <td style={td}>
                    <button style={btnSmall} onClick={() => openDetail(r.id)}>View</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>No rows found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={`Acceptance #${detail?.id ?? ""}`}>
        {detail && (
          <div style={{ display: "grid", gap: 12, fontSize: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <Info label="User ID" value={detail.userId} />
              <Info label="Email" value={detail.emailAtAcceptance} />
              <Info label="Country" value={detail.countryIso2} />
              <Info label="Region Key" value={detail.regionKey ?? "—"} />
              <Info label="Accepted At" value={fmtTime(detail.acceptedAt)} />
              <Info label="IP" value={detail.ipAddress ?? "—"} />
              <Info label="Ledger Seq" value={detail.ledgerSeq} />
              <Info label="Ledger Hash" value={detail.ledgerHash} mono />
              <Info label="Prev Ledger Hash" value={detail.prevLedgerHash} mono />
              <Info label="Combined SHA256" value={detail.combinedSha256} mono />
              <Info label="Global Version" value={`${detail.globalDocId ?? "—"} v${detail.globalDocVersion ?? "—"}`} />
              <Info label="Addendum Version" value={`${detail.addendumId ?? "—"} v${detail.addendumVersion ?? "—"}`} />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button
                style={btnSmall}
                onClick={() => goToLegalDocsForGlobal(detail.id, detail.globalDocId, detail.globalDocVersion)}
              >
                Go to Global Doc
              </button>
              <button
                style={btnSmall}
                onClick={() => goToLegalDocsForAddendum(detail.id, detail.addendumId, detail.regionKey, detail.countryIso2)}
              >
                Go to Addendum Doc
              </button>
              <button
                style={{ ...btnSmall, background: "#1E3A5F" }}
                onClick={() => openDiff(detail.id)}
              >
                Diff vs Current Terms
              </button>
            </div>

            <details>
              <summary style={{ cursor: "pointer", color: "rgba(255,255,255,0.8)", marginTop: 8 }}>Terms Token (HMAC)</summary>
              <pre style={pre}>{String(detail.termsToken || "")}</pre>
            </details>

            <details open>
              <summary style={{ cursor: "pointer", color: "rgba(255,255,255,0.8)" }}>Rendered Combined Text (exact snapshot)</summary>
              <pre style={pre}>{String(detail.combinedText || "")}</pre>
            </details>
          </div>
        )}
      </Modal>

      <Modal open={validateOpen} onClose={() => setValidateOpen(false)} title="Validate Acceptance Ledger Chain">
        <div style={{ display: "grid", gap: 12, fontSize: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <Field label="Validate last N rows">
              <input value={String(validateN)} onChange={(e) => setValidateN(Number(e.target.value || 0))} style={input} />
            </Field>
            <button style={btn} onClick={runValidate}>Run</button>
          </div>

          {validateResult?.summary && (
            <div style={{ padding: 12, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, background: "rgba(0,0,0,0.2)" }}>
              <div><strong>Rows:</strong> {validateResult.summary.rows}</div>
              <div><strong>Seq range:</strong> {validateResult.summary.firstSeq} → {validateResult.summary.lastSeq}</div>
              <div>
                <strong>Status:</strong>{" "}
                <span style={{ fontWeight: 700, color: validateResult.summary.ok ? "#10B981" : "#EF4444" }}>
                  {validateResult.summary.ok ? "OK" : "ISSUES FOUND"}
                </span>
              </div>
            </div>
          )}

          {Array.isArray(validateResult?.issues) && validateResult.issues.length > 0 && (
            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}>
              <div style={{ padding: 10, background: "rgba(255,255,255,0.05)", fontWeight: 600 }}>Issues</div>
              {validateResult.issues.slice(0, 500).map((iss: any, idx: number) => (
                <div key={idx} style={{ padding: 10, borderTop: "1px solid rgba(255,255,255,0.05)", fontFamily: "monospace", fontSize: 11 }}>
                  {JSON.stringify(iss)}
                </div>
              ))}
              {validateResult.issues.length > 500 && (
                <div style={{ padding: 10, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                  Showing first 500 issues.
                </div>
              )}
            </div>
          )}

          {validateResult?.summary && validateResult.summary.ok && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
              No issues detected in the requested validation range.
            </div>
          )}
        </div>
      </Modal>

      <Modal open={diffOpen} onClose={() => setDiffOpen(false)} title="Diff: Accepted vs Current Terms">
        <div style={{ display: "grid", gap: 12, fontSize: 12 }}>
          {diffLoading && <div style={{ padding: 16, color: "rgba(255,255,255,0.6)" }}>Loading diff...</div>}

          {!diffLoading && diffResult?.ok === false && (
            <div style={{ padding: 12, border: "1px solid #EF4444", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#EF4444" }}>
              Error: {diffResult.error}
            </div>
          )}

          {!diffLoading && diffResult?.warning && (
            <div style={{ padding: 12, border: "1px solid #F59E0B", borderRadius: 8, background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}>
              Warning: {diffResult.warning}
            </div>
          )}

          {!diffLoading && diffResult?.ok && !diffResult.warning && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                <div style={{ padding: 10, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, background: "#0A0A0A" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: 4 }}>
                    Accepted Version
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 12 }}>{diffResult.acceptedVersion}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, wordBreak: "break-all" }}>
                    SHA: {diffResult.acceptedSha256?.slice(0, 16)}...
                  </div>
                </div>
                <div style={{ padding: 10, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, background: "#0A0A0A" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: 4 }}>
                    Current Active Version
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 12 }}>{diffResult.currentVersion}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, wordBreak: "break-all" }}>
                    SHA: {diffResult.currentSha256?.slice(0, 16)}...
                  </div>
                </div>
              </div>

              {diffResult.stats && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 10, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, background: "rgba(0,0,0,0.2)" }}>
                  <div>
                    <span style={{ color: "rgba(255,255,255,0.5)" }}>Equal:</span>{" "}
                    <span style={{ fontWeight: 600 }}>{diffResult.stats.equal}</span>
                  </div>
                  <div>
                    <span style={{ color: "#10B981" }}>+Inserted:</span>{" "}
                    <span style={{ fontWeight: 600, color: "#10B981" }}>{diffResult.stats.inserted}</span>
                  </div>
                  <div>
                    <span style={{ color: "#EF4444" }}>-Deleted:</span>{" "}
                    <span style={{ fontWeight: 600, color: "#EF4444" }}>{diffResult.stats.deleted}</span>
                  </div>
                  {diffResult.unchanged && (
                    <div style={{ marginLeft: "auto", fontWeight: 600, color: "#10B981" }}>
                      NO CHANGES
                    </div>
                  )}
                </div>
              )}

              {diffResult.diff && (
                <pre style={diffPre}>{diffResult.diff}</pre>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.5px" }}>{props.label}</div>
      {props.children}
    </label>
  );
}

function Info(props: { label: string; value: any; mono?: boolean }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 10, background: "#0A0A0A" }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{props.label}</div>
      <div style={{ fontSize: 12, fontFamily: props.mono ? "monospace" : "inherit", wordBreak: "break-word", marginTop: 4 }}>
        {props.value == null || props.value === "" ? "—" : String(props.value)}
      </div>
    </div>
  );
}

function Modal(props: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div style={overlay} onMouseDown={props.onClose}>
      <div style={modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{props.title}</div>
          <button style={btn} onClick={props.onClose}>Close</button>
        </div>
        <div>{props.children}</div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#1A1A1A",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: 16,
  maxWidth: "100%",
  overflow: "hidden",
};

const input: React.CSSProperties = {
  background: "#0A0A0A",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  padding: "8px 12px",
  color: "#fff",
  fontSize: 14,
  width: "100%",
};

const btn: React.CSSProperties = {
  background: "#242424",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  padding: "8px 16px",
  color: "#fff",
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 600,
};

const btnSmall: React.CSSProperties = {
  background: "#242424",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  padding: "6px 12px",
  color: "#fff",
  fontSize: 11,
  cursor: "pointer",
};

const th: React.CSSProperties = {
  padding: "10px 8px",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 8px",
  verticalAlign: "middle",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "grid",
  placeItems: "center",
  padding: 16,
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  width: "min(1100px, 96vw)",
  background: "#1A1A1A",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
  maxHeight: "92vh",
  overflowY: "auto",
};

const pre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  background: "#0A0A0A",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: 12,
  maxHeight: 400,
  overflowY: "auto",
  marginTop: 8,
  fontSize: 11,
  fontFamily: "monospace",
  color: "rgba(255,255,255,0.85)",
};

const diffPre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  background: "#0A0A0A",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: 12,
  maxHeight: 500,
  overflowY: "auto",
  fontSize: 11,
  fontFamily: "monospace",
  color: "rgba(255,255,255,0.85)",
  lineHeight: 1.5,
};
