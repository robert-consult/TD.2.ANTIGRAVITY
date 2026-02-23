import { getValkey, getValkeySubscriber } from "../services/valkey";

type Side = "BUY" | "SELL";

type TradeExcursionState = {
  openPrice: number;
  high: number;
  low: number;
  updatedAtMs: number;
};

const inMemoryExcursions = new Map<number, TradeExcursionState>();

const EXCURSION_KEY_PREFIX = String(process.env.TRADE_EXCURSION_KEY_PREFIX ?? "trade:excursion:v1").trim() || "trade:excursion:v1";
const EXCURSION_PUBSUB_CHANNEL =
  String(process.env.TRADE_EXCURSION_PUBSUB_CHANNEL ?? "trade:excursion:updates").trim() ||
  "trade:excursion:updates";
const EXCURSION_DURABLE_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.TRADE_EXCURSION_DURABLE_ENABLED ?? "1").trim().toLowerCase(),
);
const EXCURSION_PUBSUB_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.TRADE_EXCURSION_PUBSUB_ENABLED ?? "1").trim().toLowerCase(),
);
const EXCURSION_TTL_SEC = (() => {
  const parsed = Number(process.env.TRADE_EXCURSION_TTL_SEC ?? 172_800);
  if (!Number.isFinite(parsed)) return 172_800;
  return Math.max(60, Math.min(604_800, Math.trunc(parsed)));
})();

const MERGE_EXCURSION_LUA = `
local existing = redis.call("GET", KEYS[1])
local openPrice = tonumber(ARGV[1])
local markPrice = tonumber(ARGV[2])
local updatedAtMs = tonumber(ARGV[3])
local ttlSec = tonumber(ARGV[4])
local inputHigh = tonumber(ARGV[5])
local inputLow = tonumber(ARGV[6])

local state = {}
if existing and #existing > 0 then
  state = cjson.decode(existing)
else
  state.openPrice = openPrice
  state.high = openPrice
  state.low = openPrice
end

local baseOpen = tonumber(state.openPrice) or openPrice
local high = tonumber(state.high) or baseOpen
local low = tonumber(state.low) or baseOpen

if inputHigh then
  if inputHigh > high then high = inputHigh end
end
if inputLow then
  if inputLow < low then low = inputLow end
end
if markPrice then
  if markPrice > high then high = markPrice end
  if markPrice < low then low = markPrice end
end
if openPrice then
  if openPrice > high then high = openPrice end
  if openPrice < low then low = openPrice end
end

state.openPrice = baseOpen
state.high = high
state.low = low
state.updatedAtMs = updatedAtMs

local encoded = cjson.encode(state)
redis.call("SET", KEYS[1], encoded, "EX", ttlSec)
return encoded
`;

let pubSubInitPromise: Promise<boolean> | null = null;
let pubSubListenerAttached = false;

function toFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeOpenPrice(openPrice: unknown): number | null {
  const n = toFinite(openPrice);
  if (n == null || n <= 0) return null;
  return n;
}

function toRounded(value: number): number {
  return Number(value.toFixed(6));
}

function tradeExcursionKey(tradeId: number): string {
  return `${EXCURSION_KEY_PREFIX}:${tradeId}`;
}

function normalizeBounds(openPrice: number, values: Array<number | null>): { high: number; low: number } {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!finite.length) return { high: openPrice, low: openPrice };
  const high = Math.max(...finite, openPrice);
  const low = Math.min(...finite, openPrice);
  return { high, low };
}

function parseDurableState(raw: unknown): TradeExcursionState | null {
  let parsed: any = null;
  try {
    if (raw == null) return null;
    if (typeof raw === "string") parsed = JSON.parse(raw);
    else if (Buffer.isBuffer(raw)) parsed = JSON.parse(raw.toString("utf8"));
    else if (typeof raw === "object") parsed = raw;
    else return null;
  } catch {
    return null;
  }

  const openPrice = sanitizeOpenPrice(parsed?.openPrice);
  const high = toFinite(parsed?.high);
  const low = toFinite(parsed?.low);
  const updatedAtMs = toFinite(parsed?.updatedAtMs) ?? Date.now();
  if (openPrice == null || high == null || low == null) return null;

  const bounds = normalizeBounds(openPrice, [high, low]);
  return {
    openPrice,
    high: bounds.high,
    low: bounds.low,
    updatedAtMs,
  };
}

