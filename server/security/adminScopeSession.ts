type ScopeObject = Record<string, unknown>;

const SCOPE_LIST_KEYS = [
  "challenges",
  "challengeIds",
  "managedChallengeIds",
  "prizes",
  "prizeIds",
  "managedPrizeIds",
  "partners",
  "partnerIds",
  "managedPartnerIds",
] as const;

function parseJsonObject(raw: string): ScopeObject | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ScopeObject;
    }
  } catch {
    return null;
  }
  return null;
}

function parseScopeObject(raw: unknown): ScopeObject | null {
  if (!raw) return null;
  if (typeof raw === "string") return parseJsonObject(raw);
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as ScopeObject;
  return null;
}

function normalizeScopeIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const dedup = new Set<number>();
  for (const value of raw) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) dedup.add(id);
  }
  if (!dedup.size) return null;
  return Array.from(dedup).sort((a, b) => a - b);
}

function normalizeAllFlag(raw: unknown): true | "ALL" | undefined {
  if (raw === true) return true;
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return undefined;
  if (text === "*" || text === "ALL") return "ALL";
  if (text === "TRUE" || text === "1") return true;
  return undefined;
}

function normalizeScopeObject(raw: ScopeObject | null): ScopeObject | null {
  if (!raw) return null;
  const out: ScopeObject = {};

  const allFlag = normalizeAllFlag((raw as any).all);
  if (allFlag !== undefined) out.all = allFlag;

  for (const key of SCOPE_LIST_KEYS) {
    const ids = normalizeScopeIds((raw as any)[key]);
    if (ids) out[key] = ids;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function readScopeSource(userLike: any): ScopeObject | null {
  const candidates = [
    userLike?.adminResourceScopes,
    userLike?.adminResourceScopesJson,
    userLike?.adminScopes,
    userLike?.adminScopesJson,
    userLike?.roleScopes,
  ];
  for (const candidate of candidates) {
    const parsed = parseScopeObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function resolveSuperAdminFlag(userLike: any, normalized: ScopeObject | null): boolean {
  if (Boolean(userLike?.isSuperAdmin)) return true;
  const role = String(userLike?.adminRole ?? userLike?.role ?? "").trim().toUpperCase();
  if (role === "SUPER_ADMIN" || role === "ROOT") return true;
  const all = normalized ? (normalized as any).all : undefined;
  return all === true || all === "ALL";
}

export function applyAdminScopeSession(session: any, userLike: any): void {
  if (!session) return;
  if (!Boolean(userLike?.isAdmin)) {
    session.isSuperAdmin = undefined;
    session.adminResourceScopes = undefined;
    return;
  }

  const normalized = normalizeScopeObject(readScopeSource(userLike));
  const isSuperAdmin = resolveSuperAdminFlag(userLike, normalized);
  const fallbackAll = { all: "ALL" as const };

  session.isSuperAdmin = isSuperAdmin || !normalized;
  session.adminResourceScopes = normalized ?? fallbackAll;
}

