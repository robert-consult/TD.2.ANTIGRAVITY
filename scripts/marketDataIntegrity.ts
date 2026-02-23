import WebSocket from "ws";

type ProviderRow = { providerKey: string; displayName: string; driver: string; isEnabled: boolean; deletedAt: number | null };
type ProvidersResp = { ok: boolean; activeKey: string | null; rows: ProviderRow[] };

type SymbolRow = { id: number; symbol: string; enabled?: boolean; category?: string | null };

const BASE_URL = process.env.INTEGRITY_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const TIMEOUT_MS = Number(process.env.INTEGRITY_TIMEOUT_MS ?? process.env.SMOKE_TIMEOUT_MS ?? 12_000);

const ENABLE_IMPORT_AND_ENABLE_FLOW = String(process.env.INTEGRITY_IMPORT_AND_ENABLE ?? "").trim() === "1";

function log(message: string) {
  console.log(`[MD-Integrity] ${message}`);
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


async function fetchJson(url: string, options: RequestInit = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

async function loginAdmin(): Promise<string> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set for this integrity check.");
  }
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
  return cookie;
}

async function verifyWebSocketQuotes(symbols: string[], cookie: string) {
  const wsUrl = BASE_URL.replace(/^http/, "ws") + "/ws";
  const wsOrigin =
    BASE_URL.startsWith("http://") || BASE_URL.startsWith("https://")
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
        const missing = symbols.filter((s) => !found.has(String(s).toUpperCase()));
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
  log("Admin login OK");

  const providers = (await fetchJson(`${BASE_URL}/api/admin/market-data/providers`, {
    headers: { Cookie: cookie },
  })) as ProvidersResp;
  if (!providers?.ok) throw new Error("Providers endpoint returned non-ok");

  const enabledProviders = (providers.rows || []).filter((p) => !p.deletedAt && p.isEnabled);
  const providerKey =
    String(process.env.INTEGRITY_PROVIDER_KEY ?? "").trim() ||
    providers.activeKey ||
    enabledProviders[0]?.providerKey ||
    "";

  log(`Providers: ${enabledProviders.length} enabled (active=${providers.activeKey ?? "—"})`);
  log(`Health selected provider: ${providerKey || "—"}`);

  if (providerKey) {
    const exported = await fetchJson(
      `${BASE_URL}/api/admin/market-data/providers/${encodeURIComponent(providerKey)}/export`,
      { headers: { Cookie: cookie } },
    );
    if (String(exported?.providerKey ?? "") !== providerKey) throw new Error("Provider export returned unexpected providerKey");
    if (!exported?.config || typeof exported.config !== "object") throw new Error("Provider export missing config object");
    if (typeof exported?.exportedAt !== "string" || !exported.exportedAt) throw new Error("Provider export missing exportedAt");

    const apiKey = (exported.config as any)?.apiKey;
    if (typeof apiKey === "string" && !apiKey.toLowerCase().startsWith("env:")) {
      throw new Error("Provider export contained a non-env apiKey (refusing to treat it as safe to share)");
    }

    log(`Provider export OK (${providerKey})`);
  } else {
    log("No providerKey available; skipped provider export check.");
  }

  const health = await fetchJson(
    `${BASE_URL}/api/admin/system-health${providerKey ? `?providerKey=${encodeURIComponent(providerKey)}` : ""}`,
    { headers: { Cookie: cookie } },
  );
  log(
    `Health: feedSource=${String(health?.feedSource ?? "—")} feedProvider=${String(health?.feedProviderKey ?? "—")} ` +
      `feedConnected=${Boolean(health?.feedProviderConnected)}`,
  );

  const symbols = (await fetchJson(`${BASE_URL}/api/admin/symbols`, { headers: { Cookie: cookie } })) as SymbolRow[];
  const enabledSymbols = (symbols || [])
    .filter((s) => s.enabled !== false)
    .map((s) => String(s.symbol).toUpperCase())
    .filter(Boolean);

  if (!enabledSymbols.length) throw new Error("No enabled symbols found in /api/admin/symbols");
  const probeSymbols = enabledSymbols.slice(0, 5);
  log(`Enabled symbols: ${enabledSymbols.length} (probing ${probeSymbols.length})`);

  const latestQuotes = (await fetchJson(`${BASE_URL}/api/quotes/latest?symbols=${encodeURIComponent(probeSymbols.join(","))}`, {
    headers: { Cookie: cookie },
  })) as Array<{ symbol?: string }>;
  const found = new Set((latestQuotes || []).map((r) => String(r.symbol ?? "").toUpperCase()).filter(Boolean));
  const missing = probeSymbols.filter((s) => !found.has(s));
  if (missing.length) throw new Error(`Quotes missing symbols: ${missing.join(",")}`);
  log(`HTTP quotes OK (${latestQuotes.length} rows)`);

  await verifyWebSocketQuotes(probeSymbols, cookie);

  if (ENABLE_IMPORT_AND_ENABLE_FLOW) {
    if (!providerKey) throw new Error("No providerKey available for import/enable flow");

    const targetSymbol = probeSymbols[0];
    log(`Running import+enable flow for: ${targetSymbol}`);

    await fetchJson(`${BASE_URL}/api/admin/market-data/instruments/reference/import`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        providerKey,
        rows: [{ category: "forex", canonicalSymbol: targetSymbol, name: `Integrity ${targetSymbol}` }],
      }),
    });

    const search = await fetchJson(
      `${BASE_URL}/api/admin/market-data/instruments/reference/search?providerKey=${encodeURIComponent(providerKey)}&q=${encodeURIComponent(targetSymbol)}&limit=10&offset=0`,
      { headers: { Cookie: cookie } },
    );
    const rows = Array.isArray(search?.rows) ? search.rows : [];
    const row = rows.find((r: any) => String(r?.canonicalSymbol ?? "").toUpperCase() === targetSymbol) ?? rows[0];
    if (!row?.id) throw new Error("Reference search returned no rows to enable");

    const enabled = await fetchJson(`${BASE_URL}/api/admin/market-data/instruments/reference/enable`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ providerKey, ids: [row.id] }),
    });
    if (!enabled?.ok) throw new Error(`Enable failed: ${String(enabled?.error ?? "unknown")}`);
    log("Import+enable flow OK");
  } else {
    log("Skipping import+enable flow (set INTEGRITY_IMPORT_AND_ENABLE=1 to run it).");
  }

  log("Market data integrity OK");
}

main().catch((err) => {
  console.error(`[MD-Integrity] FAIL: ${err?.message ?? err}`);
  process.exit(1);
});
