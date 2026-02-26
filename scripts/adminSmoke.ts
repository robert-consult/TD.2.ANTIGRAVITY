import WebSocket from "ws";

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
        if (payload?.isAdmin) return cookie;
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
  log("Smoke test OK");
}

main().catch((err) => {
  console.error(`[Smoke] FAIL: ${err.message ?? err}`);
  process.exit(1);
});
