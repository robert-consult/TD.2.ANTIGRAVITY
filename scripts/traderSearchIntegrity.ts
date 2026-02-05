type TraderSearchResponse = {
  ok: true;
  days: number;
  cutoffSec: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  results: Array<{ userId: number; username: string | null; email: string | null; trades: number }>;
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

function getCookieFromSetCookie(headerValue: string | null): string {
  if (!headerValue) return "";
  return headerValue.split(";")[0] ?? "";
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

async function fetchText(url: string, options: RequestInit = {}) {
  if (typeof fetch !== "function") throw new Error("Global fetch() not available in this Node runtime");
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return { res, text };
}

async function loginAdmin(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin login failed: HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const cookie = getCookieFromSetCookie(res.headers.get("set-cookie"));
  if (!cookie) throw new Error("Admin login failed: missing session cookie");
  return cookie;
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
  const cookie = await loginAdmin();
  log(`Logged in as ${maskEmail(ADMIN_EMAIL)}`);

  // 1) No optional filters (q/categories/minTrades omitted)
  const base = await requestSearch(cookie, { days: 30, limit: 5, offset: 0 });

  // 2) Single-field filters (ensure each is optional and independently usable)
  await requestSearch(cookie, { days: 30, q: "demo" });
  await requestSearch(cookie, { days: 30, categories: "forex" });
  await requestSearch(cookie, { days: 30, minWinRate: 0.5 });
  await requestSearch(cookie, { days: 30, maxDrawdown: 0.5 });
  await requestSearch(cookie, { days: 30, minNetProfit: 0 });
  await requestSearch(cookie, { days: 30, maxBestDayPct: 0.9 });
  await requestSearch(cookie, { days: 30, minProfitFactor: 1.0 });
  await requestSearch(cookie, { days: 30, minSlUsage: 0.0 });
  await requestSearch(cookie, { days: 30, minTpUsage: 0.0 });
  await requestSearch(cookie, { days: 30, minHoldSec: 0 });
  await requestSearch(cookie, { days: 30, maxHoldSec: 365 * 24 * 3600 });

  // 3) Invalid category should 400
  try {
    await requestSearch(cookie, { days: 30, categories: "not_a_category" });
    throw new Error("Expected invalid category to fail, but it succeeded");
  } catch (err: any) {
    log(`OK invalid category rejected: ${String(err?.message || err)}`);
  }

  // 4) Drilldowns (only if we have at least one row)
  const userId = base.results[0]?.userId;
  if (userId) {
    const breakdownUrl = `${BASE_URL}/api/admin/trader-scouting/${userId}/asset-classes?days=30`;
    const extremesUrl = `${BASE_URL}/api/admin/trader-scouting/${userId}/trade-extremes?days=30&limit=5`;
    const breakdown = await fetchJson(breakdownUrl, { headers: { Cookie: cookie } });
    const extremes = await fetchJson(extremesUrl, { headers: { Cookie: cookie } });
    if (!breakdown?.ok) throw new Error("Asset-classes drilldown missing ok=true");
    if (!extremes?.ok) throw new Error("Trade-extremes drilldown missing ok=true");
    log(`OK drilldowns for userId=${userId}`);
  } else {
    log("No search rows available; skipped drilldown checks");
  }

  // 5) Exports (CSV + JSONL) - small limit to keep smoke fast.
  const csvUrl = `${BASE_URL}/api/admin/trader-scouting/export?format=csv&days=30&exportLimit=5`;
  const csv = await fetchText(csvUrl, { headers: { Cookie: cookie } });
  const csvType = String(csv.res.headers.get("content-type") ?? "");
  if (!csvType.includes("text/csv")) throw new Error(`Unexpected CSV content-type: ${csvType}`);
  if (!csv.text.includes("userId,username,email")) throw new Error("CSV export missing expected header row");
  log(`OK export csv (${csv.res.headers.get("x-export-limit") ?? "?"} limit)`);

  const jsonlUrl = `${BASE_URL}/api/admin/trader-scouting/export?format=jsonl&days=30&exportLimit=5`;
  const jsonl = await fetchText(jsonlUrl, { headers: { Cookie: cookie } });
  const jsonlType = String(jsonl.res.headers.get("content-type") ?? "");
  if (!jsonlType.includes("ndjson")) throw new Error(`Unexpected JSONL content-type: ${jsonlType}`);
  const lines = jsonl.text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 3)) {
    const obj = JSON.parse(line);
    if (!obj || typeof obj !== "object") throw new Error("JSONL export line is not an object");
    if (typeof obj.userId !== "number") throw new Error("JSONL export missing userId");
  }
  log(`OK export jsonl (${jsonl.res.headers.get("x-export-limit") ?? "?"} limit)`);

  log("Integrity check complete");
}

void main().catch((err) => {
  console.error("[TraderSearchIntegrity] FAILED:", err);
  process.exitCode = 1;
});
