import WebSocket from "ws";

type SymbolRow = {
  symbol: string;
  enabled?: boolean;
};

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

function log(message: string) {
  console.log(`[Smoke] ${message}`);
}

function extractCookiePair(setCookieValue: string): string {
  return String(setCookieValue || "").split(";")[0]?.trim() ?? "";
}

function getCookieFromResponse(res: Response): string {
  const getSetCookie = (res.headers as any)?.getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(res.headers);
    if (Array.isArray(values) && values.length > 0) {
      const pairs = values.map(extractCookiePair).filter(Boolean);
      if (pairs.length > 0) return pairs.join("; ");
    }
  }

  const fallback = res.headers.get("set-cookie");
  if (!fallback) return "";
  return extractCookiePair(fallback);
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
  if (!cookie) throw new Error("Admin login failed: missing session cookie");
  return cookie;
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
  const rows = (await fetchJson(`${BASE_URL}/api/quotes/latest?symbols=${query}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  })) as Array<{ symbol?: string }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Quotes response is empty");
  }
  const found = new Set(rows.map((r) => String(r.symbol ?? "").toUpperCase()).filter(Boolean));
  const missing = symbols.filter((s) => !found.has(s));
  if (missing.length) {
    throw new Error(`Quotes missing symbols: ${missing.join(",")}`);
  }
  log(`Quotes check OK (${rows.length} rows)`);
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
      ws.close();
      reject(new Error(`WS timeout (snapshot=${gotSnapshot}, update=${gotUpdate})`));
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
  const cookie = await loginAdmin();
  const symbols = await loadEnabledSymbols(cookie);
  if (!symbols.length) {
    throw new Error("No enabled symbols found");
  }
  await verifyQuotes(symbols, cookie);
  await verifyWebSocket(symbols, cookie);
  log("Smoke test OK");
}

main().catch((err) => {
  console.error(`[Smoke] FAIL: ${err.message ?? err}`);
  process.exit(1);
});
