import axios from "axios";
import WebSocket from "ws";
import type {
  MarketDataProvider,
  ProviderCapability,
  ProviderFetchQuotesResult,
  ProviderQuote,
  ProviderQuoteStreamHandlers,
  ProviderQuoteStreamSession,
  ProviderSymbolInput,
} from "../providerTypes";
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

function toRows(
  payload: any,
  mode: "array" | "map" | "wrapper_array",
  wrapperKey?: string,
): Array<{ key?: string; value: any }> {
  const rows: Array<{ key?: string; value: any }> = [];

  if (mode === "map") {
    const map = asMap(payload, wrapperKey);
    for (const [key, value] of Object.entries(map)) rows.push({ key, value });
    if (!rows.length && payload && typeof payload === "object" && !Array.isArray(payload)) {
      rows.push({ value: payload });
    }
    return rows;
  }

  const arr = asArray(payload, mode === "wrapper_array" ? wrapperKey : undefined);
  if (arr.length) {
    for (const value of arr) rows.push({ value });
    return rows;
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    rows.push({ value: payload });
  }

  return rows;
}

function buildLookup(symbols: ProviderSymbolInput[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const s of symbols || []) {
    if (!s?.canonicalSymbol || !s?.providerSymbol) continue;
    lookup.set(normalizeSymbol(s.providerSymbol), normalizeSymbol(s.canonicalSymbol));
  }
  return lookup;
}

function parseQuotesFromPayload(args: {
  payload: any;
  lookup: Map<string, string>;
  mode: "array" | "map" | "wrapper_array";
  wrapperKey?: string;
  fields: {
    symbol?: string;
    bid?: string;
    ask?: string;
    price?: string;
    timestamp?: string;
  };
}): ProviderQuote[] {
  const nowMs = Date.now();
  const rows = toRows(args.payload, args.mode, args.wrapperKey);
  const quotes: ProviderQuote[] = [];

  for (const r of rows) {
    const rec = r.value;
    if (!rec || typeof rec !== "object") continue;

    const rawSymbol =
      r.key ??
      (args.fields.symbol ? (rec as any)[args.fields.symbol] : undefined) ??
      (rec as any).symbol ??
      (rec as any).s;
    if (!rawSymbol) continue;

    const providerSym = String(rawSymbol);
    const canonical = args.lookup.get(normalizeSymbol(providerSym));
    if (!canonical) continue;

    const bid = args.fields.bid ? toNumber((rec as any)[args.fields.bid]) : null;
    const ask = args.fields.ask ? toNumber((rec as any)[args.fields.ask]) : null;
    const price =
      args.fields.price != null
        ? toNumber((rec as any)[args.fields.price])
        : bid !== null && ask !== null
          ? (bid + ask) / 2
          : null;
    if (bid === null && ask === null && price === null) continue;

    const tsMs = args.fields.timestamp ? normalizeEpochMs((rec as any)[args.fields.timestamp], nowMs) : nowMs;
    quotes.push({ canonicalSymbol: canonical, bid, ask, price, tsMs });
  }

  return quotes;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown");
}

export class GenericRestV1Provider implements MarketDataProvider {
  public providerKey: string;
  public displayName: string;
  public driver = "generic_rest_v1";
  public capability: ProviderCapability;
  public maxBatchSymbols: number;
  private cfg: GenericRestV1ProviderConfig;

  constructor(opts: { providerKey: string; displayName: string; cfg: GenericRestV1ProviderConfig }) {
    this.providerKey = opts.providerKey;
    this.displayName = opts.displayName;
    this.cfg = opts.cfg;
    this.maxBatchSymbols = Math.max(1, Math.min(500, Number(opts.cfg.maxBatchSymbols ?? 50) || 50));
    const wsEnabled = Boolean(opts.cfg.ws?.enabled && opts.cfg.ws?.url);
    this.capability = {
      quotesRest: true,
      quotesWs: wsEnabled,
      referenceData: false,
      batchSymbols: true,
    };
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

    const lookup = buildLookup(wanted);

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

    const quotes = parseQuotesFromPayload({
      payload,
      lookup,
      mode: this.cfg.responseMode,
      wrapperKey: this.cfg.wrapperKey,
      fields: this.cfg.fields,
    });

    return { quotes, raw: payload };
  }

  async openQuoteStream(params: {
    symbols: ProviderSymbolInput[];
    handlers: ProviderQuoteStreamHandlers;
  }): Promise<ProviderQuoteStreamSession> {
    const wsCfg = this.cfg.ws;
    if (!wsCfg?.enabled || !wsCfg?.url) {
      throw new Error("GENERIC_PROVIDER_WS_NOT_CONFIGURED");
    }

    const handlers = params.handlers;
    const apiKeyResolved = this.cfg.apiKey ? resolveSecretRef(this.cfg.apiKey) : null;
    if (this.cfg.apiKey && !apiKeyResolved) {
      const err = new Error("GENERIC_PROVIDER_API_KEY_MISSING");
      (err as any).code = "MISSING_API_KEY";
      throw err;
    }

    const mode = wsCfg.responseMode ?? this.cfg.responseMode;
    const wrapperKey = wsCfg.wrapperKey ?? this.cfg.wrapperKey;
    const fields = wsCfg.fields ?? this.cfg.fields;

    let currentSymbols = (params.symbols || []).filter((s) => s && s.canonicalSymbol && s.providerSymbol);
    let lookup = buildLookup(currentSymbols);
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let connectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelayMs = Math.max(250, Number(wsCfg.reconnectBaseMs ?? 1_000) || 1_000);

    const clearTimers = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
    };

