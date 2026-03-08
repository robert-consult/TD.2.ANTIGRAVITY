import { db } from '../db/index';
import { eq, and, inArray } from 'drizzle-orm';
import { users, trades, quotes } from '../shared/schema';
import { requiredMargin, unrealizedPnl, updateFxRates } from './lib/margin';
import { publishLiveEvent } from './services/liveBus';
import { getQuoteSnapshot, getValkeyQuoteRows } from './services/quoteHub';
import { computeOpenTradeAccrualCosts } from './services/tradeCosts';

// Staleness threshold in milliseconds (5 minutes)
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

// FX reference pairs needed for cross-pair P/L conversion
// Only include pairs that are actually fetched from 1Forge API
const FX_REFERENCE_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'];

interface QuoteData {
  bid: number | null;
  ask: number | null;
  price: number;
  mid: number;
  updatedAt: number;
  isStale: boolean;
}

interface RecalcResult {
  startingBalance: number;
  balance: number;
  usedMargin: number;
  equity: number;
  freeMargin: number;
  floatingPnl: number;
  marginLevel: number | null;
  openPositions: number;
  pricingStale: boolean;
  staleSymbols: string[];
  asOf: Date;
}

type RecalcOptions = {
  emit?: boolean;
  reason?: string;
};

/**
 * Recalculates account margin metrics:
 * - Used margin (sum of margin required for all open positions)
 * - Equity (balance + unrealized P/L)
 * - Free margin (equity - used margin)
 * 
 * Option 1 (Risk-safe): Refuses to update metrics when quotes are stale/missing
 * Returns pricingStale flag so frontend can display appropriate warnings
 * 
 * @param userId User ID to recalculate metrics for
 */
