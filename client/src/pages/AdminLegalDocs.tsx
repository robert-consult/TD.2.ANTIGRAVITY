import { useState, useEffect, useMemo } from "react";
import { getLegalDocsPrefillOnce, setLegalAcceptancesPrefill, dispatchAdminNavigate } from "../lib/adminDeepLink";
import { fetchWithIdentity } from "../lib/fetchWithIdentity";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Target = {
  docSet: string;
  docType: "GLOBAL_MASTER" | "ADDENDUM";
  jurisdictionType: "DEFAULT" | "COUNTRY" | "REGION";
  jurisdictionKey: string;
};

type DocVersion = {
  id: number;
  version: string;
  createdAt: number;
  notes: string | null;
  adminUserId: number | null;
};

const normalizeTimestamp = (value: number | string) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!numeric) return Date.now();
  return numeric < 1e12 ? numeric * 1000 : numeric;
};

type TargetsData = {
  ok: boolean;
  docSets: string[];
  docTypes: string[];
  jurisdictionTypes: string[];
  defaultKeys: string[];
  regionKeys: string[];
};

type PreviewAssembleData = {
  ok: boolean;
  countryIso2?: string;
  regionKey?: string;
  combinedSha256?: string;
  global?: { id: number; version: string; sha256: string };
  addendum?: { id: number; version: string; sha256: string };
  token?: string;
  text?: string;
  error?: string;
};

const LEGAL_DOCS_V2_FIELD_HELP = {
  docSet: {
    inline: "Legal document family identifier used by the resolver.",
    tooltip:
      "Select the correct document set before editing. Wrong set selection can update the wrong legal stack.",
  },
  docType: {
    inline: "Choose global master or addendum stream.",
    tooltip:
      "GLOBAL_MASTER controls baseline terms, while ADDENDUM applies jurisdiction overlays.",
  },
  jurisdictionType: {
    inline: "Resolver scope type: default, country, or region.",
    tooltip:
      "This determines how jurisdictionKey is interpreted during legal assembly at signup and acceptance time.",
  },
  jurisdictionKey: {
    inline: "Specific scope key used for the selected jurisdiction type.",
    tooltip:
      "Examples: GLOBAL/ROW for defaults, ISO2 for country, region key for regional overlays. Keep keys normalized.",
  },
  newVersion: {
    inline: "Version label for the new immutable revision.",
    tooltip:
      "Use semver-style values and increment on any legal text change to preserve acceptance audit traceability.",
  },
  note: {
    inline: "Operational note describing why this revision is created.",
    tooltip:
      "Add brief rationale for audit context (policy update, legal review, jurisdiction patch, etc.).",
  },
  content: {
    inline: "Canonical legal markdown text for this revision.",
    tooltip:
      "This content is what users accept and what hash/tokens bind to. Review carefully before replacing active.",
  },
  previewCountry: {
    inline: "ISO2 country for resolver preview.",
    tooltip:
      "Runs a dry preview of assembled terms and hashes for the selected jurisdiction without mutating active records.",
  },
} as const;

const card: React.CSSProperties = {
  background: "#1A1A1A",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
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

const textarea: React.CSSProperties = {
  ...input,
  minHeight: 200,
  fontFamily: "monospace",
  resize: "vertical",
};

const select: React.CSSProperties = {
  ...input,
  cursor: "pointer",
};

const smallBtn: React.CSSProperties = {
  background: "#242424",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  padding: "6px 12px",
  color: "#fff",
  fontSize: 12,
  cursor: "pointer",
  marginRight: 8,
};

const primaryBtn: React.CSSProperties = {
  background: "#3B82F6",
  border: "none",
  borderRadius: 4,
  padding: "8px 16px",
  color: "#fff",
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 600,
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#3B82F6",
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
  fontSize: 13,
};

const dangerBtn: React.CSSProperties = {
  background: "#EF4444",
  border: "none",
  borderRadius: 4,
  padding: "8px 16px",
  color: "#fff",
  fontSize: 14,
  cursor: "pointer",
  fontWeight: 600,
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "rgba(255,255,255,0.7)",
  marginBottom: 4,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 16,
};

const col: React.CSSProperties = {
  flex: "1 1 200px",
  minWidth: 150,
};

const badge: React.CSSProperties = {
  display: "inline-block",
  background: "#10B981",
  color: "#fff",
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 6px",
  borderRadius: 4,
  marginLeft: 8,
  textTransform: "uppercase",
};

const versionRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  cursor: "pointer",
};

