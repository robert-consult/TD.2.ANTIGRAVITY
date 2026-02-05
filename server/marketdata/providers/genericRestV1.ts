import axios from "axios";
import type { MarketDataProvider, ProviderCapability, ProviderFetchQuotesResult, ProviderQuote, ProviderSymbolInput } from "../providerTypes";
import type { GenericRestV1ProviderConfig } from "@shared/marketDataProviders";
import { resolveSecretRef } from "../secret";

function normalizeSymbol(symbol: string): string {
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

function getByPath(obj: any, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return undefined;
  let cur: any = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function asArray(payload: any, wrapperKey?: string): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (wrapperKey) {
    const v = getByPath(payload, wrapperKey);
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.data)) return v.data;
  }
  return [];
}

function asMap(payload: any, wrapperKey?: string): Record<string, any> {
  if (!payload || typeof payload !== "object") return {};
  if (Array.isArray(payload)) return {};
  const base = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload;
  if (!wrapperKey) return base as Record<string, any>;
  const v = getByPath(base, wrapperKey);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

export class GenericRestV1Provider implements MarketDataProvider {
  public providerKey: string;
  public displayName: string;
  public driver = "generic_rest_v1";
  public capability: ProviderCapability = {
    quotesRest: true,
    quotesWs: false,
    referenceData: false,
    batchSymbols: true,
  };
  public maxBatchSymbols: number;
  private cfg: GenericRestV1ProviderConfig;

  constructor(opts: { providerKey: string; displayName: string; cfg: GenericRestV1ProviderConfig }) {
    this.providerKey = opts.providerKey;
    this.displayName = opts.displayName;
    this.cfg = opts.cfg;
    this.maxBatchSymbols = Math.max(1, Math.min(500, Number(opts.cfg.maxBatchSymbols ?? 50) || 50));
  }

  mapSymbol(canonicalSymbol: string): string | null {
    const s = normalizeSymbol(canonicalSymbol);
    return s ? s : null;
  }

  async fetchQuotes(params: { symbols: ProviderSymbolInput[] }): Promise<ProviderFetchQuotesResult> {
    const wanted = (params.symbols || []).filter((s) => s && s.canonicalSymbol && s.providerSymbol);
    if (!wanted.length) return { quotes: [] };

    if (this.cfg.responseMode === "wrapper_array" && !this.cfg.wrapperKey) {
      throw new Error("GENERIC_PROVIDER_WRAPPER_KEY_REQUIRED");
    }

    const lookup = new Map<string, string>();
    for (const s of wanted) {
      lookup.set(normalizeSymbol(s.providerSymbol), normalizeSymbol(s.canonicalSymbol));
    }

    const apiKeyResolved = this.cfg.apiKey ? resolveSecretRef(this.cfg.apiKey) : null;
    if (this.cfg.apiKey && !apiKeyResolved) {
      const err = new Error("GENERIC_PROVIDER_API_KEY_MISSING");
      (err as any).code = "MISSING_API_KEY";
      throw err;
    }

    const joinedSymbols = wanted.map((s) => s.providerSymbol).join(this.cfg.symbolsJoinChar);

    let urlStr = `${this.cfg.restBaseUrl}${this.cfg.quotePath}`;
    const hasSymbolsTpl = urlStr.includes("{{symbols}}");
    const hasApiKeyTpl = urlStr.includes("{{apikey}}");

    if (hasSymbolsTpl) {
      urlStr = urlStr.replaceAll("{{symbols}}", encodeURIComponent(joinedSymbols));
    }
    if (hasApiKeyTpl && !apiKeyResolved) {
      const err = new Error("GENERIC_PROVIDER_API_KEY_MISSING");
      (err as any).code = "MISSING_API_KEY";
      throw err;
    }
    if (hasApiKeyTpl && apiKeyResolved) {
      urlStr = urlStr.replaceAll("{{apikey}}", encodeURIComponent(apiKeyResolved));
    }

    const url = new URL(urlStr);
    if (!hasSymbolsTpl) {
      url.searchParams.set(this.cfg.symbolsParamName, joinedSymbols);
    }
    if (!hasApiKeyTpl && apiKeyResolved) {
      url.searchParams.set(this.cfg.apiKeyParamName, apiKeyResolved);
    }

    const res = await axios.get(url.toString(), { timeout: this.cfg.timeoutMs });
    const payload: any = res.data;
    const nowMs = Date.now();

    const rows: Array<{ key?: string; value: any }> = [];
    if (this.cfg.responseMode === "map") {
      const map = asMap(payload, this.cfg.wrapperKey);
      for (const [key, value] of Object.entries(map)) rows.push({ key, value });
    } else {
      const arr = asArray(payload, this.cfg.responseMode === "wrapper_array" ? this.cfg.wrapperKey : undefined);
      for (const value of arr) rows.push({ value });
    }

    const quotes: ProviderQuote[] = [];

    for (const r of rows) {
      const rec = r.value;
      if (!rec || typeof rec !== "object") continue;
      const rawSymbol =
        r.key ??
        (this.cfg.fields.symbol ? (rec as any)[this.cfg.fields.symbol] : undefined) ??
        (rec as any).symbol ??
        (rec as any).s;
      if (!rawSymbol) continue;

      const providerSym = String(rawSymbol);
      const canonical = lookup.get(normalizeSymbol(providerSym));
      if (!canonical) continue; // ignore unexpected symbols; avoid injecting provider-native codes into our canonical set

      const bid = this.cfg.fields.bid ? toNumber((rec as any)[this.cfg.fields.bid]) : null;
      const ask = this.cfg.fields.ask ? toNumber((rec as any)[this.cfg.fields.ask]) : null;
      const price = this.cfg.fields.price ? toNumber((rec as any)[this.cfg.fields.price]) : bid !== null && ask !== null ? (bid + ask) / 2 : null;
      if (bid === null && ask === null && price === null) continue;

      const tsMs = this.cfg.fields.timestamp
        ? normalizeEpochMs((rec as any)[this.cfg.fields.timestamp], nowMs)
        : nowMs;

      quotes.push({ canonicalSymbol: canonical, bid, ask, price, tsMs });
    }

    return { quotes, raw: payload };
  }
}
