// FILE: /client/src/lib/adminDeepLink.ts

export const ADMIN_LEGAL_DOCS_PREFILL_KEY = "adminLegalDocs_prefill_v2";
export const ADMIN_LEGAL_ACCEPTANCES_PREFILL_KEY = "adminLegalAcceptances_prefill_v2";

export type AdminNavigateRequest = {
  // Preferred: explicit targets handled by the Legal panel.
  target?: "legal-docs" | "legal-acceptances" | "AdminLegalDocs" | "AdminLegalAcceptances";

  // Legacy/unused: kept for backward compatibility with older dispatchers.
  topTabKey?: "userManagement" | "viewAsTrader" | "tradeSettings" | "instruments" | "data" | "tradeAudit" | "systemConfig";
  systemConfigTabKey?: string;
  userManagementTabKey?: string;
};

export type LegalDocsPrefill = {
  docSet: string;
  docType: "GLOBAL_MASTER" | "ADDENDUM";
  jurisdictionType: "DEFAULT" | "COUNTRY" | "REGION";
  jurisdictionKey: string;
  openDocumentId?: number | null;
  returnTo?: {
    kind: "LEGAL_ACCEPTANCE";
    acceptanceId: number;
  } | null;
};

export type LegalAcceptancesPrefill = {
  countryIso2?: string | null;
  emailContains?: string | null;
  userId?: number | null;
  fromMs?: number | null;
  toMs?: number | null;
  openAcceptanceId?: number | null;
};

export function setLegalDocsPrefill(prefill: LegalDocsPrefill) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_LEGAL_DOCS_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // ignore
  }
}

export function getLegalDocsPrefillOnce(): LegalDocsPrefill | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(ADMIN_LEGAL_DOCS_PREFILL_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(ADMIN_LEGAL_DOCS_PREFILL_KEY);
    const parsed = JSON.parse(raw);
    if (!parsed?.docSet || !parsed?.docType || !parsed?.jurisdictionType || !parsed?.jurisdictionKey) return null;
    return parsed as LegalDocsPrefill;
  } catch {
    return null;
  }
}

export function setLegalAcceptancesPrefill(prefill: LegalAcceptancesPrefill) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_LEGAL_ACCEPTANCES_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // ignore
  }
}

export function getLegalAcceptancesPrefillOnce(): LegalAcceptancesPrefill | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(ADMIN_LEGAL_ACCEPTANCES_PREFILL_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(ADMIN_LEGAL_ACCEPTANCES_PREFILL_KEY);
    return JSON.parse(raw) as LegalAcceptancesPrefill;
  } catch {
    return null;
  }
}

export function dispatchAdminNavigate(detail: AdminNavigateRequest) {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("admin:navigate", { detail }));
  } catch {
    // ignore
  }
}
