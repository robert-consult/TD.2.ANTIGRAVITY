import axios from "axios";
import type { MarketDataProvider, ProviderCapability, ProviderFetchQuotesResult, ProviderQuote, ProviderSymbolInput } from "../providerTypes";
import type { TwelveDataProviderConfig } from "@shared/marketDataProviders";
import { resolveSecretRef } from "../secret";

function normalizeCanonicalSymbol(symbol: string): string {
  return String(symbol ?? "").replace("/", "").trim().toUpperCase();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeEpochMs(value: unknown, fallbackMs: number): number {
  const n = toNumber(value);
  if (n === null) return fallbackMs;
  return n < 1e12 ? n * 1000 : n;
}

function extractArray(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

export class TwelveDataProvider implements MarketDataProvider {
  public providerKey: string;
  public displayName: string;
  public driver = "twelvedata";
  public capability: ProviderCapability = {
    quotesRest: true,
    quotesWs: false,
    referenceData: true,
    batchSymbols: true,
  };
  public maxBatchSymbols: number;
  private cfg: TwelveDataProviderConfig;

  constructor(opts: { providerKey: string; displayName: string; cfg: TwelveDataProviderConfig }) {
    this.providerKey = opts.providerKey;
    this.displayName = opts.displayName;
    this.cfg = opts.cfg;
    this.maxBatchSymbols = Math.max(1, Math.min(120, Number(opts.cfg.maxBatchSymbols ?? 8) || 8));
  }

  mapSymbol(canonicalSymbol: string): string | null {
    const sym = normalizeCanonicalSymbol(canonicalSymbol);
    if (!sym) return null;
    if (/^[A-Z]{6}$/.test(sym)) return `${sym.slice(0, 3)}/${sym.slice(3)}`;
    return sym;
  }

  async fetchQuotes(params: { symbols: ProviderSymbolInput[] }): Promise<ProviderFetchQuotesResult> {
    const apiKey = resolveSecretRef(this.cfg.apiKey);
    if (!apiKey) {
      const err = new Error("TWELVEDATA_API_KEY_MISSING");
      (err as any).code = "MISSING_API_KEY";
      throw err;
    }

    const wanted = (params.symbols || []).filter((s) => s && s.canonicalSymbol && s.providerSymbol);
    if (!wanted.length) return { quotes: [] };

    const symbolsJoined = wanted.map((s) => s.providerSymbol).join(",");
    const url = `${this.cfg.restBaseUrl}${this.cfg.quoteEndpoint}`;
    const startedAtMs = Date.now();

    const res = await axios.get(url, {
      params: { symbol: symbolsJoined, apikey: apiKey },
      timeout: this.cfg.timeoutMs,
    });

    const payload = res.data;
    const nowMs = Date.now();

    const byProviderSymbol: Record<string, any> =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload)
        : {};

    const quotes: ProviderQuote[] = [];
    const isBatch = wanted.length > 1;

    for (const req of wanted) {
      const entry = isBatch ? (byProviderSymbol as any)[req.providerSymbol] : (payload?.data ?? payload);
      if (!entry || typeof entry !== "object") continue;

      const bid = toNumber((entry as any).bid);
      const ask = toNumber((entry as any).ask);
      const price =
        toNumber((entry as any).price) ??
        toNumber((entry as any).close) ??
        (bid !== null && ask !== null ? (bid + ask) / 2 : null);

      const tsMs =
        normalizeEpochMs((entry as any).timestamp, nowMs) ??
        normalizeEpochMs((entry as any).t, nowMs) ??
        startedAtMs;

      quotes.push({
        canonicalSymbol: normalizeCanonicalSymbol(req.canonicalSymbol),
        bid,
        ask,
        price,
        tsMs,
      });
    }

    return { quotes, raw: payload };
  }

  async listReference(params: { category: string; filter?: Record<string, string>; limit?: number }) {
    const apiKey = resolveSecretRef(this.cfg.apiKey);
    if (!apiKey) {
      const err = new Error("TWELVEDATA_API_KEY_MISSING");
      (err as any).code = "MISSING_API_KEY";
      throw err;
    }

    const cat = String(params.category || "").trim().toLowerCase();
    const endpoint =
      cat === "stocks"
        ? "/stocks"
        : cat === "etf"
          ? "/etf"
          : cat === "forex"
            ? "/forex_pairs"
            : cat === "crypto"
              ? "/cryptocurrencies"
              : cat === "commodities"
                ? "/commodities"
                : cat === "bonds"
                  ? "/bonds"
                  : cat === "funds"
                    ? "/funds"
                    : cat === "mutual_funds"
                      ? "/mutual_funds/list"
                      : null;

    if (!endpoint) {
      throw new Error(`TWELVEDATA_REFERENCE_UNSUPPORTED_CATEGORY:${cat || "unknown"}`);
    }

    const url = `${this.cfg.restBaseUrl}${endpoint}`;
    const res = await axios.get(url, {
      params: { ...(params.filter ?? {}), apikey: apiKey, ...(params.limit ? { limit: String(params.limit) } : {}) },
      timeout: Math.max(1_000, this.cfg.timeoutMs),
    });

    const rows = extractArray(res.data);
    return rows as Array<Record<string, any>>;
  }
}

