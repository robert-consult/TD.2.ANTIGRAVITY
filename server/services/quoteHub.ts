import { getValkey, valkeyGetJson, getCachedPrevClose, getFromRollingBuffer } from "./valkey";

export type QuoteCore = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  price: number | null;
  lastUpdated: number;
  lastApiUpdate: number;
  isStale: boolean;
  prevClose?: number | null;
  source?: string;
};

export type QuoteSnapshot = {
  seq?: number;
  asOf?: number;
  source?: string;
  rows: QuoteCore[];
};

const QUOTE_SNAPSHOT_KEY = process.env.QUOTE_SNAPSHOT_KEY ?? "quotes:latest:v1";
const quoteMap = new Map<string, QuoteCore>();
let lastSeq = 0;
let lastAsOf = 0;

function normalizeSymbol(symbol: string): string {
  return symbol.replace("/", "").trim().toUpperCase();
}

function normalizeSource(raw: unknown): string | undefined {
  const value = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  return value ? value : undefined;
}

function toQuoteCore(row: any, asOf: number): QuoteCore | null {
  if (!row?.symbol) return null;
  const symbol = normalizeSymbol(String(row.symbol));
  const bid = typeof row.bid === "number" ? row.bid : row.bid == null ? null : Number(row.bid);
  const ask = typeof row.ask === "number" ? row.ask : row.ask == null ? null : Number(row.ask);
  const price =
    typeof row.price === "number"
      ? row.price
      : bid != null && ask != null
        ? (bid + ask) / 2
        : row.price == null
          ? null
          : Number(row.price);
  const lastUpdatedRaw = row.lastUpdated ?? row.lastApiUpdate ?? row.updatedAt ?? asOf;
  const lastApiRaw = row.lastApiUpdate ?? row.lastUpdated ?? row.updatedAt ?? asOf;
  const lastUpdated = Number.isFinite(Number(lastUpdatedRaw)) ? Number(lastUpdatedRaw) : asOf;
  const lastApiUpdate = Number.isFinite(Number(lastApiRaw)) ? Number(lastApiRaw) : asOf;
  const prevCloseRaw = row.prevClose;
  const prevClose =
    prevCloseRaw == null
      ? undefined
      : Number.isFinite(Number(prevCloseRaw))
        ? Number(prevCloseRaw)
        : undefined;
  return {
    symbol,
    bid,
    ask,
    price,
    lastUpdated,
    lastApiUpdate,
    isStale: Boolean(row.isStale),
    prevClose,
    source: normalizeSource(row.source),
  };
}

export function applyQuoteUpdate(
  rows: Array<Partial<QuoteCore> & { symbol: string }>,
  meta?: { seq?: number; asOf?: number; source?: string },
) {
  const asOf = Number.isFinite(meta?.asOf) ? Number(meta?.asOf) : Date.now();
  const fallbackSource = normalizeSource(meta?.source);
  if (Number.isFinite(meta?.seq)) lastSeq = Number(meta?.seq);
  lastAsOf = asOf;
  for (const row of rows) {
    const core = toQuoteCore(row, asOf);
    if (!core) continue;
    const existing = quoteMap.get(core.symbol);
    quoteMap.set(core.symbol, {
      ...existing,
      ...core,
      prevClose: core.prevClose ?? existing?.prevClose,
      source: core.source ?? existing?.source ?? fallbackSource,
    });
  }
}

export async function bootstrapQuoteHub(): Promise<boolean> {
  const snapshot = await valkeyGetJson<QuoteSnapshot>(QUOTE_SNAPSHOT_KEY);
  if (!snapshot?.rows?.length) return false;
  applyQuoteUpdate(snapshot.rows, {
    seq: snapshot.seq,
    asOf: snapshot.asOf,
    source: snapshot.source,
  });
  return true;
}

export async function bootstrapQuoteHubFromValkeySymbols(symbols: string[]): Promise<boolean> {
  const rows = await getValkeyQuoteRows(symbols);
  if (!rows.length) return false;
  applyQuoteUpdate(rows, { seq: 0, asOf: Date.now() });
  return true;
}

export function getQuoteSnapshot(symbols?: string[]): { rows: QuoteCore[]; seq: number; asOf: number } {
  const rows = symbols?.length
    ? symbols
      .map((symbol) => quoteMap.get(normalizeSymbol(symbol)))
      .filter((row): row is QuoteCore => Boolean(row))
    : [...quoteMap.values()];
  return { rows, seq: lastSeq, asOf: lastAsOf || Date.now() };
}

export function getQuote(symbol: string): QuoteCore | null {
  return quoteMap.get(normalizeSymbol(symbol)) ?? null;
}

export function getQuoteMeta() {
  return {
    size: quoteMap.size,
    seq: lastSeq,
    asOf: lastAsOf || Date.now(),
  };
}

export async function getValkeyQuoteRows(symbols: string[]): Promise<QuoteCore[]> {
  if (!symbols.length) return [];
  const v = getValkey();
  if (!v) return [];
  const keys = symbols.map((symbol) => `q:v1:${normalizeSymbol(symbol)}`);
  try {
    const values = await v.mget(...keys);
    const asOf = Date.now();
    const rows: QuoteCore[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const core = toQuoteCore(parsed, asOf);
        if (core) rows.push(core);
      } catch {
        // ignore malformed entries
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export async function getValkeySnapshot(symbols?: string[]) {
  const snapshot = await valkeyGetJson<QuoteSnapshot>(QUOTE_SNAPSHOT_KEY);
  if (!snapshot?.rows?.length) return null;
  const asOf = Number.isFinite(snapshot.asOf) ? Number(snapshot.asOf) : Date.now();
  const wanted = symbols?.length ? new Set(symbols.map(normalizeSymbol)) : null;
  const rows: QuoteCore[] = [];
  for (const row of snapshot.rows as any[]) {
    const core = toQuoteCore(row, asOf);
    if (!core) continue;
    if (wanted && !wanted.has(core.symbol)) continue;
    rows.push(core);
  }
  return {
    seq: snapshot.seq,
    asOf: snapshot.asOf,
    source: snapshot.source,
    rows,
  };
}