const versionRowActive: React.CSSProperties = {
  ...versionRow,
  background: "rgba(59,130,246,0.1)",
};

const hintBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#67E8F9",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationStyle: "dotted",
  textUnderlineOffset: 2,
  fontSize: 11,
  fontWeight: 600,
  padding: 0,
};

const hintBanner: React.CSSProperties = {
  border: "1px solid rgba(8,145,178,0.45)",
  background: "rgba(8,145,178,0.12)",
  color: "rgba(207,250,254,0.95)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12,
  marginBottom: 12,
};

function HintLabel(props: { label: string; hint: string; inline: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <label style={label}>{props.label}</label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" style={hintBtn} aria-label={`${props.label} hint`}>
              Hint
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
            {props.hint}
          </TooltipContent>
        </Tooltip>
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{props.inline}</div>
    </div>
  );
}

export default function AdminLegalDocs() {
  const prefill = useMemo(() => getLegalDocsPrefillOnce(), []);

  const [returnTo, setReturnTo] = useState(prefill?.returnTo ?? null);

  const [targets, setTargets] = useState<TargetsData | null>(null);
  const [loadingTargets, setLoadingTargets] = useState(true);

  const [docSet, setDocSet] = useState(prefill?.docSet ?? "DOC1");
  const [docType, setDocType] = useState<Target["docType"]>(prefill?.docType ?? "GLOBAL_MASTER");
  const [jurisdictionType, setJurisdictionType] = useState<Target["jurisdictionType"]>(prefill?.jurisdictionType ?? "DEFAULT");
  const [jurisdictionKey, setJurisdictionKey] = useState(prefill?.jurisdictionKey ?? "GLOBAL");

  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<number | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [docContent, setDocContent] = useState<string>("");
  const [loadingDoc, setLoadingDoc] = useState(false);

  const [editorVersion, setEditorVersion] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [editorNote, setEditorNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [previewCountry, setPreviewCountry] = useState("");
  const [previewResult, setPreviewResult] = useState<PreviewAssembleData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [prefillOpenDocId, setPrefillOpenDocId] = useState<number | null>(
    prefill?.openDocumentId != null ? Number(prefill.openDocumentId) : null
  );

  useEffect(() => {
    loadTargets();
  }, []);

  async function loadTargets() {
    setLoadingTargets(true);
    try {
      const res = await fetchWithIdentity("/api/admin/legal-docs-v2/targets");
      const data = await res.json();
      if (data?.ok) {
        setTargets(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingTargets(false);
    }
  }

  useEffect(() => {
    loadVersions();
  }, [docSet, docType, jurisdictionType, jurisdictionKey]);

  async function loadVersions() {
    setLoadingVersions(true);
    setVersions([]);
    setActiveDocumentId(null);
    setSelectedDocId(null);
    setDocContent("");
    try {
      const params = new URLSearchParams({
        docSet,
        docType,
        jurisdictionType,
        jurisdictionKey,
      });
      const res = await fetchWithIdentity(`/api/admin/legal-docs-v2/versions?${params}`);
      const data = await res.json();
      if (data?.ok) {
        setVersions(data.versions || []);
        setActiveDocumentId(data.activeDocumentId ?? null);
      }
    } catch {
      // ignore
    } finally {
      setLoadingVersions(false);
    }
  }

  useEffect(() => {
    if (!prefillOpenDocId) return;
    if (!versions?.length) return;

    const found = versions.find((v) => Number(v.id) === Number(prefillOpenDocId));
    if (!found) {
      setPrefillOpenDocId(null);
      return;
    }

    setSelectedDocId(prefillOpenDocId);
    loadDocContent(prefillOpenDocId).catch(() => {});
    setPrefillOpenDocId(null);
  }, [versions, prefillOpenDocId]);

  async function loadDocContent(id: number) {
    setLoadingDoc(true);
    setDocContent("");
    try {
      const res = await fetchWithIdentity(`/api/admin/legal-docs-v2/document/${id}`);
      const data = await res.json();
      if (data?.ok && data.doc) {
        setDocContent(data.doc.content || "");
      }
    } catch {
      // ignore
    } finally {
      setLoadingDoc(false);
    }
  }

  async function handleReplaceActive() {
    if (!editorVersion.trim()) {
      setSaveError("Version is required.");
      return;
    }
    if (editorContent.length < 50) {
      setSaveError("Content must be at least 50 characters.");
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const res = await fetchWithIdentity("/api/admin/legal-docs-v2/replace-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { docSet, docType, jurisdictionType, jurisdictionKey },
          version: editorVersion.trim(),
          content: editorContent,
          note: editorNote.trim(),
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setEditorVersion("");
        setEditorContent("");
        setEditorNote("");
        await loadVersions();
      } else {
        setSaveError(data?.error || "Replace failed.");
      }
    } catch (e: any) {
      setSaveError(e?.message || "Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive(documentId: number) {
    try {
      const res = await fetchWithIdentity("/api/admin/legal-docs-v2/set-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { docSet, docType, jurisdictionType, jurisdictionKey },
          documentId,
          note: `Activated via Admin UI`,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        await loadVersions();
      }
    } catch {
      // ignore
    }
  }

  async function handlePreviewAssemble() {
    if (!previewCountry.trim()) return;
    setLoadingPreview(true);
    setPreviewResult(null);
    try {
      const res = await fetchWithIdentity("/api/admin/legal-docs-v2/preview-assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryIso2: previewCountry.trim().toUpperCase() }),
      });
      const data = await res.json();
      setPreviewResult(data);
    } catch (e: any) {
      setPreviewResult({ ok: false, error: e?.message || "Request failed." });
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleBackToAcceptance() {
    if (!returnTo || returnTo.kind !== "LEGAL_ACCEPTANCE") return;
    setLegalAcceptancesPrefill({ openAcceptanceId: Number(returnTo.acceptanceId) });
    dispatchAdminNavigate({ target: "legal-acceptances" });
  }

  function getKeyOptions(): string[] {
    if (!targets) return [];
    if (jurisdictionType === "DEFAULT") return targets.defaultKeys || ["GLOBAL", "ROW"];
    if (jurisdictionType === "REGION") return targets.regionKeys || [];
    return [];
  }

  if (loadingTargets) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: "rgba(255,255,255,0.5)" }}>Loading targets...</p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={120}>
    <div style={{ padding: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Legal Docs Management</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            Select a target, view versions, replace active docs, and preview assembled terms.
          </p>
        </div>
        {returnTo?.kind === "LEGAL_ACCEPTANCE" && (
          <button
            style={smallBtn}
            onClick={handleBackToAcceptance}
            title="Return to the acceptance record that deep-linked you here"
          >
            ← Back to Acceptance
          </button>
        )}
      </div>

      <div style={hintBanner}>
        Legal doc controls include hidden <strong>Hint</strong> explainers for resolver scope, revision governance, and acceptance-audit integrity.
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Target Selector
        </h3>
        <div style={row}>
          <div style={col}>
            <HintLabel
              label="Doc Set"
              hint={LEGAL_DOCS_V2_FIELD_HELP.docSet.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.docSet.inline}
            />
            <select style={select} value={docSet} onChange={(e) => setDocSet(e.target.value)}>
              {(targets?.docSets || ["DOC1"]).map((ds) => (
                <option key={ds} value={ds}>{ds}</option>
              ))}
            </select>
          </div>
          <div style={col}>
            <HintLabel
              label="Doc Type"
              hint={LEGAL_DOCS_V2_FIELD_HELP.docType.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.docType.inline}
            />
            <select style={select} value={docType} onChange={(e) => setDocType(e.target.value as Target["docType"])}>
              {(targets?.docTypes || ["GLOBAL_MASTER", "ADDENDUM"]).map((dt) => (
                <option key={dt} value={dt}>{dt}</option>
              ))}
            </select>
          </div>
          <div style={col}>
            <HintLabel
              label="Jurisdiction Type"
              hint={LEGAL_DOCS_V2_FIELD_HELP.jurisdictionType.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.jurisdictionType.inline}
            />
            <select style={select} value={jurisdictionType} onChange={(e) => setJurisdictionType(e.target.value as Target["jurisdictionType"])}>
              {(targets?.jurisdictionTypes || ["DEFAULT", "COUNTRY", "REGION"]).map((jt) => (
                <option key={jt} value={jt}>{jt}</option>
              ))}
            </select>
          </div>
          <div style={col}>
            <HintLabel
              label="Jurisdiction Key"
              hint={LEGAL_DOCS_V2_FIELD_HELP.jurisdictionKey.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.jurisdictionKey.inline}
            />
            {jurisdictionType === "COUNTRY" ? (
              <input
                style={input}
                value={jurisdictionKey}
                onChange={(e) => setJurisdictionKey(e.target.value.toUpperCase())}
                placeholder="e.g., US, GB, DE"
                title={LEGAL_DOCS_V2_FIELD_HELP.jurisdictionKey.tooltip}
              />
            ) : (
              <select style={select} value={jurisdictionKey} onChange={(e) => setJurisdictionKey(e.target.value)} title={LEGAL_DOCS_V2_FIELD_HELP.jurisdictionKey.tooltip}>
                {getKeyOptions().map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            Versions {loadingVersions && <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>(loading...)</span>}
          </h3>
          {versions.length === 0 && !loadingVersions && (
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No versions for this target.</p>
          )}
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {versions.map((v) => {
              const isActive = v.id === activeDocumentId;
              const isSelected = v.id === selectedDocId;
              return (
                <div
                  key={v.id}
                  style={{
                    ...versionRow,
                    background: isSelected ? "rgba(59,130,246,0.15)" : isActive ? "rgba(16,185,129,0.1)" : undefined,
                  }}
                  onClick={() => {
                    setSelectedDocId(v.id);
                    loadDocContent(v.id);
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>v{v.version}</span>
                    {isActive && <span style={badge}>ACTIVE</span>}
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                      {new Date(normalizeTimestamp(v.createdAt)).toLocaleString()}
                    </div>
                    {v.notes && (
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, fontStyle: "italic" }}>
                        {v.notes}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {!isActive && (
                      <button
                        style={{ ...smallBtn, marginRight: 0 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetActive(v.id);
                        }}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            Document Viewer
          </h3>
          {!selectedDocId && (
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Select a version to view its content.</p>
          )}
          {loadingDoc && (
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Loading...</p>
          )}
          {selectedDocId && !loadingDoc && (
            <pre
              style={{
                background: "#0A0A0A",
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                color: "rgba(255,255,255,0.85)",
                maxHeight: 400,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {docContent || "(empty)"}
            </pre>
          )}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Replace Active Document
        </h3>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
          Creates a new version and atomically sets it as active for the selected target.
        </p>
        <div style={row}>
          <div style={{ ...col, flex: "0 1 200px" }}>
            <HintLabel
              label="New Version"
              hint={LEGAL_DOCS_V2_FIELD_HELP.newVersion.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.newVersion.inline}
            />
            <input
              style={input}
              value={editorVersion}
              onChange={(e) => setEditorVersion(e.target.value)}
              placeholder="e.g., 2.0.0"
              title={LEGAL_DOCS_V2_FIELD_HELP.newVersion.tooltip}
            />
          </div>
          <div style={{ ...col, flex: "1 1 300px" }}>
            <HintLabel
              label="Note (optional)"
              hint={LEGAL_DOCS_V2_FIELD_HELP.note.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.note.inline}
            />
            <input
              style={input}
              value={editorNote}
              onChange={(e) => setEditorNote(e.target.value)}
              placeholder="e.g., Updated for Q1 2025 compliance"
              title={LEGAL_DOCS_V2_FIELD_HELP.note.tooltip}
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <HintLabel
            label="Content (min 50 chars)"
            hint={LEGAL_DOCS_V2_FIELD_HELP.content.tooltip}
            inline={LEGAL_DOCS_V2_FIELD_HELP.content.inline}
          />
          <textarea
            style={textarea}
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            placeholder="Enter document content here..."
            title={LEGAL_DOCS_V2_FIELD_HELP.content.tooltip}
          />
        </div>
        {saveError && (
          <p style={{ color: "#EF4444", fontSize: 13, marginBottom: 12 }}>{saveError}</p>
        )}
        <button style={primaryBtn} onClick={handleReplaceActive} disabled={saving}>
          {saving ? "Saving..." : "Replace Active"}
        </button>
      </div>

      <div style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
          Assemble Preview (QA)
        </h3>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
          Preview what a user from a specific country would see. Tests region resolution and doc assembly.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
          <div style={{ flex: "0 1 150px" }}>
            <HintLabel
              label="Country ISO2"
              hint={LEGAL_DOCS_V2_FIELD_HELP.previewCountry.tooltip}
              inline={LEGAL_DOCS_V2_FIELD_HELP.previewCountry.inline}
            />
            <input
              style={input}
              value={previewCountry}
              onChange={(e) => setPreviewCountry(e.target.value.toUpperCase())}
              placeholder="e.g., US, GB"
              maxLength={2}
              title={LEGAL_DOCS_V2_FIELD_HELP.previewCountry.tooltip}
            />
          </div>
          <button style={primaryBtn} onClick={handlePreviewAssemble} disabled={loadingPreview}>
            {loadingPreview ? "Loading..." : "Preview Assemble"}
          </button>
        </div>
        {previewResult && (
          <div style={{ background: "#0A0A0A", padding: 16, borderRadius: 4 }}>
            {!previewResult.ok ? (
              <p style={{ color: "#EF4444" }}>Error: {previewResult.error}</p>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Country</span>
                    <p style={{ fontWeight: 600 }}>{previewResult.countryIso2}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Region Key</span>
                    <p style={{ fontWeight: 600 }}>{previewResult.regionKey || "—"}</p>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Combined SHA256</span>
                    <p style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
                      {previewResult.combinedSha256 || "—"}
                    </p>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Global Doc</span>
                    <p style={{ fontSize: 13 }}>
                      ID: {previewResult.global?.id ?? "—"}, v{previewResult.global?.version ?? "—"}
                    </p>
                    <p style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                      {previewResult.global?.sha256 ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Addendum Doc</span>
                    <p style={{ fontSize: 13 }}>
                      ID: {previewResult.addendum?.id ?? "—"}, v{previewResult.addendum?.version ?? "—"}
                    </p>
                    <p style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                      {previewResult.addendum?.sha256 ?? "—"}
                    </p>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Token</span>
                  <pre style={{ fontSize: 10, fontFamily: "monospace", wordBreak: "break-all", margin: "4px 0 12px" }}>
                    {previewResult.token || "—"}
                  </pre>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>Combined Text Preview</span>
                  <pre
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      maxHeight: 200,
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      marginTop: 4,
                      padding: 8,
                      background: "#121212",
                      borderRadius: 4,
                    }}
                  >
                    {previewResult.text || "(empty)"}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}
