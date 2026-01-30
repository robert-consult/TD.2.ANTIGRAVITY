import Redis from "ioredis";

let client: Redis | null = null;

export function getValkey(): Redis | null {
  const url = process.env.VALKEY_URL;
  if (!url) return null;
  if (client) return client;

  client = new Redis(url, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  client.on("error", () => {
    // Silent by design; callers should handle null-ish behavior via wrappers.
  });

  return client;
}

export async function valkeyIncrWithTtl(key: string, ttlSec: number): Promise<number | null> {
  const v = getValkey();
  if (!v) return null;
  try {
    const n = await v.incr(key);
    if (n === 1) await v.expire(key, ttlSec);
    return n;
  } catch {
    return null;
  }
}

export async function valkeySAddWithTtl(key: string, value: string, ttlSec: number): Promise<number | null> {
  const v = getValkey();
  if (!v) return null;
  try {
    const added = await v.sadd(key, value);
    await v.expire(key, ttlSec);
    return added;
  } catch {
    return null;
  }
}

export async function valkeyGetJson<T>(key: string): Promise<T | null> {
  const v = getValkey();
  if (!v) return null;
  try {
    const raw = await v.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function valkeySetJson(key: string, value: unknown, ttlSec: number): Promise<boolean> {
  const v = getValkey();
  if (!v) return false;
  try {
    await v.set(key, JSON.stringify(value), "EX", ttlSec);
    return true;
  } catch {
    return false;
  }
}

// Rolling buffer constants
const ROLLING_BUFFER_TTL_SEC = 60; // Keep ZSET alive for 60s
const ROLLING_BUFFER_WINDOW_MS = 30_000; // 30 seconds of history

/**
 * Write a quote to the rolling price buffer (ZSET with timestamp as score).
 * Key: quote:rolling:{symbol}
 */
export async function writeToRollingBuffer(
  symbol: string,
  data: { bid: number | null; ask: number | null; price: number | null; lastApiUpdate: number }
): Promise<boolean> {
  const v = getValkey();
  if (!v) return false;
  const key = `quote:rolling:${symbol}`;
  const score = data.lastApiUpdate || Date.now();
  const member = JSON.stringify(data);
  try {
    const pipeline = v.pipeline();
    // Add new entry
    pipeline.zadd(key, score, member);
    // Remove entries older than 30 seconds
    pipeline.zremrangebyscore(key, "-inf", score - ROLLING_BUFFER_WINDOW_MS);
    // Set TTL on the key
    pipeline.expire(key, ROLLING_BUFFER_TTL_SEC);
    await pipeline.exec();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the latest quote from rolling buffer.
 */
export async function getFromRollingBuffer(
  symbol: string
): Promise<{ bid: number | null; ask: number | null; price: number | null; lastApiUpdate: number } | null> {
  const v = getValkey();
  if (!v) return null;
  const key = `quote:rolling:${symbol}`;
  try {
    const results = await v.zrevrange(key, 0, 0);
    if (!results || results.length === 0) return null;
    return JSON.parse(results[0]);
  } catch {
    return null;
  }
}

/**
 * Get recent quotes from rolling buffer (up to last 30 seconds).
 */
export async function getRollingBufferHistory(
  symbol: string,
  windowMs: number = ROLLING_BUFFER_WINDOW_MS
): Promise<Array<{ bid: number | null; ask: number | null; price: number | null; lastApiUpdate: number }>> {
  const v = getValkey();
  if (!v) return [];
  const key = `quote:rolling:${symbol}`;
  const now = Date.now();
  try {
    const results = await v.zrangebyscore(key, now - windowMs, now);
    return results.map((r) => JSON.parse(r));
  } catch {
    return [];
  }
}

// prevClose cache key prefix
const PREV_CLOSE_PREFIX = "prevClose:";
const PREV_CLOSE_TTL_SEC = 86400; // 24 hours

/**
 * Cache prevClose for a symbol (used for change calculation).
 */
export async function cachePrevClose(symbol: string, close: number): Promise<boolean> {
  const v = getValkey();
  if (!v) return false;
  try {
    await v.set(`${PREV_CLOSE_PREFIX}${symbol}`, String(close), "EX", PREV_CLOSE_TTL_SEC);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get cached prevClose for a symbol.
 */
export async function getCachedPrevClose(symbol: string): Promise<number | null> {
  const v = getValkey();
  if (!v) return null;
  try {
    const raw = await v.get(`${PREV_CLOSE_PREFIX}${symbol}`);
    if (!raw) return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