export async function recalcAccount(
  userId: number,
  opts?: RecalcOptions
): Promise<RecalcResult | null> {
  try {
    // Get user data
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });
    
    if (!user) {
      console.error(`User ${userId} not found for margin recalculation`);
      return null;
    }
    
    const balance = parseFloat(user.balance);
    const startingBalanceRaw = Number((user as any).startingEquity ?? balance);
    const startingBalance =
      Number.isFinite(startingBalanceRaw) && startingBalanceRaw > 0
        ? startingBalanceRaw
        : balance;
    const asOf = new Date();
    
    // Get all open trades for the user with their symbols
    const openTrades = await db.query.trades.findMany({
      where: and(
        eq(trades.userId, userId),
        eq(trades.status, 'OPEN')
      ),
      with: {
        symbol: true
      }
    });
    
    // If no open positions, return clean state
    if (openTrades.length === 0) {
      const result: RecalcResult = {
        startingBalance,
        balance,
        usedMargin: 0,
        equity: balance,
        freeMargin: balance,
        floatingPnl: 0,
        marginLevel: null, // No margin used = N/A, not 0
        openPositions: 0,
        pricingStale: false,
        staleSymbols: [],
        asOf,
      };
      
      // Update user in database
      await db.update(users)
        .set({
          usedMargin: 0,
          equity: balance,
          freeMargin: balance
        })
        .where(eq(users.id, userId));
      
      if (opts?.emit) {
        const summary = {
          startingBalance: result.startingBalance,
          balance: result.balance,
          equity: result.equity,
          floatingPnl: result.floatingPnl,
          usedMargin: result.usedMargin,
          freeMargin: result.freeMargin,
          marginLevel: result.marginLevel,
          openPositions: result.openPositions,
          pricingStale: result.pricingStale,
          staleSymbols: result.staleSymbols,
          asOf: result.asOf.toISOString(),
        };
        publishLiveEvent({
          type: "account:updated",
          userId,
          payload: {
            reason: opts.reason ?? "RECALC",
            pricingStale: result.pricingStale,
            staleSymbols: result.staleSymbols,
            asOf: result.asOf.toISOString(),
            summary,
          },
        });
      }
      return result;
    }
    
    // Cache quotes with full bid/ask/mid data per symbol
    const quoteCache = new Map<string, QuoteData>();
    const staleSymbols: string[] = [];
    const now = Date.now();
    
    // Collect all required symbols (trade symbols + FX reference pairs)
    const tradeSymbols = Array.from(
      new Set(openTrades.map((t) => String(t.symbol.symbol).replace("/", "").toUpperCase()))
    );
    const allRequiredSymbols = Array.from(new Set([...tradeSymbols, ...FX_REFERENCE_PAIRS]));
    
    // Prefer in-memory QuoteHub or Valkey snapshot; fall back to DB only if needed.
    let quoteRows: any[] = [];
    const hubSnapshot = getQuoteSnapshot(allRequiredSymbols);
    if (hubSnapshot.rows.length) {
      quoteRows = hubSnapshot.rows;
    }

    if (!quoteRows.length) {
      quoteRows = await getValkeyQuoteRows(allRequiredSymbols);
    }

    if (!quoteRows.length) {
      try {
        quoteRows = await db
          .select({
            symbol: quotes.symbol,
            price: quotes.price,
            bid: quotes.bid,
            ask: quotes.ask,
            updatedAt: quotes.updatedAt,
            isStale: quotes.isStale,
            lastApiUpdate: quotes.lastApiUpdate,
          })
          .from(quotes)
          .where(inArray(quotes.symbol, allRequiredSymbols));
      } catch (error) {
        console.error('Error fetching quotes for recalc:', error);
        quoteRows = [];
      }
    }

    if (!quoteRows.length) {
      const result: RecalcResult = {
        startingBalance,
        balance,
        usedMargin: user.usedMargin ?? 0,
        equity: user.equity ?? balance,
        freeMargin: user.freeMargin ?? balance,
        floatingPnl: (user.equity ?? balance) - balance,
        marginLevel: null,
        openPositions: openTrades.length,
        pricingStale: true,
        staleSymbols: tradeSymbols,
        asOf,
      };
      if (opts?.emit) {
        const summary = {
          startingBalance: result.startingBalance,
          balance: result.balance,
          equity: result.equity,
          floatingPnl: result.floatingPnl,
          usedMargin: result.usedMargin,
          freeMargin: result.freeMargin,
          marginLevel: result.marginLevel,
          openPositions: result.openPositions,
          pricingStale: result.pricingStale,
          staleSymbols: result.staleSymbols,
          asOf: result.asOf.toISOString(),
        };
        publishLiveEvent({
          type: "account:updated",
          userId,
          payload: {
            reason: opts.reason ?? "RECALC",
            pricingStale: result.pricingStale,
            staleSymbols: result.staleSymbols,
            asOf: result.asOf.toISOString(),
            summary,
          },
        });
      }
      return result;
    }

    for (const row of quoteRows) {
      const symbol = String(row.symbol);
      const bid = row.bid !== null && row.bid !== undefined ? Number(row.bid) : null;
      const ask = row.ask !== null && row.ask !== undefined ? Number(row.ask) : null;
      const price = Number(row.price);
      const mid = (bid !== null && ask !== null) ? (bid + ask) / 2 : price;

      const lastApiRaw = row.lastApiUpdate ?? row.last_api_update ?? row.updatedAt ?? row.updated_at;
      const lastApiMs = lastApiRaw ? (lastApiRaw < 1e12 ? lastApiRaw * 1000 : lastApiRaw) : 0;
      const isStale = Boolean(row.isStale) || !lastApiMs || (now - lastApiMs > STALE_THRESHOLD_MS);

      quoteCache.set(symbol, { bid, ask, price, mid, updatedAt: lastApiMs, isStale });

      if (isStale && tradeSymbols.includes(symbol)) {
        staleSymbols.push(symbol);
      }
    }

    for (const symbol of tradeSymbols) {
      if (!quoteCache.has(symbol)) {
        staleSymbols.push(symbol);
      }
    }
    
    // Check FX reference pairs for staleness (needed for cross-pair conversions)
    const fxStale = FX_REFERENCE_PAIRS.some(pair => {
      const q = quoteCache.get(pair);
      return !q || q.isStale;
    });
    
    // OPTION 1: If any required quote is stale, freeze metrics - don't update DB
    if (staleSymbols.length > 0 || fxStale) {
      console.log(`User ${userId} pricing stale: symbols=${staleSymbols.join(',')} fxStale=${fxStale}`);
      
      const result: RecalcResult = {
        startingBalance,
        balance,
        usedMargin: user.usedMargin ?? 0,
        equity: user.equity ?? balance,
        freeMargin: user.freeMargin ?? balance,
        floatingPnl: (user.equity ?? balance) - balance,
        marginLevel: user.usedMargin && user.usedMargin > 0 
          ? ((user.equity ?? balance) / user.usedMargin) * 100 
          : null,
        openPositions: openTrades.length,
        pricingStale: true,
        staleSymbols: Array.from(new Set(staleSymbols)),
        asOf,
      };
      if (opts?.emit) {
        const summary = {
          startingBalance: result.startingBalance,
          balance: result.balance,
          equity: result.equity,
          floatingPnl: result.floatingPnl,
          usedMargin: result.usedMargin,
          freeMargin: result.freeMargin,
          marginLevel: result.marginLevel,
          openPositions: result.openPositions,
          pricingStale: result.pricingStale,
          staleSymbols: result.staleSymbols,
          asOf: result.asOf.toISOString(),
        };
        publishLiveEvent({
          type: "account:updated",
          userId,
          payload: {
            reason: opts.reason ?? "RECALC",
            pricingStale: result.pricingStale,
            staleSymbols: result.staleSymbols,
            asOf: result.asOf.toISOString(),
            summary,
          },
        });
      }
      return result;
    }
    
    // Update FX rates for proper conversion
    const fxQuotes: { symbol: string; price: number }[] = [];
    for (const pair of FX_REFERENCE_PAIRS) {
      const q = quoteCache.get(pair);
      if (q) {
        fxQuotes.push({ symbol: pair, price: q.mid });
      }
    }
    
    if (fxQuotes.length > 0) {
      updateFxRates(fxQuotes);
    }
    
    // Calculate used margin and floating P/L with correct per-trade pricing
    let usedMargin = 0;
    let floatingProfit = 0;
    
    for (const trade of openTrades) {
      const symbol = trade.symbol.symbol;
      const quote = quoteCache.get(symbol);
      
      if (!quote) {
        // This shouldn't happen since we already checked above
        console.error(`Missing quote for ${symbol} during calculation`);
        continue;
      }
      
      // CRITICAL FIX: Use correct price per trade side
      // BUY positions close at BID (what we could sell at)
      // SELL positions close at ASK (what we could buy back at)
      let mtmPrice: number;
      if (trade.type === 'BUY') {
        mtmPrice = quote.bid !== null ? quote.bid : quote.mid;
      } else {
        mtmPrice = quote.ask !== null ? quote.ask : quote.mid;
      }
      
      // Calculate margin required for this position
      const tradeSize = trade.lots || (trade.size / 100000);
      const marginForTrade = requiredMargin(
        symbol,
        tradeSize,
        mtmPrice, // Use current price for margin, not openPrice
        user.leverage || 5
      );
      
      usedMargin += marginForTrade;
      
      // Calculate floating profit/loss
      const pnl = unrealizedPnl(
        symbol,
        trade.type as 'BUY' | 'SELL',
        trade.openPrice,
        mtmPrice,
        tradeSize
      );

      // Include carry and overnight swap accrual for open positions in floating P/L.
      // Open-side execution costs are already realized at open and reflected in balance.
      const holdingCosts = await computeOpenTradeAccrualCosts({
        category: trade.categorySnapshot ?? trade.symbol?.category,
        positionSide: trade.type as 'BUY' | 'SELL',
        notionalUsd: trade.notionalUsd,
        size: Number(trade.size ?? tradeSize * 100000),
        lots: tradeSize,
        openedAt: trade.openedAt,
        executedAt: trade.executedAt,
        asOfMs: Date.now(),
      });
      const netFloating = pnl - holdingCosts.accruedHoldingCostsUsd;

      floatingProfit += netFloating;
      
      console.log(
        `Trade ${trade.id} ${trade.type} ${symbol}: openPrice=${trade.openPrice} mtmPrice=${mtmPrice} ` +
        `grossPnl=${pnl.toFixed(2)} accrual=${holdingCosts.accruedHoldingCostsUsd.toFixed(2)} netPnl=${netFloating.toFixed(2)}`
      );
    }
    
    // Calculate equity and free margin
    const equity = balance + floatingProfit;
    const freeMargin = Math.max(0, equity - usedMargin);
    const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : null;
    
    // Update user in database
    await db.update(users)
      .set({
        usedMargin,
        equity,
        freeMargin
      })
      .where(eq(users.id, userId));
    
    console.log(`User ${userId} margin metrics recalculated:
      Balance: $${balance.toFixed(2)}
      Floating P/L: $${floatingProfit.toFixed(2)}
      Equity: $${equity.toFixed(2)}
      Used margin: $${usedMargin.toFixed(2)}
      Free margin: $${freeMargin.toFixed(2)}
      Margin level: ${marginLevel !== null ? marginLevel.toFixed(2) + '%' : 'N/A'}`
    );
    
    const result: RecalcResult = {
      startingBalance,
      balance,
      usedMargin,
      equity,
      freeMargin,
      floatingPnl: floatingProfit,
      marginLevel,
      openPositions: openTrades.length,
      pricingStale: false,
      staleSymbols: [],
      asOf,
    };
    if (opts?.emit) {
      const summary = {
        startingBalance: result.startingBalance,
        balance: result.balance,
        equity: result.equity,
        floatingPnl: result.floatingPnl,
        usedMargin: result.usedMargin,
        freeMargin: result.freeMargin,
        marginLevel: result.marginLevel,
        openPositions: result.openPositions,
        pricingStale: result.pricingStale,
        staleSymbols: result.staleSymbols,
        asOf: result.asOf.toISOString(),
      };
      publishLiveEvent({
        type: "account:updated",
        userId,
        payload: {
          reason: opts.reason ?? "RECALC",
          pricingStale: result.pricingStale,
          staleSymbols: result.staleSymbols,
          asOf: result.asOf.toISOString(),
          summary,
        },
      });
    }
    return result;
  } catch (error) {
    console.error('Error recalculating account metrics:', error);
    return null;
  }
}
