import WebSocket from "ws";
import { CSRF_HEADER_NAME, CSRF_TOKEN_ENDPOINT } from "../shared/security/csrf";

type SymbolRow = {
  symbol: string;
  enabled?: boolean;
};

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const QUOTES_WAIT_MS = Number(process.env.SMOKE_QUOTES_WAIT_MS ?? 20_000);
const QUOTES_RETRY_MS = Number(process.env.SMOKE_QUOTES_RETRY_MS ?? 1000);
const WS_REQUIRE_UPDATE = String(process.env.SMOKE_WS_REQUIRE_UPDATE ?? "0").trim() === "1";

function log(message: string) {
  console.log(`[Smoke] ${message}`);
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
  const selectSessionPair = (pairs: string[]): string => {
    for (let i = pairs.length - 1; i >= 0; i -= 1) {
      const pair = pairs[i];
      if (pair.startsWith(sessionPrefix)) return pair;
    }
    return "";
  };

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
  return selectSessionPair(pairs);
}

function getCookiePairsFromResponse(res: Response): string[] {
  const getSetCookie = (res.headers as any)?.getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(res.headers);
    if (Array.isArray(values) && values.length > 0) {
      return values.map(extractCookiePair).filter(Boolean);
    }
  }

  const fallback = res.headers.get("set-cookie");
  if (!fallback) return [];
  return splitCombinedSetCookieHeader(fallback).map(extractCookiePair).filter(Boolean);
}

function mergeCookiePairs(...groups: Array<string[] | string>): string {
  const jar = new Map<string, string>();
  for (const group of groups) {
    const pairs = Array.isArray(group) ? group : String(group || "").split(/;\s*/g);
    for (const pair of pairs) {
      const trimmed = String(pair || "").trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!key || !value) continue;
      jar.set(key, value);
    }
  }
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function fetchJson(url: string, options: RequestInit = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function fetchCsrfSession(cookie: string): Promise<{ cookie: string; csrfToken: string }> {
  const res = await fetch(`${BASE_URL}${CSRF_TOKEN_ENDPOINT}`, {
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
  return {
    csrfToken,
    cookie: mergeCookiePairs(cookie, getCookiePairsFromResponse(res)),
  };
}

async function loginAdmin(): Promise<string> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return "";
  let lastError = "Admin login failed";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!res.ok) {
      const text = await res.text();
      lastError = `Admin login failed: HTTP ${res.status} ${res.statusText}: ${text}`;
      await sleep(150 * attempt);
      continue;
    }

    const cookie = getCookieFromResponse(res);
    if (!cookie) {
      lastError = "Admin login failed: missing session cookie";
      await sleep(150 * attempt);
      continue;
    }

    // Session store persistence can lag under heavy load; verify before returning.
    for (let verifyAttempt = 1; verifyAttempt <= 3; verifyAttempt += 1) {
      const verifyRes = await fetch(`${BASE_URL}/api/auth/current-user`, {
        headers: { Cookie: cookie, accept: "application/json" },
      });
      if (verifyRes.ok) {
        const payload = (await verifyRes.json().catch(() => ({}))) as { isAdmin?: boolean };
        if (payload?.isAdmin) {
          const csrfSession = await fetchCsrfSession(cookie);
          return mergeCookiePairs(
            csrfSession.cookie,
            `${CSRF_HEADER_NAME}=${encodeURIComponent(csrfSession.csrfToken)}`,
          );
        }
        lastError = "Admin login failed: authenticated user is not admin";
        break;
      }
      const body = await verifyRes.text().catch(() => "");
      lastError = `Admin session verify failed: HTTP ${verifyRes.status} ${verifyRes.statusText}: ${body}`;
      await sleep(150 * verifyAttempt);
    }
  }

  throw new Error(lastError);
}

function isUnauthorizedError(err: unknown): boolean {
  const message = String((err as any)?.message || err || "");
  return message.includes("HTTP 401") || message.includes("Unauthorized");
}

async function loadEnabledSymbols(cookie: string): Promise<string[]> {
  if (cookie) {
    const symbols = (await fetchJson(`${BASE_URL}/api/admin/symbols`, {
      headers: { Cookie: cookie },
    })) as SymbolRow[];
    const enabled = symbols.filter((s) => s.enabled !== false).map((s) => String(s.symbol).toUpperCase());
    log(`Fetched ${enabled.length} enabled symbols from /api/admin/symbols`);
    return enabled;
  }

  log("ADMIN_EMAIL/ADMIN_PASSWORD not set; using /api/config/symbols");
  const symbols = (await fetchJson(`${BASE_URL}/api/config/symbols`)) as SymbolRow[];
  return symbols.map((s) => String(s.symbol).toUpperCase());
}

