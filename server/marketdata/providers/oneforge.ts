import axios from "axios";
import type { MarketDataProvider, ProviderCapability, ProviderFetchQuotesResult, ProviderQuote, ProviderSymbolInput } from "../providerTypes";
import type { OneForgeProviderConfig } from "@shared/marketDataProviders";
import { resolveSecretRef } from "../secret";
import { extractForgeErrorMessage } from "../../feeds/forgeUtils";

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

export class OneForgeProvider implements MarketDataProvider {
  public providerKey: string;
  public displayName: string;
  public driver = "oneforge";
  public capability: ProviderCapability = {
    quotesRest: true,
    quotesWs: false,
    referenceData: false,
    batchSymbols: true,
  };
  public maxBatchSymbols: number;
  private cfg: OneForgeProviderConfig;

  constructor(opts: { providerKey: string; displayName: string; cfg: OneForgeProviderConfig }) {
    this.providerKey = opts.providerKey;
    this.displayName = opts.displayName;
    this.cfg = opts.cfg;
    this.maxBatchSymbols = Math.max(1, Math.min(500, Number(opts.cfg.maxBatchSymbols ?? 100) || 100));
  }

  mapSymbol(canonicalSymbol: string): string | null {
    const s = normalizeCanonicalSymbol(canonicalSymbol);
    if (!s) return null;

    const mapped: Record<string, string> = {
      XAUUSD: "XAU/USD",
      XAGUSD: "XAG/USD",
      US30: "USA30",
      NGAS: "NATGAS",
      WTI: "USOIL",
    };
    if (mapped[s]) return mapped[s];
    if (/^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(3)}`;
    return null; // 1Forge is pair-focused; avoid requesting non-pairs.
  }

  async fetchQuotes(params: { symbols: ProviderSymbolInput[] }): Promise<ProviderFetchQuotesResult> {
    const apiKey = resolveSecretRef(this.cfg.apiKey);
    if (!apiKey) {
      const err = new Error("FORGE_KEY_MISSING");
      (err as any).code = "MISSING_API_KEY";
      throw err;
    }

    const wanted = (params.symbols || []).filter((s) => s && s.canonicalSymbol && s.providerSymbol);
    if (!wanted.length) return { quotes: [] };

    const providerSymbols = wanted.map((s) => s.providerSymbol);
    const pairsJoined = providerSymbols.join(",");

    const url = `${this.cfg.restBaseUrl}${this.cfg.quoteEndpoint}`;
    const res = await axios.get(url, {
      params: { pairs: pairsJoined, api_key: apiKey },
      timeout: this.cfg.timeoutMs,
    });

    let payload: any = res.data;

    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const errMsg = extractForgeErrorMessage(payload);
      if (errMsg) throw new Error(errMsg);
      if (Array.isArray((payload as any).quotes)) payload = (payload as any).quotes;
    }

    if (!Array.isArray(payload)) {
      throw new Error("1FORGE_BAD_RESPONSE");
    }

    const lookup = new Map<string, string>();
    for (const s of wanted) {
      lookup.set(normalizeCanonicalSymbol(s.providerSymbol), normalizeCanonicalSymbol(s.canonicalSymbol));
    }

    const nowMs = Date.now();
    const quotes: ProviderQuote[] = [];

    for (const q of payload) {
      const rawSym = (q as any)?.s ?? (q as any)?.symbol ?? null;
      if (!rawSym) continue;
      const normalizedProvider = normalizeCanonicalSymbol(rawSym);
      const canonical = lookup.get(normalizedProvider);
      if (!canonical) continue; // ignore unexpected symbols; avoid injecting provider-native codes into our canonical set

      const price = toNumber((q as any)?.p ?? (q as any)?.price ?? (q as any)?.mid);
      if (price === null) continue;

      const bid = toNumber((q as any)?.b ?? (q as any)?.bid) ?? price * 0.9999;
      const ask = toNumber((q as any)?.a ?? (q as any)?.ask) ?? price * 1.0001;
      const tsMs = normalizeEpochMs((q as any)?.t ?? (q as any)?.timestamp, nowMs);

      quotes.push({ canonicalSymbol: canonical, bid, ask, price, tsMs });
    }

    return { quotes, raw: payload };
  }
}
