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