async function verifyQuotes(symbols: string[], cookie: string) {
  const query = encodeURIComponent(symbols.join(","));
  const deadline = Date.now() + Math.max(1_000, QUOTES_WAIT_MS);
  let lastError = "Quotes response is empty";

  while (Date.now() <= deadline) {
    const rows = (await fetchJson(`${BASE_URL}/api/quotes/latest?symbols=${query}`, {
      headers: cookie ? { Cookie: cookie } : undefined,
    })) as Array<{ symbol?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      lastError = "Quotes response is empty";
      await new Promise((resolve) => setTimeout(resolve, Math.max(100, QUOTES_RETRY_MS)));
      continue;
    }
    const found = new Set(rows.map((r) => String(r.symbol ?? "").toUpperCase()).filter(Boolean));
    const missing = symbols.filter((s) => !found.has(s));
    if (!missing.length) {
      log(`Quotes check OK (${rows.length} rows)`);
      return;
    }
    lastError = `Quotes missing symbols: ${missing.join(",")}`;
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, QUOTES_RETRY_MS)));
  }

  throw new Error(lastError);
}

async function verifyWebSocket(symbols: string[], cookie: string) {
  const wsUrl = BASE_URL.replace(/^http/, "ws") + "/ws";
  const wsOrigin = BASE_URL.startsWith("http://") || BASE_URL.startsWith("https://")
    ? BASE_URL
    : `http://${BASE_URL.replace(/^ws/, "")}`;
  return new Promise<void>((resolve, reject) => {
    const headers: Record<string, string> = { Origin: wsOrigin };
    if (cookie) headers.Cookie = cookie;
    const ws = new WebSocket(wsUrl, { headers });
    let gotSnapshot = false;
    let gotUpdate = false;

    const timeout = setTimeout(() => {
      if (gotSnapshot && !WS_REQUIRE_UPDATE) {
        ws.close();
        resolve();
        return;
      }
      ws.close();
      reject(new Error(`WS timeout (snapshot=${gotSnapshot}, update=${gotUpdate}, requireUpdate=${WS_REQUIRE_UPDATE})`));
    }, TIMEOUT_MS);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth:hello" }));
      ws.send(JSON.stringify({ type: "quotes:subscribe", symbols }));
    });

    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === "quotes:snapshot") {
        const rows = Array.isArray(msg.rows) ? msg.rows : [];
        const found = new Set(rows.map((r: any) => String(r?.symbol ?? "").toUpperCase()).filter(Boolean));
        const missing = symbols.filter((s) => !found.has(s));
        if (missing.length) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`WS snapshot missing symbols: ${missing.join(",")}`));
          return;
        }
        gotSnapshot = true;
        log(`WS snapshot OK (${rows.length} rows)`);
        if (!WS_REQUIRE_UPDATE) {
          clearTimeout(timeout);
          ws.close();
          resolve();
          return;
        }
      }
      if (msg.type === "quotes:update") {
        gotUpdate = true;
        const rows = Array.isArray(msg.rows) ? msg.rows : [];
        log(`WS update OK (${rows.length} rows)`);
      }
      if (gotSnapshot && gotUpdate) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function postJson(url: string, body: unknown, cookie: string) {
  const csrfCookiePrefix = `${CSRF_HEADER_NAME}=`;
  const csrfToken = cookie
    .split(/;\s*/g)
    .find((pair) => pair.startsWith(csrfCookiePrefix))
    ?.slice(csrfCookiePrefix.length);
  if (!csrfToken) throw new Error("Missing CSRF token in smoke session cookie jar");
  return fetchJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CSRF_HEADER_NAME]: decodeURIComponent(csrfToken),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function verifyAdminConfigWrites(cookie: string) {
  if (!cookie) {
    log("Skipping admin config smoke because no admin session is available");
    return;
  }

  const policyResponse = (await fetchJson(`${BASE_URL}/api/admin/system-config/policy`, {
    headers: { Cookie: cookie },
  })) as { config?: Record<string, any> | null };
  const originalPolicy = (policyResponse?.config ?? {}) as Record<string, any>;
  const originalPolicyUpdatedAt = Number(originalPolicy.updatedAt ?? 0);
  if (!Number.isFinite(originalPolicyUpdatedAt) || originalPolicyUpdatedAt <= 0) {
    throw new Error("Policy config missing updatedAt");
  }

  const originalEmailCooldown = Number(originalPolicy.policyEmailResendCooldownSec ?? 60);
  const nextEmailCooldown =
    originalEmailCooldown >= 86_400 ? Math.max(1, originalEmailCooldown - 1) : originalEmailCooldown + 1;

  try {
    await postJson(
      `${BASE_URL}/api/admin/system-config/policy`,
      {
        ...originalPolicy,
        policyEmailResendCooldownSec: nextEmailCooldown,
        expectedUpdatedAt: originalPolicyUpdatedAt,
      },
      cookie,
    );

    const updatedPolicyResponse = (await fetchJson(`${BASE_URL}/api/admin/system-config/policy`, {
      headers: { Cookie: cookie },
    })) as { config?: Record<string, any> | null };
    const updatedPolicy = (updatedPolicyResponse?.config ?? {}) as Record<string, any>;
    if (Number(updatedPolicy.policyEmailResendCooldownSec) !== nextEmailCooldown) {
      throw new Error("Policy config did not persist the smoke update");
    }

    await postJson(
      `${BASE_URL}/api/admin/system-config/policy`,
      {
        ...originalPolicy,
        expectedUpdatedAt: Number(updatedPolicy.updatedAt ?? 0),
      },
      cookie,
    );
  } finally {
    const latestPolicyResponse = (await fetchJson(`${BASE_URL}/api/admin/system-config/policy`, {
      headers: { Cookie: cookie },
    })) as { config?: Record<string, any> | null };
    const latestPolicy = (latestPolicyResponse?.config ?? {}) as Record<string, any>;
    if (Number(latestPolicy.policyEmailResendCooldownSec) !== originalEmailCooldown) {
      await postJson(
        `${BASE_URL}/api/admin/system-config/policy`,
        {
          ...originalPolicy,
          expectedUpdatedAt: Number(latestPolicy.updatedAt ?? 0),
        },
        cookie,
      );
    }
  }
  log("Policy config write/read/rollback OK");

  const restrictionsResponse = (await fetchJson(`${BASE_URL}/api/admin/system-config/jurisdiction-restrictions`, {
    headers: { Cookie: cookie },
  })) as {
    restrictedCountriesCsv?: string;
    restrictedMessage?: string;
  };
  const originalCountriesCsv = String(restrictionsResponse?.restrictedCountriesCsv ?? "");
  const originalRestrictedMessage = String(restrictionsResponse?.restrictedMessage ?? "");
  const smokeSuffix = " [smoke]";
  const nextRestrictedMessage = originalRestrictedMessage.endsWith(smokeSuffix)
    ? `${originalRestrictedMessage}#`
    : `${originalRestrictedMessage}${smokeSuffix}`;

  try {
    await postJson(
      `${BASE_URL}/api/admin/system-config/jurisdiction-restrictions`,
      {
        restrictedCountriesCsv: originalCountriesCsv,
        restrictedMessage: nextRestrictedMessage,
      },
      cookie,
    );

    const updatedRestrictions = (await fetchJson(`${BASE_URL}/api/admin/system-config/jurisdiction-restrictions`, {
      headers: { Cookie: cookie },
    })) as {
      restrictedCountriesCsv?: string;
      restrictedMessage?: string;
    };

    if (String(updatedRestrictions.restrictedMessage ?? "") !== nextRestrictedMessage) {
      throw new Error("Jurisdiction restriction message did not persist the smoke update");
    }

    await postJson(
      `${BASE_URL}/api/admin/system-config/jurisdiction-restrictions`,
      {
        restrictedCountriesCsv: originalCountriesCsv,
        restrictedMessage: originalRestrictedMessage,
      },
      cookie,
    );
  } finally {
    const latestRestrictions = (await fetchJson(`${BASE_URL}/api/admin/system-config/jurisdiction-restrictions`, {
      headers: { Cookie: cookie },
    })) as {
      restrictedCountriesCsv?: string;
      restrictedMessage?: string;
    };
    if (String(latestRestrictions.restrictedMessage ?? "") !== originalRestrictedMessage) {
      await postJson(
        `${BASE_URL}/api/admin/system-config/jurisdiction-restrictions`,
        {
          restrictedCountriesCsv: originalCountriesCsv,
          restrictedMessage: originalRestrictedMessage,
        },
        cookie,
      );
    }
  }
  log("Jurisdiction restriction write/read/rollback OK");
}

