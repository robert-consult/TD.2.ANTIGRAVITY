import type { MarketDataProviderConfig } from "@shared/marketDataProviders";
import type { MarketDataProvider } from "./providerTypes";

export type ProviderRateLimitOptions = {
  minTimeMs: number;
  maxConcurrent: number;
  maxQueueSize: number;
};

export type ProviderRateLimitStats = {
  providerKey: string;
  active: number;
  queueLength: number;
  rejectedQueueFullTotal: number;
  startedTotal: number;
};

type QueueItem<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

class AsyncRateLimiter {
  private minTimeMs = 0;
  private maxConcurrent = 1;
  private maxQueueSize = 0;

  private active = 0;
  private lastStartMs = 0;
  private queue: QueueItem<any>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private rejectedQueueFullTotal = 0;
  private startedTotal = 0;

  constructor(opts: ProviderRateLimitOptions) {
    this.setOptions(opts);
  }

  setOptions(opts: ProviderRateLimitOptions) {
    this.minTimeMs = Math.max(0, Math.trunc(Number(opts.minTimeMs) || 0));
    this.maxConcurrent = Math.max(1, Math.trunc(Number(opts.maxConcurrent) || 1));
    this.maxQueueSize = Math.max(0, Math.trunc(Number(opts.maxQueueSize) || 0));
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const nowMs = Date.now();

    // Special case: maxQueueSize=0 means "no queue" (only immediate starts allowed).
    if (this.maxQueueSize === 0) {
      if (this.queue.length > 0 || !this.canStartNow(nowMs)) {
        this.rejectedQueueFullTotal++;
        const err = new Error("PROVIDER_RATE_LIMIT_QUEUE_FULL");
        (err as any).code = "PROVIDER_RATE_LIMIT_QUEUE_FULL";
        return Promise.reject(err);
      }

      this.active++;
      this.lastStartMs = nowMs;
      this.startedTotal++;

      return Promise.resolve()
        .then(fn)
        .finally(() => {
          this.active = Math.max(0, this.active - 1);
          this.pump();
        });
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.rejectedQueueFullTotal++;
      const err = new Error("PROVIDER_RATE_LIMIT_QUEUE_FULL");
      (err as any).code = "PROVIDER_RATE_LIMIT_QUEUE_FULL";
      return Promise.reject(err);
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  private canStartNow(nowMs: number): boolean {
    if (this.active >= this.maxConcurrent) return false;
    const earliest = this.lastStartMs + this.minTimeMs;
    return nowMs >= earliest;
  }

  private pump() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.queue.length > 0) {
      const nowMs = Date.now();
      if (!this.canStartNow(nowMs)) {
        const waitMs = Math.max(0, this.lastStartMs + this.minTimeMs - nowMs);
        this.timer = setTimeout(() => this.pump(), Math.min(60_000, waitMs || 1));
        return;
      }

      const item = this.queue.shift();
      if (!item) continue;

      this.active++;
      this.lastStartMs = Date.now();
      this.startedTotal++;

      Promise.resolve()
        .then(item.fn)
        .then(
          (v) => item.resolve(v),
          (e) => item.reject(e),
        )
        .finally(() => {
          this.active = Math.max(0, this.active - 1);
          this.pump();
        });
    }
  }

  stats(): Omit<ProviderRateLimitStats, "providerKey"> {
    return {
      active: this.active,
      queueLength: this.queue.length,
      rejectedQueueFullTotal: this.rejectedQueueFullTotal,
      startedTotal: this.startedTotal,
    };
  }
}

const limiterByProviderKey = new Map<string, AsyncRateLimiter>();

function getOrCreateLimiter(providerKey: string, opts: ProviderRateLimitOptions): AsyncRateLimiter {
  const key = String(providerKey || "").trim() || "_default";
  const existing = limiterByProviderKey.get(key);
  if (existing) {
    existing.setOptions(opts);
    return existing;
  }
  const limiter = new AsyncRateLimiter(opts);
  limiterByProviderKey.set(key, limiter);
  return limiter;
}

export function wrapProviderWithRateLimit(provider: MarketDataProvider, cfg: MarketDataProviderConfig): MarketDataProvider {
  const rl = (cfg as any)?.rateLimit ?? {};
  const opts: ProviderRateLimitOptions = {
    minTimeMs: Number(rl.minTimeMs ?? 100) || 0,
    maxConcurrent: Number(rl.maxConcurrent ?? 2) || 1,
    maxQueueSize: Number(rl.maxQueueSize ?? 250) || 0,
  };

  const limiter = getOrCreateLimiter(provider.providerKey, opts);

  const fetchQuotes = provider.fetchQuotes.bind(provider);
  provider.fetchQuotes = (params) => limiter.schedule(() => fetchQuotes(params));

  if (typeof provider.listReference === "function") {
    const listReference = provider.listReference.bind(provider);
    provider.listReference = (params) => limiter.schedule(() => listReference(params));
  }

  return provider;
}

export function getProviderRateLimitStats(): ProviderRateLimitStats[] {
  const out: ProviderRateLimitStats[] = [];
  for (const [providerKey, limiter] of limiterByProviderKey.entries()) {
    out.push({ providerKey, ...limiter.stats() });
  }
  out.sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  return out;
}