    const renderTemplate = (template: string, symbols: ProviderSymbolInput[]) => {
      const joiner = wsCfg.symbolsJoinChar ?? this.cfg.symbolsJoinChar;
      const symbolsJoined = symbols.map((s) => s.providerSymbol).join(joiner);
      return String(template)
        .replaceAll("{{symbols}}", symbolsJoined)
        .replaceAll("{{providerSymbols}}", symbolsJoined)
        .replaceAll("{{apikey}}", apiKeyResolved ?? "");
    };

    const sendTemplate = (template: string | undefined, symbols: ProviderSymbolInput[]) => {
      if (!template || !ws || ws.readyState !== WebSocket.OPEN) return;
      const payload = renderTemplate(template, symbols);
      ws.send(payload);
    };

    const scheduleReconnect = (reason: string) => {
      if (closed || reconnectTimer) return;
      handlers.onStateChange?.("reconnecting", {
        providerKey: this.providerKey,
        reason,
        delayMs: reconnectDelayMs,
      });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(
        Math.max(reconnectDelayMs, Number(wsCfg.reconnectBaseMs ?? 1_000) || 1_000) * 2,
        Math.max(1_000, Number(wsCfg.reconnectMaxMs ?? 20_000) || 20_000),
      );
    };

    const connect = async () => {
      if (closed) return;
      clearTimers();
      handlers.onStateChange?.("connecting", {
        providerKey: this.providerKey,
        symbolCount: currentSymbols.length,
      });

      const wsUrl = renderTemplate(wsCfg.url, currentSymbols);
      const protocols = wsCfg.protocols?.length ? wsCfg.protocols : undefined;
      ws = new WebSocket(wsUrl, protocols);

      connectTimeout = setTimeout(() => {
        if (!ws || ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSED) return;
        handlers.onError(new Error("GENERIC_PROVIDER_WS_CONNECT_TIMEOUT"));
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }, Math.max(500, Number(wsCfg.connectTimeoutMs ?? 10_000) || 10_000));

      ws.on("open", () => {
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        reconnectDelayMs = Math.max(250, Number(wsCfg.reconnectBaseMs ?? 1_000) || 1_000);
        handlers.onStateChange?.("connected", {
          providerKey: this.providerKey,
          symbolCount: currentSymbols.length,
        });
        sendTemplate(wsCfg.authMessage, currentSymbols);
        sendTemplate(wsCfg.subscribeMessage, currentSymbols);

        if (wsCfg.pingMessage) {
          const intervalMs = Math.max(1_000, Number(wsCfg.pingIntervalMs ?? 20_000) || 20_000);
          pingTimer = setInterval(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            sendTemplate(wsCfg.pingMessage, currentSymbols);
          }, intervalMs);
        }
      });

      ws.on("message", (raw) => {
        const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
        if (!text.trim()) return;

        let payload: any = null;
        try {
          payload = JSON.parse(text);
        } catch {
          // Ignore non-JSON control messages by default.
          return;
        }

        try {
          const quotes = parseQuotesFromPayload({
            payload,
            lookup,
            mode,
            wrapperKey,
            fields,
          });
          if (!quotes.length) return;
          void handlers.onQuotes(quotes);
        } catch (error) {
          handlers.onError(new Error(`GENERIC_PROVIDER_WS_PARSE_FAILED:${asErrorMessage(error)}`));
        }
      });

      ws.on("error", (error) => {
        handlers.onError(error);
      });

      ws.on("close", (code, reasonBuf) => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (connectTimeout) {
          clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        const reasonText =
          typeof reasonBuf === "string"
            ? reasonBuf
            : Buffer.isBuffer(reasonBuf)
              ? reasonBuf.toString("utf8")
              : "";

        if (closed) {
          handlers.onStateChange?.("disconnected", {
            providerKey: this.providerKey,
            code,
            reason: reasonText || "closed",
          });
          return;
        }

        handlers.onError(new Error(`GENERIC_PROVIDER_WS_DISCONNECTED:${code}:${reasonText || "no_reason"}`));
        scheduleReconnect(`close:${code}`);
      });
    };

    await connect();

    return {
      updateSymbols: async (symbols: ProviderSymbolInput[]) => {
        const next = (symbols || []).filter((s) => s && s.canonicalSymbol && s.providerSymbol);
        const prev = currentSymbols;
        currentSymbols = next;
        lookup = buildLookup(currentSymbols);
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (wsCfg.unsubscribeMessage && prev.length) {
          sendTemplate(wsCfg.unsubscribeMessage, prev);
        }
        sendTemplate(wsCfg.subscribeMessage, currentSymbols);
      },
      close: async (reason?: string) => {
        if (closed) return;
        closed = true;
        clearTimers();
        handlers.onStateChange?.("disconnected", {
          providerKey: this.providerKey,
          reason: reason ?? "manual-close",
        });
        if (ws) {
          try {
            ws.close(1000, reason ?? "closing");
          } catch {
            // ignore
          }
        }
      },
    };
  }
}