async function readDurableExcursionState(tradeId: number): Promise<TradeExcursionState | null> {
  if (!EXCURSION_DURABLE_ENABLED) return null;
  const v = getValkey();
  if (!v) return null;

  try {
    const raw = await v.get(tradeExcursionKey(tradeId));
    return parseDurableState(raw);
  } catch {
    return null;
  }
}

async function publishExcursionUpdate(
  tradeId: number,
  payload: TradeExcursionState | { cleared: true; updatedAtMs: number },
): Promise<void> {
  if (!EXCURSION_DURABLE_ENABLED || !EXCURSION_PUBSUB_ENABLED) return;
  const v = getValkey();
  if (!v) return;

  try {
    await v.publish(
      EXCURSION_PUBSUB_CHANNEL,
      JSON.stringify({
        tradeId,
        ...payload,
      }),
    );
  } catch {
    // best-effort pubsub
  }
}

async function mergeDurableExcursion(params: {
  tradeId: number;
  openPrice: number;
  markPrice: number;
  intradayHigh?: number | null;
  intradayLow?: number | null;
  skipWriteWhenUnchanged?: boolean;
}): Promise<TradeExcursionState | null> {
  if (!EXCURSION_DURABLE_ENABLED) return null;
  const v = getValkey();
  if (!v) return null;

  const current = inMemoryExcursions.get(params.tradeId);
  const nextBounds = normalizeBounds(params.openPrice, [
    current?.high ?? null,
    current?.low ?? null,
    params.intradayHigh ?? null,
    params.intradayLow ?? null,
    params.markPrice,
  ]);
  if (
    params.skipWriteWhenUnchanged &&
    current &&
    current.openPrice === params.openPrice &&
    current.high === nextBounds.high &&
    current.low === nextBounds.low
  ) {
    return current;
  }

  try {
    const raw = await v.eval(
      MERGE_EXCURSION_LUA,
      1,
      tradeExcursionKey(params.tradeId),
      String(params.openPrice),
      String(params.markPrice),
      String(Date.now()),
      String(EXCURSION_TTL_SEC),
      params.intradayHigh == null ? "" : String(params.intradayHigh),
      params.intradayLow == null ? "" : String(params.intradayLow),
    );
    const durable = parseDurableState(raw);
    if (!durable) return null;

    const prior = inMemoryExcursions.get(params.tradeId);
    const mergedBounds = normalizeBounds(durable.openPrice, [
      durable.high,
      durable.low,
      prior?.high ?? null,
      prior?.low ?? null,
    ]);
    const merged: TradeExcursionState = {
      openPrice: durable.openPrice,
      high: mergedBounds.high,
      low: mergedBounds.low,
      updatedAtMs: Math.max(durable.updatedAtMs, prior?.updatedAtMs ?? 0),
    };

    inMemoryExcursions.set(params.tradeId, merged);

    if (!prior || prior.high !== merged.high || prior.low !== merged.low) {
      void publishExcursionUpdate(params.tradeId, merged);
    }

    return merged;
  } catch {
    return null;
  }
}

function mergeTrackedBounds(params: {
  tradeId: number;
  openPrice: number;
  closePrice: number;
  intradayHigh?: unknown;
  intradayLow?: unknown;
  externalHigh?: number | null;
  externalLow?: number | null;
}) {
  const local = inMemoryExcursions.get(params.tradeId);
  const bounds = normalizeBounds(params.openPrice, [
    params.closePrice,
    local?.high ?? null,
    local?.low ?? null,
    toFinite(params.intradayHigh),
    toFinite(params.intradayLow),
    params.externalHigh ?? null,
    params.externalLow ?? null,
  ]);
  return { bounds, local };
}

