import type { Request, Response, Router } from "express";
import { eq } from "drizzle-orm";
import { db, dbClient } from "@db";
import { quotes, systemConfig } from "@shared/schema";
import {
  getQuote,
  getQuoteMeta,
  getQuoteSnapshot,
  getValkeyQuoteRows,
  getValkeySnapshot,
} from "../../services/quoteHub";
import { getAllowedSymbolsForUser } from "../../services/quoteSubscriptions";
import { computeCurrentSessionDay } from "../../utils/quoteSession";
import { isMarketOpenForSymbol } from "../../services/marketHours";

async function loadQuoteSnapshotConfig() {
  let staleThresholdMs = 30000;
  let fxRolloverTz = "America/New_York";
  let fxRolloverTime = "17:00";
  try {
    const cfg = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.id, 1),
    });
    if ((cfg as any)?.staleThresholdMs) staleThresholdMs = Number((cfg as any).staleThresholdMs);
    if ((cfg as any)?.fxRolloverTz) fxRolloverTz = String((cfg as any).fxRolloverTz);
    if ((cfg as any)?.fxRolloverTime) fxRolloverTime = String((cfg as any).fxRolloverTime);
  } catch { }
  return { staleThresholdMs, fxRolloverTz, fxRolloverTime };
}

async function loadPrevCloseMap(symbols: string[], currentSessionDay: string) {
  const map = new Map<string, number>();
  if (!symbols.length) return map;
  const prevRows = await dbClient.query(
    `
      SELECT DISTINCT ON (symbol) symbol, close
      FROM market_daily_close
      WHERE symbol = ANY($1::text[]) AND session_day < $2
      ORDER BY symbol, session_day DESC
      `,
    [symbols, currentSessionDay],
  );
  for (const row of prevRows.rows) {
    if (!row?.symbol) continue;
    const close = Number(row.close);
    if (Number.isFinite(close)) map.set(String(row.symbol), close);
  }
  const missing = symbols.filter((sym) => !map.has(sym));
  if (!missing.length) return map;
  const fallbackRows = await dbClient.query(
    `
      SELECT DISTINCT ON (symbol) symbol, close
      FROM market_daily_close
      WHERE symbol = ANY($1::text[])
      ORDER BY symbol, session_day DESC
      `,
    [missing],
  );
  for (const row of fallbackRows.rows) {
    if (!row?.symbol) continue;
    const close = Number(row.close);
    if (Number.isFinite(close)) map.set(String(row.symbol), close);
  }
  return map;
}

function buildQuoteView(quote: any, prevCloseMap: Map<string, number>, nowMs: number, staleThresholdMs: number) {
  const bid = typeof quote.bid === "number" ? quote.bid : null;
  const ask = typeof quote.ask === "number" ? quote.ask : null;
  const lastPrice = typeof quote.price === "number" ? quote.price : typeof quote.lastPrice === "number" ? quote.lastPrice : null;
  const midPrice = bid != null && ask != null ? (bid + ask) / 2 : lastPrice;
  const spread = bid != null && ask != null ? Math.abs(ask - bid) : null;
  const prevClose = prevCloseMap.get(String(quote.symbol)) ?? (typeof quote.prevClose === "number" ? quote.prevClose : null);

  let pctChange = 0;
  if (prevClose != null && prevClose > 0 && Number.isFinite(midPrice)) {
    pctChange = ((midPrice - prevClose) / prevClose) * 100;
    pctChange = Math.round(pctChange * 100) / 100;
  }

  const change = Number.isFinite(midPrice) && prevClose != null ? midPrice - prevClose : 0;
  const rawLastUpdate = Number(
    quote.lastApiUpdate ??
    quote.last_api_update ??
    quote.lastUpdated ??
    quote.updatedAt ??
    quote.updated_at ??
    nowMs,
  );
  const lastUpdate = rawLastUpdate < 1e12 ? rawLastUpdate * 1000 : rawLastUpdate;
  const ageMs = nowMs - lastUpdate;
  const dbIsStale = quote.isStale === 1 || quote.isStale === true;
  const marketOpen = isMarketOpenForSymbol(String(quote.symbol), new Date(nowMs));
  const isStale = dbIsStale || (marketOpen && ageMs > staleThresholdMs);

  return {
    symbol: quote.symbol,
    bid,
    ask,
    price: midPrice,
    spread,
    prevClose: prevClose ?? midPrice,
    change,
    pctChange,
    marketOpen,
    isStale,
    lastApiUpdate: lastUpdate,
    dataAge: ageMs,
  };
}

