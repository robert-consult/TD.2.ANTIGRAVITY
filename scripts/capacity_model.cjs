/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function toInt(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

function bytes(n) {
  if (!Number.isFinite(n)) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}

function ratePerSec(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  return 1000 / intervalMs;
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function sumFileSizes(globDir, matcher) {
  let total = 0;
  for (const entry of safeReadDir(globDir)) {
    if (matcher && !matcher(entry)) continue;
    const st = safeStat(path.join(globDir, entry));
    if (st?.isFile()) total += st.size;
  }
  return total;
}

function byteLenJson(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function detectColumnSet(db, tableName) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set(rows.map((r) => String(r.name)));
  } catch {
    return new Set();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const activeUsers = toInt(args.activeUsers, 100_000);
  const admins = toInt(args.admins, 5);
  const quotePollMs = toInt(args.quotePollMs, 870);
  const authPollMs = toInt(args.authPollMs, 2000);
  const pendingPollMs = toInt(args.pendingPollMs, 10_000);
  const pctUsersOnTradeScreen = Math.min(1, Math.max(0, toFloat(args.pctTradeScreen, 0.2)));
  const pctUsersOnAccountScreen = Math.min(1, Math.max(0, toFloat(args.pctAccountScreen, 0.1)));

  const appRoot = path.resolve(__dirname, "..");
  const dbPath = path.resolve(appRoot, args.dbPath ? String(args.dbPath) : "trading_app.db");

  // --- Static assets (built) ---
  const distPublic = path.join(appRoot, "dist", "public");
  const assetsDir = path.join(distPublic, "assets");
  const jsBytes = sumFileSizes(assetsDir, (n) => n.endsWith(".js"));
  const cssBytes = sumFileSizes(assetsDir, (n) => n.endsWith(".css"));
  const htmlBytes = safeStat(path.join(distPublic, "index.html"))?.size ?? 0;

  // --- DB inspection ---
  let Database;
  try {
    // eslint-disable-next-line global-require
    Database = require("better-sqlite3");
  } catch (e) {
    console.error("Missing dependency: better-sqlite3. Run `npm i` first.");
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name)),
  );

  const maybeCount = (tableName) => {
    if (!tables.has(tableName)) return null;
    try {
      return db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get().c;
    } catch {
      return null;
    }
  };

  const counts = {
    users: maybeCount("users"),
    trades: maybeCount("trades"),
    quotes: maybeCount("quotes"),
    symbolConfigs: maybeCount("symbol_configs"),
    journal: maybeCount("trader_journal"),
    accountEvents: maybeCount("user_account_events"),
    adminActions: maybeCount("admin_actions"),
  };

  // Approximate payload sizes by building representative JSON from local DB.
  let quotesLatestBytes = null;
  let quotesLatestBenchMs = null;
  if (tables.has("quotes")) {
    const quoteCols = detectColumnSet(db, "quotes");
    const hasIsStale = quoteCols.has("is_stale");
    const hasLastApiUpdate = quoteCols.has("last_api_update");
    const hasUpdatedAt = quoteCols.has("updated_at");
    const hasTimestamp = quoteCols.has("timestamp");

    const sel = [
      "symbol",
      "bid",
      "ask",
      "price",
      hasIsStale ? "is_stale" : "0 AS is_stale",
      hasLastApiUpdate
        ? "last_api_update"
        : hasUpdatedAt
          ? "updated_at AS last_api_update"
          : hasTimestamp
            ? "timestamp AS last_api_update"
            : "NULL AS last_api_update",
      hasUpdatedAt
        ? "updated_at"
        : hasTimestamp
          ? "timestamp AS updated_at"
          : "NULL AS updated_at",
      hasTimestamp
        ? "timestamp"
        : hasUpdatedAt
          ? "updated_at AS timestamp"
          : hasLastApiUpdate
            ? "last_api_update AS timestamp"
            : "NULL AS timestamp",
    ].join(", ");

    const rows = db.prepare(`SELECT ${sel} FROM quotes`).all();
    const nowMs = Date.now();
    const staleThresholdMs = 30_000;
    const enhanced = rows.map((r) => {
      const bid = typeof r.bid === "number" ? r.bid : r.bid == null ? null : Number(r.bid);
      const ask = typeof r.ask === "number" ? r.ask : r.ask == null ? null : Number(r.ask);
      const lastPrice = typeof r.price === "number" ? r.price : r.price == null ? null : Number(r.price);
      const midPrice = bid != null && ask != null ? (bid + ask) / 2 : lastPrice;
      const spread = bid != null && ask != null ? Math.abs(ask - bid) : null;

      const lastApiRaw = r.last_api_update ?? r.updated_at ?? r.timestamp ?? nowMs;
      const lastApiNum = Number(lastApiRaw);
      const lastApiMs = Number.isFinite(lastApiNum) ? (lastApiNum < 1e12 ? lastApiNum * 1000 : lastApiNum) : nowMs;
      const ageMs = nowMs - lastApiMs;
      const dbIsStale = Number(r.is_stale ?? 0) === 1;
      const isStale = dbIsStale || ageMs > staleThresholdMs;

      return {
        symbol: String(r.symbol),
        bid: bid ?? null,
        ask: ask ?? null,
        price: Number.isFinite(midPrice) ? midPrice : null,
        spread,
        prevClose: Number.isFinite(midPrice) ? midPrice : null,
        change: 0,
        pctChange: 0,
        isStale,
        lastApiUpdate: lastApiMs,
        dataAge: ageMs,
        timestamp: Math.floor(nowMs / 1000),
      };
    });

    quotesLatestBytes = byteLenJson(enhanced);

    // Optional micro-benchmark: approximate per-request work for /api/quotes/latest handler
    // (open DB, query, map, stringify, close)
    const benchIters = toInt(args.benchQuotes, 0);
    if (benchIters > 0) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < benchIters; i += 1) {
        const dbi = new Database(dbPath, { readonly: true, fileMustExist: true });
        const rws = dbi.prepare(`SELECT ${sel} FROM quotes`).all();
        const now = Date.now();
        const out = rws.map((rr) => ({
          symbol: String(rr.symbol),
          bid: rr.bid ?? null,
          ask: rr.ask ?? null,
          price: rr.price ?? null,
          ts: now,
        }));
        void JSON.stringify(out);
        dbi.close();
      }
      const t1 = process.hrtime.bigint();
      const totalMs = Number(t1 - t0) / 1e6;
      quotesLatestBenchMs = totalMs / benchIters;
    }
  }

  let symbolConfigsBytes = null;
  if (tables.has("symbol_configs")) {
    try {
      const rows = db.prepare("SELECT * FROM symbol_configs").all();
      symbolConfigsBytes = byteLenJson(rows);
    } catch {
      symbolConfigsBytes = null;
    }
  }

  // Representative current-user payload size (approx shape; actual endpoint also recalcs)
  let currentUserBytes = null;
  if (tables.has("users")) {
    try {
      const u = db.prepare("SELECT * FROM users LIMIT 1").get();
      if (u) {
        const payload = {
          id: u.id ?? 1,
          email: u.email ?? "",
          username: u.username ?? "",
          name: u.name ?? "",
          phone: u.phone ?? "",
          countryIso2: u.countryIso2 ?? null,
          balance: u.balance ?? "0",
          isAdmin: Boolean(u.isAdmin ?? false),
          equity: u.equity ?? null,
          freeMargin: u.freeMargin ?? null,
          usedMargin: u.usedMargin ?? null,
          leverage: u.leverage ?? null,
          createdAt: u.createdAt ?? null,
          userTier: u.userTier ?? "CANDIDATE",
          contenderTier: u.contenderTier ?? null,
          emailVerified: false,
          emailVerifiedAt: null,
          inGracePeriod: false,
          gracePeriodEndsAt: null,
          legalReacceptRequired: false,
          legalReacceptBlocked: false,
          legalReacceptBlockedReason: null,
          legalRequiredCombinedSha256: null,
          legalLastAcceptedCombinedSha256: null,
          isImpersonating: false,
          realAdminId: null,
          realAdminEmail: null,
        };
        currentUserBytes = byteLenJson(payload);
      }
    } catch {
      currentUserBytes = null;
    }
  }

  db.close();

  // --- Traffic model (as implemented in client) ---
  const quotesRpsPerUser = ratePerSec(quotePollMs);
  const authRpsPerUser = ratePerSec(authPollMs);
  const pendingRpsPerUser = ratePerSec(pendingPollMs);

  const quotesRps = activeUsers * quotesRpsPerUser;
  const authRps = activeUsers * authRpsPerUser;
  const pendingRps = activeUsers * pctUsersOnTradeScreen * pendingRpsPerUser;

  const quotesEgressBps = quotesLatestBytes ? quotesRps * quotesLatestBytes : null;
  const authEgressBps = currentUserBytes ? authRps * currentUserBytes : null;

  console.log("=== Capacity Snapshot (code-as-written) ===");
  console.log("Users:", activeUsers, "Admins:", admins);
  console.log("Polling:", { quotePollMs, authPollMs, pendingPollMs, pctUsersOnTradeScreen, pctUsersOnAccountScreen });
  console.log("");
  console.log("Static build (uncached, uncompressed):", {
    html: bytes(htmlBytes),
    js: bytes(jsBytes),
    css: bytes(cssBytes),
    total: bytes(htmlBytes + jsBytes + cssBytes),
  });
  console.log("");
  console.log("DB counts:", counts);
  console.log("Measured JSON sizes:", {
    quotesLatest: quotesLatestBytes ? bytes(quotesLatestBytes) : "n/a",
    symbolConfigs: symbolConfigsBytes ? bytes(symbolConfigsBytes) : "n/a",
    currentUserApprox: currentUserBytes ? bytes(currentUserBytes) : "n/a",
  });
  if (quotesLatestBenchMs) {
    console.log(
      "Micro-benchmark (/api/quotes/latest work, local machine):",
      `${quotesLatestBenchMs.toFixed(2)} ms/req (~${Math.round(1000 / quotesLatestBenchMs)} req/s per Node process)`,
    );
  }
  console.log("");
  console.log("Derived request rates (RPS):", {
    quotesLatest: Math.round(quotesRps),
    authCurrentUser: Math.round(authRps),
    pendingOrders: Math.round(pendingRps),
  });
  console.log("Derived egress (bytes/sec):", {
    quotesLatest: quotesEgressBps ? bytes(quotesEgressBps) + "/s" : "n/a",
    authCurrentUser: authEgressBps ? bytes(authEgressBps) + "/s" : "n/a",
  });
  console.log("");
  console.log(
    "NOTE: /api/auth/current-user triggers recalcAccount() per request in server/routes.ts, which is not CPU/DB-feasible at these RPS.",
  );
}

main();
