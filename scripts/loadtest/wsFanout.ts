import fs from "node:fs";
import os from "node:os";
import WebSocket from "ws";

type Args = {
  url: string;
  origin: string | null;
  clients: number;
  durationSec: number;
  rampSec: number;
  symbols: string[];
  serverPid: number | null;
  minOpened: number;
  maxFailed: number;
  minOpenBeforeDrain: number;
  minQuoteUpdates: number;
  authEmail: string;
  authPassword: string;
  authEnabled: boolean;
  sessionCookieName: string;
};

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, "true");
    }
  }

  const url = String(args.get("url") ?? "ws://127.0.0.1:5000/ws");
  const origin = String(args.get("origin") ?? "").trim() || deriveOriginFromWsUrl(url);
  const clients = Number(args.get("clients") ?? 1000);
  const durationSec = Number(args.get("duration-sec") ?? 30);
  const rampSec = Number(args.get("ramp-sec") ?? 10);
  const minOpened = Number(args.get("min-opened") ?? 1);
  const maxFailed = Number(args.get("max-failed") ?? clients);
  const minOpenBeforeDrain = Number(args.get("min-open-before-drain") ?? 1);
  const minQuoteUpdates = Number(args.get("min-quote-updates") ?? 0);
  const authEmail = String(args.get("auth-email") ?? process.env.LOADTEST_AUTH_EMAIL ?? "demo@tradingfx.com");
  const authPassword = String(args.get("auth-password") ?? process.env.LOADTEST_AUTH_PASSWORD ?? "demo1234");
  const authEnabled = !["1", "true", "yes", "on"].includes(String(args.get("no-auth") ?? "").toLowerCase());
  const sessionCookieName = String(
    args.get("session-cookie-name") ?? process.env.SESSION_COOKIE_NAME ?? "connect.sid",
  ).trim() || "connect.sid";
  const symbolsRaw = String(args.get("symbols") ?? "EURUSD,GBPUSD,USDJPY,AUDUSD");
  const symbols = symbolsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const serverPidRaw = args.get("server-pid") ?? null;
  const serverPid = serverPidRaw ? Number(serverPidRaw) : detectServerPid();

  if (!Number.isFinite(clients) || clients <= 0) throw new Error("--clients must be > 0");
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("--duration-sec must be > 0");
  if (!Number.isFinite(rampSec) || rampSec < 0) throw new Error("--ramp-sec must be >= 0");
  if (!Number.isFinite(minOpened) || minOpened < 0) throw new Error("--min-opened must be >= 0");
  if (!Number.isFinite(maxFailed) || maxFailed < 0) throw new Error("--max-failed must be >= 0");
  if (!Number.isFinite(minOpenBeforeDrain) || minOpenBeforeDrain < 0) throw new Error("--min-open-before-drain must be >= 0");
  if (!Number.isFinite(minQuoteUpdates) || minQuoteUpdates < 0) throw new Error("--min-quote-updates must be >= 0");
  if (!symbols.length) throw new Error("--symbols must include at least 1 symbol");

  return {
    url,
    origin,
    clients,
    durationSec,
    rampSec,
    symbols,
    serverPid: serverPid ?? null,
    minOpened: Math.trunc(minOpened),
    maxFailed: Math.trunc(maxFailed),
    minOpenBeforeDrain: Math.trunc(minOpenBeforeDrain),
    minQuoteUpdates: Math.trunc(minQuoteUpdates),
    authEmail,
    authPassword,
    authEnabled,
    sessionCookieName,
  };
}

function deriveOriginFromWsUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "ws:") return `http://${u.host}`;
    if (u.protocol === "wss:") return `https://${u.host}`;
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.host}`;
    return null;
  } catch {
    return null;
  }
}

function detectServerPid(): number | null {
  const candidates = [
    ".tmp/graviton-prod-5000.node.pid",
    ".tmp/graviton-dev-5000.node.pid",
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf8").trim();
      const pid = Number(raw);
      if (Number.isFinite(pid) && pid > 0) return pid;
    } catch {
      // ignore
    }
  }
  return null;
}

function readProcStatus(pid: number): string | null {
  try {
    return fs.readFileSync(`/proc/${pid}/status`, "utf8");
  } catch {
    return null;
  }
}

function readRssKb(pid: number): number | null {
  const status = readProcStatus(pid);
  if (!status) return null;
  const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
  if (!m) return null;
  const rss = Number(m[1]);
  return Number.isFinite(rss) ? rss : null;
}

function fmtBytes(n: number) {
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function splitCombinedSetCookieHeader(headerValue: string): string[] {
  return String(headerValue || "")
    .split(/,(?=\\s*[^;=\\s]+=[^;]+)/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function extractCookiePair(setCookieValue: string): string {
  return String(setCookieValue || "").split(";")[0]?.trim() ?? "";
}

function resolveHttpBaseUrlFromWs(wsUrl: string): string {
  const u = new URL(wsUrl);
  if (u.protocol === "ws:") return `http://${u.host}`;
  if (u.protocol === "wss:") return `https://${u.host}`;
  if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.host}`;
  throw new Error(`Unsupported URL protocol for loadtest auth: ${u.protocol}`);
}

async function loginForCookie(opts: {
  wsUrl: string;
  email: string;
  password: string;
  sessionCookieName: string;
}): Promise<string> {
  const baseUrl = resolveHttpBaseUrlFromWs(opts.wsUrl);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`login failed: HTTP ${res.status} ${res.statusText} ${body}`.trim());
  }

  const expectedPrefix = `${opts.sessionCookieName}=`;
  const getSetCookie = (res.headers as any)?.getSetCookie;
  if (typeof getSetCookie === "function") {
    const values = getSetCookie.call(res.headers);
    if (Array.isArray(values) && values.length > 0) {
      const pair = values
        .map(extractCookiePair)
        .find((value) => value.startsWith(expectedPrefix));
      if (pair) return pair;
    }
  }

  const fallback = res.headers.get("set-cookie");
  if (!fallback) throw new Error(`login succeeded but no ${opts.sessionCookieName} cookie was returned`);
  const pair = splitCombinedSetCookieHeader(fallback)
    .map(extractCookiePair)
    .find((value) => value.startsWith(expectedPrefix));
  if (!pair) throw new Error(`login succeeded but ${opts.sessionCookieName} cookie was not found`);
  return pair;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cpuCount = os.cpus().length;
  const authCookie =
    opts.authEnabled
      ? await loginForCookie({
          wsUrl: opts.url,
          email: opts.authEmail,
          password: opts.authPassword,
          sessionCookieName: opts.sessionCookieName,
        })
      : null;

  const serverRssStartKb = opts.serverPid ? readRssKb(opts.serverPid) : null;

  let opened = 0;
  let failed = 0;
  let closed = 0;

  let msgCount = 0;
  let msgBytes = 0;
  let quoteUpdateCount = 0;
  let quoteSnapshotCount = 0;
  let peakOpen = 0;

  const sockets: WebSocket[] = [];
  const startAt = Date.now();
  const endAt = startAt + opts.durationSec * 1000;

  const spawnTotalMs = opts.rampSec === 0 ? 0 : opts.rampSec * 1000;
  const perTick = spawnTotalMs === 0 ? opts.clients : Math.max(1, Math.floor(opts.clients / (spawnTotalMs / 100)));

  console.log(
    `[wsFanout] url=${opts.url} origin=${opts.origin ?? "(none)"} clients=${opts.clients} durationSec=${opts.durationSec} rampSec=${opts.rampSec} symbols=${opts.symbols.length} cpu=${cpuCount} auth=${authCookie ? "session-cookie" : "none"}`,
  );
  if (opts.serverPid) {
    console.log(`[wsFanout] serverPid=${opts.serverPid} rssStart=${serverRssStartKb ? `${serverRssStartKb}KB` : "n/a"}`);
  }

  const connectOne = () => {
    const headers: Record<string, string> = {};
    if (opts.origin) headers.Origin = opts.origin;
    if (authCookie) headers.Cookie = authCookie;
    const ws = new WebSocket(opts.url, { perMessageDeflate: false, headers });
    sockets.push(ws);
    ws.on("open", () => {
      opened++;
      ws.send(JSON.stringify({ type: "auth:hello" }));
      ws.send(JSON.stringify({ type: "quotes:subscribe", symbols: opts.symbols }));
    });
    ws.on("message", (data) => {
      msgCount++;
      const size = typeof data === "string" ? Buffer.byteLength(data) : data.length;
      msgBytes += size;
      try {
        const parsed = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
        if (parsed?.type === "quotes:update") quoteUpdateCount++;
        if (parsed?.type === "quotes:snapshot") quoteSnapshotCount++;
      } catch {
        // ignore
      }
    });
    ws.on("close", () => {
      closed++;
    });
    ws.on("error", () => {
      failed++;
    });
  };

  // Ramp connections up.
  let spawned = 0;
  const spawnTimer = setInterval(() => {
    const batch = Math.min(perTick, opts.clients - spawned);
    for (let i = 0; i < batch; i++) connectOne();
    spawned += batch;
    if (spawned >= opts.clients) clearInterval(spawnTimer);
  }, spawnTotalMs === 0 ? 0 : 100);

  // Report loop.
  const reportTimer = setInterval(() => {
    const now = Date.now();
    const elapsedSec = Math.max(1, (now - startAt) / 1000);
    const mps = msgCount / elapsedSec;
    const bps = msgBytes / elapsedSec;
    const openNow = opened - closed;
    peakOpen = Math.max(peakOpen, openNow);
    console.log(
      `[wsFanout] t=${Math.round(elapsedSec)}s open=${openNow} opened=${opened} failed=${failed} mps=${mps.toFixed(
        1,
      )} bps=${fmtBytes(bps)}/s`,
    );
  }, 2000);

  // Stop after duration.
  const stopTimer = setInterval(() => {
    if (Date.now() < endAt) return;
    clearInterval(stopTimer);
    clearInterval(reportTimer);
    clearInterval(spawnTimer);
    const openBeforeDrain = opened - closed;
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    setTimeout(() => {
      const elapsedSec = Math.max(1, (Date.now() - startAt) / 1000);
      const mps = msgCount / elapsedSec;
      const bps = msgBytes / elapsedSec;
      const approxPerUserBps = opened > 0 ? bps / opened : 0;
      const approxFor100k = approxPerUserBps * 100_000;

      const serverRssEndKb = opts.serverPid ? readRssKb(opts.serverPid) : null;
      const deltaRssKb =
        serverRssStartKb != null && serverRssEndKb != null ? serverRssEndKb - serverRssStartKb : null;
      const perConnKb = deltaRssKb != null && opened > 0 ? deltaRssKb / opened : null;

      console.log("");
      console.log(`[wsFanout] done elapsed=${elapsedSec.toFixed(1)}s opened=${opened} failed=${failed} closed=${closed}`);
      console.log(
        `[wsFanout] recv mps=${mps.toFixed(1)} bps=${fmtBytes(bps)}/s quoteSnapshots=${quoteSnapshotCount} quoteUpdates=${quoteUpdateCount}`,
      );
      console.log(`[wsFanout] openBeforeDrain=${openBeforeDrain} peakOpen=${peakOpen}`);
      console.log(`[wsFanout] extrapolated outbound for 100k ~ ${fmtBytes(approxFor100k)}/s (no WS compression)`);
      if (opts.serverPid) {
        console.log(
          `[wsFanout] server rss end=${serverRssEndKb ? `${serverRssEndKb}KB` : "n/a"} delta=${
            deltaRssKb != null ? `${deltaRssKb}KB` : "n/a"
          } perConn=${perConnKb != null ? `${perConnKb.toFixed(2)}KB` : "n/a"}`,
        );
      }

      const failures: string[] = [];
      if (opened < opts.minOpened) {
        failures.push(`opened=${opened} below min-opened=${opts.minOpened}`);
      }
      if (failed > opts.maxFailed) {
        failures.push(`failed=${failed} above max-failed=${opts.maxFailed}`);
      }
      if (openBeforeDrain < opts.minOpenBeforeDrain) {
        failures.push(
          `openBeforeDrain=${openBeforeDrain} below min-open-before-drain=${opts.minOpenBeforeDrain} (connections churned before test end)`,
        );
      }
      if (quoteUpdateCount < opts.minQuoteUpdates) {
        failures.push(`quoteUpdates=${quoteUpdateCount} below min-quote-updates=${opts.minQuoteUpdates}`);
      }

      if (failures.length > 0) {
        console.error("[wsFanout] assertions failed:");
        for (const f of failures) console.error(`[wsFanout]  - ${f}`);
        process.exit(1);
        return;
      }

      console.log("[wsFanout] assertions passed");
      process.exit(0);
    }, 2000);
  }, 250);

  process.on("SIGINT", () => {
    clearInterval(stopTimer);
    clearInterval(reportTimer);
    clearInterval(spawnTimer);
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {}
    }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[wsFanout] fatal:", err);
  process.exit(1);
});
