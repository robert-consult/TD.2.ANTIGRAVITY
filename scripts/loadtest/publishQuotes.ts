import crypto from "node:crypto";
import Redis from "ioredis";

type Args = {
  intervalMs: number;
  durationSec: number;
  channel: string;
  symbols: string[];
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

  const intervalMs = Number(args.get("interval-ms") ?? 1000);
  const durationSec = Number(args.get("duration-sec") ?? 60);
  const channel = String(args.get("channel") ?? process.env.LIVEBUS_CHANNEL ?? "livebus:events");
  const symbolsRaw = String(args.get("symbols") ?? "EURUSD,GBPUSD,USDJPY,AUDUSD");
  const symbols = symbolsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("--interval-ms must be > 0");
  if (!Number.isFinite(durationSec) || durationSec < 0) throw new Error("--duration-sec must be >= 0");
  if (!symbols.length) throw new Error("--symbols must include at least 1 symbol");

  return { intervalMs, durationSec, channel, symbols };
}

function spreadFor(symbol: string) {
  return symbol.includes("JPY") ? 0.02 : 0.0002;
}

function basePriceFor(symbol: string) {
  const defaults: Record<string, number> = {
    EURUSD: 1.09421,
    GBPUSD: 1.27152,
    USDJPY: 144.87,
    AUDUSD: 0.65321,
    USDCAD: 1.35982,
    NZDUSD: 0.61024,
    USDCHF: 0.89758,
  };
  return defaults[symbol] ?? 1 + Math.random();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const valkeyUrl = process.env.VALKEY_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";

  const redis = new Redis(valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });
  await redis.connect();

  const origin = `loadtest:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
  let seq = 0;
  let sent = 0;
  let sentBytes = 0;
  const last = new Map<string, number>();

  for (const s of opts.symbols) last.set(s, basePriceFor(s));

  const endAt = opts.durationSec === 0 ? null : Date.now() + opts.durationSec * 1000;
  console.log(
    `[publishQuotes] channel=${opts.channel} intervalMs=${opts.intervalMs} durationSec=${opts.durationSec} symbols=${opts.symbols.length}`,
  );

  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (endAt && Date.now() >= endAt) {
      if (timer) clearInterval(timer);
      await redis.quit();
      console.log(`[publishQuotes] done sent=${sent} approxPayloadBytes=${sentBytes}`);
      process.exit(0);
    }

    const asOf = Date.now();
    const rows = opts.symbols.map((symbol) => {
      const prev = last.get(symbol) ?? basePriceFor(symbol);
      const delta = prev * (Math.random() * 0.0006 - 0.0003);
      const mid = prev + delta;
      last.set(symbol, mid);
      const spread = spreadFor(symbol);
      const bid = mid - spread / 2;
      const ask = mid + spread / 2;
      return {
        symbol,
        bid,
        ask,
        price: mid,
        lastApiUpdate: asOf,
        isStale: false,
      };
    });

    const payload = {
      type: "quotes:update",
      ts: asOf,
      payload: {
        seq: ++seq,
        asOf,
        source: origin,
        rows,
      },
      __origin: origin,
    };

    const body = JSON.stringify(payload);
    await redis.publish(opts.channel, body);
    sent++;
    sentBytes += Buffer.byteLength(body);
  };

  timer = setInterval(() => {
    tick().catch((err) => {
      console.error("[publishQuotes] error:", err);
      process.exitCode = 1;
      try {
        redis.disconnect();
      } catch {}
      process.exit(1);
    });
  }, opts.intervalMs);

  process.on("SIGINT", async () => {
    if (timer) clearInterval(timer);
    try {
      await redis.quit();
    } catch {}
    console.log(`[publishQuotes] interrupted sent=${sent} approxPayloadBytes=${sentBytes}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[publishQuotes] fatal:", err);
  process.exit(1);
});

