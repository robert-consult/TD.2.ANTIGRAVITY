type TraderSearchResponse = {
  ok: true;
  days: number;
  cutoffSec: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  results: Array<{ userId: number; username: string | null; email: string | null; trades: number }>;
};

type AdminAuthSession = {
  cookie: string;
  csrfToken: string;
};

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@local.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme";

function maskEmail(email: string): string {
  const raw = String(email || "");
  const at = raw.indexOf("@");
  if (at <= 0) return "***";
  const name = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const head = name.slice(0, 1);
  return `${head}***@${domain}`;
}

function log(message: string) {
  console.log(`[TraderSearchIntegrity] ${message}`);
}

function extractCookiePair(setCookieValue: string): string {
  return String(setCookieValue || "").split(";")[0]?.trim() ?? "";
}

function splitCombinedSetCookieHeader(headerValue: string): string[] {
  return String(headerValue || "")
    .split(/,(?=\s*[^;=\s]+=[^;]+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function getCookieFromResponse(res: Response): string {
  const sessionCookieName = String(process.env.SESSION_COOKIE_NAME ?? "connect.sid").trim() || "connect.sid";
  const sessionPrefix = `${sessionCookieName}=`;
  const selectSessionPair = (pairs: string[]): string =>
    pairs.find((p) => p.startsWith(sessionPrefix)) ?? "";

  const getSetCookie = (res.headers as any)?.getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(res.headers);
    if (Array.isArray(values) && values.length > 0) {
      const pairs = values.map(extractCookiePair).filter(Boolean);
      const sessionPair = selectSessionPair(pairs);
      if (sessionPair) return sessionPair;
    }
  }

  const fallback = res.headers.get("set-cookie");
  if (!fallback) return "";
  const pairs = splitCombinedSetCookieHeader(fallback).map(extractCookiePair).filter(Boolean);
  const sessionPair = selectSessionPair(pairs);
  if (sessionPair) return sessionPair;
  return "";
}

function parseSetCookiePairs(headers: Headers): string[] {
  const getter = (headers as any).getSetCookie;
  if (typeof getter === "function") {
    const values = getter.call(headers) as string[];
    return values
      .map((raw) => raw.split(";")[0]?.trim() || "")
      .filter(Boolean);
  }

  const raw = headers.get("set-cookie") || "";
  if (!raw) return [];
  return splitCombinedSetCookieHeader(raw).map(extractCookiePair).filter(Boolean);
}

function mergeCookieHeader(existingCookie: string, setCookiePairs: string[]): string {
  const jar = new Map<string, string>();
  for (const part of String(existingCookie || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) continue;
    jar.set(key, value);
  }
  for (const pair of setCookiePairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) continue;
    jar.set(key, value);
  }
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

async function fetchCsrfToken(cookie: string): Promise<AdminAuthSession> {
  const res = await fetch(`${BASE_URL}/api/csrf`, {
    method: "GET",
    headers: {
      Cookie: cookie,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CSRF fetch failed: HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const body = (await res.json().catch(() => ({}))) as { csrfToken?: string };
  const csrfToken = String(body?.csrfToken || "");
  if (!csrfToken) throw new Error("CSRF fetch failed: missing csrfToken");
  const setCookiePairs = parseSetCookiePairs(res.headers);
  return {
    csrfToken,
    cookie: mergeCookieHeader(cookie, setCookiePairs),
  };
}


async function fetchJson(url: string, options: RequestInit = {}) {
  if (typeof fetch !== "function") throw new Error("Global fetch() not available in this Node runtime");
  const res = await fetch(url, options);
  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function isUnauthorizedError(err: unknown): boolean {
  const message = String((err as any)?.message || err || "");
  return message.includes("HTTP 401") || message.includes("Unauthorized");
}

async function queueTraderScoutingExport(auth: AdminAuthSession, format: "csv" | "jsonl" | "parquet") {
  const res = await fetch(`${BASE_URL}/api/admin/data-exports/trader-scouting`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "x-csrf-token": auth.csrfToken,
      Cookie: auth.cookie,
    },
    body: JSON.stringify({
      format,
      filters: {
        days: 30,
        exportLimit: 5,
      },
    }),
  });
  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new Error(`Queue export failed (${format}): HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  if (!payload?.ok || !payload?.jobId) {
    throw new Error(`Queue export failed (${format}): malformed response ${text}`);
  }
  log(`OK export ${format} queued (jobId=${payload.jobId}${payload.deduped ? ", deduped" : ""})`);

  const status = await fetchJson(`${BASE_URL}/api/admin/data-exports/${encodeURIComponent(String(payload.jobId))}`, {
    headers: { Cookie: auth.cookie },
  });
  if (!status?.ok || !status?.job?.status) {
    throw new Error(`Queue export status check failed (${format}) for jobId=${payload.jobId}`);
  }
  log(`OK export ${format} status probe (${status.job.status})`);
}

async function loginAdmin(): Promise<AdminAuthSession> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin login failed: HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const cookie = getCookieFromResponse(res);
  if (!cookie) {
    const sessionCookieName = String(process.env.SESSION_COOKIE_NAME ?? "connect.sid").trim() || "connect.sid";
    throw new Error(
      `Admin login failed: missing ${sessionCookieName} session cookie (check HTTPS/COOKIE_SECURE settings for this environment).`,
    );
  }
  return fetchCsrfToken(cookie);
}

async function requestSearch(cookie: string, query: Record<string, string | number | undefined>) {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    qp.set(k, String(v));
  }
  const url = `${BASE_URL}/api/admin/trader-scouting/search?${qp.toString()}`;
  const data = (await fetchJson(url, { headers: { Cookie: cookie } })) as TraderSearchResponse;
  if (!data?.ok) throw new Error(`Unexpected response from ${url}`);
  if (!Array.isArray(data.results)) throw new Error(`Malformed results from ${url}`);
  log(`OK search (${qp.toString() || "no filters"}) -> ${data.results.length} rows`);
  return data;
}

async function main() {
  let auth = await loginAdmin();
  log(`Logged in as ${maskEmail(ADMIN_EMAIL)}`);
  let didReauth = false;
  const runWithReauth = async <T>(op: (session: AdminAuthSession) => Promise<T>): Promise<T> => {
    try {
      return await op(auth);
    } catch (err) {
      if (didReauth || !isUnauthorizedError(err)) throw err;
      didReauth = true;
      log("Session unauthorized during smoke run; re-authenticating once");
      auth = await loginAdmin();
      return op(auth);
    }
  };

  // 1) No optional filters (q/categories/minTrades omitted)
  const base = await runWithReauth((session) =>
    requestSearch(session.cookie, { days: 30, limit: 5, offset: 0 }),
  );

  // 2) Single-field filters (ensure each is optional and independently usable)
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, q: "demo" }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, categories: "forex" }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, minWinRate: 0.5 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, maxDrawdown: 0.5 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, minNetProfit: 0 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, maxBestDayPct: 0.9 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, minProfitFactor: 1.0 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, minSlUsage: 0.0 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, minTpUsage: 0.0 }));
  await runWithReauth((session) => requestSearch(session.cookie, { days: 30, minHoldSec: 0 }));
  await runWithReauth((session) =>
    requestSearch(session.cookie, { days: 30, maxHoldSec: 365 * 24 * 3600 }),
  );

  // 3) Invalid category should 400
  try {
    await runWithReauth((session) =>
      requestSearch(session.cookie, { days: 30, categories: "not_a_category" }),
    );
    throw new Error("Expected invalid category to fail, but it succeeded");
  } catch (err: any) {
    log(`OK invalid category rejected: ${String(err?.message || err)}`);
  }

  // 4) Drilldowns (only if we have at least one row)
  const userId = base.results[0]?.userId;
  if (userId) {
    const breakdownUrl = `${BASE_URL}/api/admin/trader-scouting/${userId}/asset-classes?days=30`;
    const extremesUrl = `${BASE_URL}/api/admin/trader-scouting/${userId}/trade-extremes?days=30&limit=5`;
    const breakdown = await runWithReauth((session) =>
      fetchJson(breakdownUrl, { headers: { Cookie: session.cookie } }),
    );
    const extremes = await runWithReauth((session) =>
      fetchJson(extremesUrl, { headers: { Cookie: session.cookie } }),
    );
    if (!breakdown?.ok) throw new Error("Asset-classes drilldown missing ok=true");
    if (!extremes?.ok) throw new Error("Trade-extremes drilldown missing ok=true");
    log(`OK drilldowns for userId=${userId}`);
  } else {
    log("No search rows available; skipped drilldown checks");
  }

  // 5) Exports (CSV + JSONL + PARQUET) via durable async queue endpoint.
  await runWithReauth((session) => queueTraderScoutingExport(session, "csv"));
  await runWithReauth((session) => queueTraderScoutingExport(session, "jsonl"));
  await runWithReauth((session) => queueTraderScoutingExport(session, "parquet"));

  log("Integrity check complete");
}

void main().catch((err) => {
  console.error("[TraderSearchIntegrity] FAILED:", err);
  process.exitCode = 1;
});