function resolveTradeExcursionForCloseCore(params: {
  side: Side;
  openPrice: number;
  bounds: { high: number; low: number };
}) {
  let maeRaw = 0;
  let mfeRaw = 0;

  if (params.side === "BUY") {
    maeRaw = (params.openPrice - params.bounds.low) / params.openPrice;
    mfeRaw = (params.bounds.high - params.openPrice) / params.openPrice;
  } else {
    maeRaw = (params.bounds.high - params.openPrice) / params.openPrice;
    mfeRaw = (params.openPrice - params.bounds.low) / params.openPrice;
  }

  const mae = Number.isFinite(maeRaw) ? toRounded(Math.max(0, maeRaw)) : null;
  const mfe = Number.isFinite(mfeRaw) ? toRounded(Math.max(0, mfeRaw)) : null;

  return {
    intradayHigh: toRounded(params.bounds.high),
    intradayLow: toRounded(params.bounds.low),
    mae,
    mfe,
  };
}

function handleExcursionPubSubMessage(raw: string): void {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const tradeId = Number(parsed?.tradeId);
  if (!Number.isInteger(tradeId) || tradeId <= 0) return;

  const existing = inMemoryExcursions.get(tradeId);
  // Prevent unbounded memory growth on high-fanout systems.
  if (!existing) return;

  if (parsed?.cleared) {
    inMemoryExcursions.delete(tradeId);
    return;
  }

  const openPrice = sanitizeOpenPrice(parsed?.openPrice) ?? existing.openPrice;
  const bounds = normalizeBounds(openPrice, [existing.high, existing.low, toFinite(parsed?.high), toFinite(parsed?.low)]);
  const updatedAtMs = toFinite(parsed?.updatedAtMs) ?? Date.now();

  inMemoryExcursions.set(tradeId, {
    openPrice,
    high: bounds.high,
    low: bounds.low,
    updatedAtMs: Math.max(existing.updatedAtMs, updatedAtMs),
  });
}

export async function initExcursionTrackingPubSub(): Promise<boolean> {
  if (!EXCURSION_DURABLE_ENABLED || !EXCURSION_PUBSUB_ENABLED) return false;
  if (pubSubInitPromise) return pubSubInitPromise;

  pubSubInitPromise = (async () => {
    const subscriber = getValkeySubscriber();
    if (!subscriber) return false;

    if (!pubSubListenerAttached) {
      subscriber.on("message", (channel: string, message: string) => {
        if (channel !== EXCURSION_PUBSUB_CHANNEL) return;
        handleExcursionPubSubMessage(message);
      });
      pubSubListenerAttached = true;
    }

    try {
      await subscriber.subscribe(EXCURSION_PUBSUB_CHANNEL);
      return true;
    } catch {
      return false;
    }
  })();

  return pubSubInitPromise;
}

export function initTradeExcursion(
  tradeId: number,
  openPriceRaw: unknown,
): { intradayHigh: number; intradayLow: number } | null {
  const openPrice = sanitizeOpenPrice(openPriceRaw);
  if (!openPrice || !Number.isInteger(tradeId) || tradeId <= 0) return null;

  const existing = inMemoryExcursions.get(tradeId);
  const bounds = normalizeBounds(openPrice, [existing?.high ?? null, existing?.low ?? null]);
  const snapshot: TradeExcursionState = {
    openPrice,
    high: bounds.high,
    low: bounds.low,
    updatedAtMs: Date.now(),
  };
  inMemoryExcursions.set(tradeId, snapshot);

  if (EXCURSION_DURABLE_ENABLED) {
    void mergeDurableExcursion({
      tradeId,
      openPrice,
      markPrice: openPrice,
      intradayHigh: snapshot.high,
      intradayLow: snapshot.low,
      skipWriteWhenUnchanged: true,
    });
  }

  return { intradayHigh: snapshot.high, intradayLow: snapshot.low };
}

