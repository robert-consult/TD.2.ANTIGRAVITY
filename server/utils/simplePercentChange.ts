// @ts-nocheck
import { ensureMarketDailyCloseTable } from "./marketDailyClose";
import { cachePrevClose, getCachedPrevClose, normalizePrevCloseSymbol } from "./prevCloseStore";

/**
 * Simple utility to calculate percentage changes using cached prices
 * Since we can't access the 1Forge historical API with current subscription
 */

/**
 * Initialize cache table for storing previous closing prices
 */
export async function initCache(): Promise<void> {
  await ensureMarketDailyCloseTable();
  console.log("Market daily close cache ready");
}

/**
 * Cache current prices once per day to use as reference
 * for percentage change calculations
 */
export async function updateDailyPrices(
  quotes: Array<{ symbol: string; price?: number; bid?: number; ask?: number }>
): Promise<void> {
  if (!quotes || quotes.length === 0) return;

  await ensureMarketDailyCloseTable();

  try {
    console.log("Updating daily reference prices for percentage change calculations");
    for (const quote of quotes) {
      if (!quote.symbol) continue;
      const sym = normalizePrevCloseSymbol(quote.symbol);
      const price =
        quote.price ??
        (quote.bid != null && quote.ask != null ? (quote.bid + quote.ask) / 2 : null);
      if (price != null && Number.isFinite(price)) {
        await cachePrevClose(sym, Number(price));
      }
    }
    console.log("Daily reference prices updated");
  } catch (error) {
    console.error("Error updating daily prices:", error);
  }
}

/**
 * Calculate percentage change between current price and previous reference
 */
export async function calculatePercentChange(symbol: string, currentPrice: number): Promise<number> {
  try {
    const sym = normalizePrevCloseSymbol(symbol);
    const prev = await getCachedPrevClose(sym);
    if (prev != null && prev > 0) {
      const change = ((currentPrice - prev) / prev) * 100;
      // Round to 2 decimal places
      return Math.round(change * 100) / 100;
    }
    
    // If no reference price exists yet, store current price and return 0
    if (Number.isFinite(currentPrice)) {
      await cachePrevClose(sym, currentPrice);
    }
    return 0;
  } catch (error) {
    console.error(`Error calculating percentage change for ${symbol}:`, error);
    return 0;
  }
}

/**
 * Update the cache with initial values if empty
 */
export function preloadCache(symbols: string[]): void {
  // This is now a no-op since we'll populate on first quote
  console.log("Ready to start tracking percentage changes");
}
// @ts-nocheck
// @ts-nocheck
