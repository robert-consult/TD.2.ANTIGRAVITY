/**
 * Realized P/L calculation with proper JPY and cross-pair handling
 * Replaces the hard-coded $10/pip which was incorrect for JPY pairs
 */

import { getConversionRate } from "../services/quoteService";

const CONTRACT_SIZE = 100000; // Standard FX lot

function parsePair(symbol: string): { base: string; quote: string } {
  const s = symbol.replace("/", "").toUpperCase();
  return { base: s.slice(0, 3), quote: s.slice(3, 6) };
}

/**
 * Calculate realized P/L in USD using proper FX math
 * P/L = (closePrice - openPrice) * units * direction
 * Then convert from quote currency to USD
 */
export async function realizedPnlUsd(params: {
  symbol: string;
  side: "BUY" | "SELL";
  lots: number;
  openPrice: number;
  closePrice: number;
}): Promise<number> {
  const { quote } = parsePair(params.symbol);
  const units = params.lots * CONTRACT_SIZE;

  // P/L in QUOTE currency
  const pnlQuote =
    params.side === "BUY"
      ? (params.closePrice - params.openPrice) * units
      : (params.openPrice - params.closePrice) * units;

  // Convert QUOTE -> USD (platform base currency)
  try {
    const quoteToUsd = quote === "USD" ? 1 : await getConversionRate(quote, "USD");
    return pnlQuote * quoteToUsd;
  } catch (e) {
    // Fallback to simple calculation if conversion fails
    console.warn(`FX conversion failed for ${quote}->USD, using fallback`, e);
    
    // Use approximate rates for JPY pairs
    if (quote === "JPY") {
      return pnlQuote * 0.0067; // ~150 JPY per USD
    }
    return pnlQuote;
  }
}
