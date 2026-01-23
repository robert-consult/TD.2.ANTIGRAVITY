import fs from "node:fs";
import os from "node:os";
import WebSocket from "ws";

type Args = {
  url: string;
  clients: number;
  durationSec: number;
  rampSec: number;
  symbols: string[];
  serverPid: number | null;
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
  const clients = Number(args.get("clients") ?? 1000);
  const durationSec = Number(args.get("duration-sec") ?? 30);
  const rampSec = Number(args.get("ramp-sec") ?? 10);
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
  if (!symbols.length) throw new Error("--symbols must include at least 1 symbol");

  return { url, clients, durationSec, rampSec, symbols, serverPid: serverPid ?? null };
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cpuCount = os.cpus().length;

  const serverRssStartKb = opts.serverPid ? readRssKb(opts.serverPid) : null;

  let opened = 0;
  let failed = 0;
  let closed = 0;

  let msgCount = 0;
  let msgBytes = 0;
  let quoteUpdateCount = 0;

  const sockets: WebSocket[] = [];
  const startAt = Date.now();
  const endAt = startAt + opts.durationSec * 1000;

  const spawnTotalMs = opts.rampSec === 0 ? 0 : opts.rampSec * 1000;
  const perTick = spawnTotalMs === 0 ? opts.clients : Math.max(1, Math.floor(opts.clients / (spawnTotalMs / 100)));

  console.log(
    `[wsFanout] url=${opts.url} clients=${opts.clients} durationSec=${opts.durationSec} rampSec=${opts.rampSec} symbols=${opts.symbols.length} cpu=${cpuCount}`,
  );
  if (opts.serverPid) {
    console.log(`[wsFanout] serverPid=${opts.serverPid} rssStart=${serverRssStartKb ? `${serverRssStartKb}KB` : "n/a"}`);
  }

  const connectOne = () => {
    const ws = new WebSocket(opts.url, { perMessageDeflate: false });
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
      console.log(`[wsFanout] recv mps=${mps.toFixed(1)} bps=${fmtBytes(bps)}/s quoteUpdates=${quoteUpdateCount}`);
      console.log(`[wsFanout] extrapolated outbound for 100k ~ ${fmtBytes(approxFor100k)}/s (no WS compression)`);
      if (opts.serverPid) {
        console.log(
          `[wsFanout] server rss end=${serverRssEndKb ? `${serverRssEndKb}KB` : "n/a"} delta=${
            deltaRssKb != null ? `${deltaRssKb}KB` : "n/a"
          } perConn=${perConnKb != null ? `${perConnKb.toFixed(2)}KB` : "n/a"}`,
        );
      }
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