export async function buildQuoteSnapshotResponse(symbols?: string[]) {
  const { staleThresholdMs, fxRolloverTz, fxRolloverTime } = await loadQuoteSnapshotConfig();
  const currentSessionDay = computeCurrentSessionDay({
    tz: fxRolloverTz,
    time: fxRolloverTime,
  });
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const hubMeta = getQuoteMeta();
  if (hubMeta.size > 0) {
    const hubSnapshot = getQuoteSnapshot(symbols);
    const symbolList = hubSnapshot.rows.map((row) => String(row.symbol));
    const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
    const enhancedQuotes = hubSnapshot.rows.map((quote) => ({
      ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
      timestamp: nowSec,
    }));
    return { rows: enhancedQuotes, seq: hubSnapshot.seq, asOf: hubSnapshot.asOf };
  }

  const valkeySnapshot = await getValkeySnapshot(symbols);
  if (valkeySnapshot?.rows?.length) {
    const symbolList = valkeySnapshot.rows.map((row) => String(row.symbol));
    const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
    const enhancedQuotes = valkeySnapshot.rows.map((quote) => ({
      ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
      timestamp: nowSec,
    }));
    return { rows: enhancedQuotes, seq: valkeySnapshot.seq ?? 0, asOf: valkeySnapshot.asOf ?? nowMs };
  }

  // If the snapshot key expired, fall back to per-symbol Valkey keys (q:v1:*) before hitting Postgres.
  if (symbols?.length) {
    const valkeyRows = await getValkeyQuoteRows(symbols);
    if (valkeyRows.length) {
      const symbolList = valkeyRows.map((row) => String(row.symbol));
      const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
      const enhancedQuotes = valkeyRows.map((quote) => ({
        ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
        timestamp: nowSec,
      }));
      return { rows: enhancedQuotes, seq: 0, asOf: nowMs };
    }
  }

  const quotesTable = await dbClient.query("SELECT to_regclass('public.quotes') as table_name");
  if (!quotesTable.rows?.[0]?.table_name) {
    return { rows: [], seq: 0, asOf: nowMs };
  }

  const params: any[] = [nowMs, currentSessionDay];
  const filterClause = symbols?.length ? "WHERE q.symbol = ANY($3::text[])" : "";
  if (symbols?.length) params.push(symbols);

  const quotesResult = await dbClient.query(
    `
      SELECT
        q.symbol,
        q.bid,
        q.ask,
        q.price AS "lastPrice",
        COALESCE(q.is_stale, false) AS "isStale",
        COALESCE(q.last_api_update, q.updated_at, $1) AS "lastApiUpdate",
        COALESCE(
          (
            SELECT dc.close
            FROM market_daily_close dc
            WHERE dc.symbol = q.symbol AND dc.session_day < $2
            ORDER BY dc.session_day DESC
            LIMIT 1
          ),
          (
            SELECT dc2.close
            FROM market_daily_close dc2
            WHERE dc2.symbol = q.symbol
            ORDER BY dc2.session_day DESC
            LIMIT 1
          )
        ) AS "prevClose"
      FROM quotes q
      ${filterClause}
      `,
    params,
  );
  const quoteRows = quotesResult.rows;
  const symbolList = quoteRows.map((row: any) => String(row.symbol));
  const prevCloseMap = await loadPrevCloseMap(symbolList, currentSessionDay);
  const enhancedQuotes = quoteRows.map((quote: any) => ({
    ...buildQuoteView(quote, prevCloseMap, nowMs, staleThresholdMs),
    timestamp: nowSec,
  }));

  return { rows: enhancedQuotes, seq: 0, asOf: nowMs };
}

// Quotes endpoint for getting real-time price data
// Add endpoint for getting all latest quotes (for REST polling)
function normalizeSymbolsInputRaw(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function getAllowedQuoteSymbolsForRequest(req: Request): Promise<Set<string>> {
  const sessionUserId = Number(req.session?.userId ?? 0);
  const userId = Number.isInteger(sessionUserId) && sessionUserId > 0 ? sessionUserId : null;
  return getAllowedSymbolsForUser(userId);
}

export function registerQuoteRoutes(router: Router) {
  router.get("/quotes/latest", async (req: Request, res: Response) => {
    try {
      const rawSymbols = String(req.query.symbols ?? "").trim();
      const requestedSymbols = rawSymbols ? normalizeSymbolsInputRaw(rawSymbols) : null;
      const allowedSymbols = await getAllowedQuoteSymbolsForRequest(req);

      const snapshotSymbols = requestedSymbols
        ? requestedSymbols.filter((symbol) => allowedSymbols.has(symbol))
        : Array.from(allowedSymbols.values());

      if (!snapshotSymbols.length) {
        return res.json([]);
      }

      const snapshot = await buildQuoteSnapshotResponse(snapshotSymbols);
      const requestedSet = new Set(snapshotSymbols);
      const rows = snapshot.rows.filter((row: any) => {
        const symbol = String(row?.symbol ?? "").toUpperCase();
        if (!symbol) return false;
        return allowedSymbols.has(symbol) && requestedSet.has(symbol);
      });

      return res.json(rows);
    } catch (error) {
      console.error("Error fetching latest quotes:", error);
      return res.status(500).json({ message: "Failed to fetch quotes" });
    }
  });

  // Get individual quote by symbol
  router.get("/quotes/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol).toUpperCase();

    try {
      const allowedSymbols = await getAllowedQuoteSymbolsForRequest(req);
      if (!allowedSymbols.has(symbol)) {
        return res.status(403).json({ message: `Quote access denied for ${symbol}` });
      }

      let quote: any | null = getQuote(symbol);

      if (!quote) {
        const valkeyRows = await getValkeyQuoteRows([symbol]);
        if (valkeyRows.length) quote = valkeyRows[0];
      }

      if (!quote) {
        quote = await db.query.quotes.findFirst({
          where: eq(quotes.symbol, symbol),
        });
      }

      if (quote) {
        // Calculate spread from bid and ask prices
        const bid = typeof quote.bid === "number" ? quote.bid : null;
        const ask = typeof quote.ask === "number" ? quote.ask : null;
        const spread = bid != null && ask != null ? Math.abs(ask - bid) : null;

        res.json({ ...quote, spread });
      } else {
        res.status(404).json({ message: `No price data available for ${symbol}` });
      }
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      res.status(500).json({ message: "Failed to fetch quote data" });
    }
  });
}