async function main() {
  log(`Base URL: ${BASE_URL}`);
  let cookie = await loginAdmin();
  let didReauth = false;
  const runWithReauth = async <T>(op: (sessionCookie: string) => Promise<T>): Promise<T> => {
    try {
      return await op(cookie);
    } catch (err) {
      if (
        didReauth ||
        !cookie ||
        !ADMIN_EMAIL ||
        !ADMIN_PASSWORD ||
        !isUnauthorizedError(err)
      ) {
        throw err;
      }
      didReauth = true;
      log("Session unauthorized during smoke run; re-authenticating once");
      cookie = await loginAdmin();
      return op(cookie);
    }
  };

  const symbols = await runWithReauth((sessionCookie) => loadEnabledSymbols(sessionCookie));
  if (!symbols.length) {
    throw new Error("No enabled symbols found");
  }
  await runWithReauth((sessionCookie) => verifyQuotes(symbols, sessionCookie));
  await runWithReauth((sessionCookie) => verifyWebSocket(symbols, sessionCookie));
  await runWithReauth((sessionCookie) => verifyAdminConfigWrites(sessionCookie));
  log("Smoke test OK");
}

main().catch((err) => {
  console.error(`[Smoke] FAIL: ${err.message ?? err}`);
  process.exit(1);
});