export function trackTradeExcursion(params: {
  tradeId: number;
  openPrice: unknown;
  markPrice: unknown;
  intradayHigh?: unknown;
  intradayLow?: unknown;
}): { intradayHigh: number; intradayLow: number } | null {
  const openPrice = sanitizeOpenPrice(params.openPrice);
  const markPrice = toFinite(params.markPrice);
  if (!openPrice || markPrice == null || !Number.isInteger(params.tradeId) || params.tradeId <= 0) return null;

  const current = inMemoryExcursions.get(params.tradeId);
  const bounds = normalizeBounds(openPrice, [
    current?.high ?? null,
    current?.low ?? null,
    toFinite(params.intradayHigh),
    toFinite(params.intradayLow),
    markPrice,
  ]);

  const changed =
    !current ||
    current.openPrice !== openPrice ||
    current.high !== bounds.high ||
    current.low !== bounds.low;

  inMemoryExcursions.set(params.tradeId, {
    openPrice,
    high: bounds.high,
    low: bounds.low,
    updatedAtMs: Date.now(),
  });

  if (EXCURSION_DURABLE_ENABLED && changed) {
    void mergeDurableExcursion({
      tradeId: params.tradeId,
      openPrice,
      markPrice,
      intradayHigh: bounds.high,
      intradayLow: bounds.low,
      skipWriteWhenUnchanged: true,
    });
  }

  return {
    intradayHigh: bounds.high,
    intradayLow: bounds.low,
  };
}

export function resolveTradeExcursionForClose(params: {
  tradeId: number;
  side: Side;
  openPrice: unknown;
  closePrice: unknown;
  intradayHigh?: unknown;
  intradayLow?: unknown;
}): { intradayHigh: number | null; intradayLow: number | null; mae: number | null; mfe: number | null } {
  const openPrice = sanitizeOpenPrice(params.openPrice);
  const closePrice = toFinite(params.closePrice);

  if (!openPrice || closePrice == null || closePrice <= 0) {
    return {
      intradayHigh: toFinite(params.intradayHigh),
      intradayLow: toFinite(params.intradayLow),
      mae: null,
      mfe: null,
    };
  }

  const { bounds } = mergeTrackedBounds({
    tradeId: params.tradeId,
    openPrice,
    closePrice,
    intradayHigh: params.intradayHigh,
    intradayLow: params.intradayLow,
  });

  return resolveTradeExcursionForCloseCore({
    side: params.side,
    openPrice,
    bounds,
  });
}

export async function resolveTradeExcursionForCloseDurable(params: {
  tradeId: number;
  side: Side;
  openPrice: unknown;
  closePrice: unknown;
  intradayHigh?: unknown;
  intradayLow?: unknown;
}): Promise<{ intradayHigh: number | null; intradayLow: number | null; mae: number | null; mfe: number | null }> {
  const openPrice = sanitizeOpenPrice(params.openPrice);
  const closePrice = toFinite(params.closePrice);

  if (!openPrice || closePrice == null || closePrice <= 0) {
    return {
      intradayHigh: toFinite(params.intradayHigh),
      intradayLow: toFinite(params.intradayLow),
      mae: null,
      mfe: null,
    };
  }

  const durable = await readDurableExcursionState(params.tradeId);
  const { bounds } = mergeTrackedBounds({
    tradeId: params.tradeId,
    openPrice,
    closePrice,
    intradayHigh: params.intradayHigh,
    intradayLow: params.intradayLow,
    externalHigh: durable?.high ?? null,
    externalLow: durable?.low ?? null,
  });

  const now = Date.now();
  inMemoryExcursions.set(params.tradeId, {
    openPrice,
    high: bounds.high,
    low: bounds.low,
    updatedAtMs: now,
  });

  if (EXCURSION_DURABLE_ENABLED) {
    await mergeDurableExcursion({
      tradeId: params.tradeId,
      openPrice,
      markPrice: closePrice,
      intradayHigh: bounds.high,
      intradayLow: bounds.low,
      skipWriteWhenUnchanged: true,
    });
  }

  return resolveTradeExcursionForCloseCore({
    side: params.side,
    openPrice,
    bounds,
  });
}

export function clearTradeExcursion(tradeId: number): void {
  if (!Number.isInteger(tradeId) || tradeId <= 0) return;
  inMemoryExcursions.delete(tradeId);

  if (!EXCURSION_DURABLE_ENABLED) return;
  const v = getValkey();
  if (!v) return;

  void (async () => {
    try {
      await v.del(tradeExcursionKey(tradeId));
      await publishExcursionUpdate(tradeId, {
        cleared: true,
        updatedAtMs: Date.now(),
      });
    } catch {
      // best-effort cleanup
    }
  })();
}
