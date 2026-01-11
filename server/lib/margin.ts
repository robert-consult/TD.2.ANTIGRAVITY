export const LOT_SIZE = 100000; // 1 lot = $100,000 contract (standard lot)
export const STANDARD_LEVERAGE = 5; // 5:1 leverage standard for the platform

// Instrument-specific constants
export interface Instrument {
  symbol: string;
  contractSize: number;  // typically 100,000 units of base currency
  pipSize: number;       // 0.0001 for most pairs, 0.01 for JPY pairs
  quoteCurrency: string; // USD, JPY, etc.
}

// Standard forex instrument definitions
export const INSTRUMENTS: Record<string, Instrument> = {
  'EURUSD': { symbol: 'EURUSD', contractSize: 100000, pipSize: 0.0001, quoteCurrency: 'USD' },
  'GBPUSD': { symbol: 'GBPUSD', contractSize: 100000, pipSize: 0.0001, quoteCurrency: 'USD' },
  'USDJPY': { symbol: 'USDJPY', contractSize: 100000, pipSize: 0.01, quoteCurrency: 'JPY' },
  'EURJPY': { symbol: 'EURJPY', contractSize: 100000, pipSize: 0.01, quoteCurrency: 'JPY' },
  'GBPJPY': { symbol: 'GBPJPY', contractSize: 100000, pipSize: 0.01, quoteCurrency: 'JPY' },
  'AUDUSD': { symbol: 'AUDUSD', contractSize: 100000, pipSize: 0.0001, quoteCurrency: 'USD' },
  'USDCAD': { symbol: 'USDCAD', contractSize: 100000, pipSize: 0.0001, quoteCurrency: 'CAD' },
  'XAUUSD': { symbol: 'XAUUSD', contractSize: 100, pipSize: 0.01, quoteCurrency: 'USD' }, // Gold (different contract size)
  // Add more instruments as needed
};

// Cross rates for converting to USD (updated from live feed)
export const FX_RATES: Record<string, number> = {
  'USD': 1.0,     // 1 USD = 1 USD (base)
  'JPY': 0.0069,  // 1 JPY = 0.0069 USD (approximate, should be updated from feed)
  'EUR': 1.124,   // 1 EUR = 1.124 USD (approximate, should be updated from feed)
  'GBP': 1.336,   // 1 GBP = 1.336 USD (approximate, should be updated from feed)
  'CAD': 0.718,   // 1 CAD = 0.718 USD (approximate, should be updated from feed)
};

/**
 * Update FX rates from latest quotes
 * @param quotes Latest quotes from price feed
 */
export function updateFxRates(quotes: any[]) {
  if (!Array.isArray(quotes)) return;
  
  // Update FX rates based on latest quotes
  for (const quote of quotes) {
    if (!quote || typeof quote !== 'object') continue;
    
    if (quote.symbol === 'EURUSD' && quote.price) {
      FX_RATES['EUR'] = quote.price;
    } else if (quote.symbol === 'GBPUSD' && quote.price) {
      FX_RATES['GBP'] = quote.price;
    } else if (quote.symbol === 'USDJPY' && quote.price) {
      // For USDJPY, the rate is inverted (1/price)
      FX_RATES['JPY'] = 1 / quote.price;
    } else if (quote.symbol === 'USDCAD' && quote.price) {
      FX_RATES['CAD'] = 1 / quote.price;
    }
  }
}

/**
 * Get the pip value for a specific instrument
 * @param symbol Instrument symbol (e.g., 'EURUSD', 'USDJPY')
 * @param price Current price of the instrument
 * @returns Value of one pip in USD
 */
export function getPipValue(symbol: string, price: number): number {
  const instrument = INSTRUMENTS[symbol] || INSTRUMENTS['EURUSD'];
  
  if (instrument.quoteCurrency === 'USD') {
    // For USD-quoted pairs (like EURUSD, GBPUSD), pip value = lot size * pip size
    return instrument.contractSize * instrument.pipSize;
  } else if (instrument.quoteCurrency === 'JPY') {
    // For JPY pairs, pip value = (lot size * pip size) / price
    return (instrument.contractSize * instrument.pipSize) / price;
  } else {
    // For other pairs, need to convert to USD
    const pipValueInQuoteCurrency = instrument.contractSize * instrument.pipSize;
    return convertCurrency(pipValueInQuoteCurrency, instrument.quoteCurrency, 'USD');
  }
}

/**
 * Convert amount from one currency to another
 * @param amount Amount to convert
 * @param fromCurrency Source currency code
 * @param toCurrency Target currency code
 */
export function convertCurrency(amount: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return amount;
  
  // Convert to USD first (as base currency)
  const amountInUsd = amount * (FX_RATES[fromCurrency] || 1);
  
  // Then convert from USD to target currency
  if (toCurrency === 'USD') return amountInUsd;
  return amountInUsd / (FX_RATES[toCurrency] || 1);
}

/**
 * Calculate required margin based on position size and leverage
 * @param symbol Instrument symbol (e.g., 'EURUSD', 'USDJPY')
 * @param lots Number of lots in the position
 * @param price Current price of the instrument
 * @param leverage Account leverage ratio (defaults to 5:1)
 * @returns Required margin in USD
 */
export function requiredMargin(symbol: string, lots: number, price: number, leverage: number = STANDARD_LEVERAGE) {
  // Default to standard instrument if symbol not found
  const symbolUpper = symbol?.toUpperCase() || 'EURUSD';
  const instrument = INSTRUMENTS[symbolUpper] || getInstrumentBySymbol(symbolUpper);
  
  // Calculate notional value in base currency
  const notionalValue = instrument.contractSize * lots;
  
  if (instrument.quoteCurrency === 'USD') {
    // Simple case: USD is the quote currency (EURUSD, GBPUSD)
    return (notionalValue * price) / leverage;
  } else if (symbolUpper.startsWith('USD')) {
    // USD is the base currency (USDJPY, USDCAD)
    return notionalValue / leverage;
  } else {
    // Cross rates (EURJPY, GBPJPY)
    // First convert to USD, then apply leverage
    const notionalInQuote = notionalValue * price;
    const notionalInUsd = convertCurrency(notionalInQuote, instrument.quoteCurrency, 'USD');
    return notionalInUsd / leverage;
  }
}

/**
 * Helper function to get instrument by symbol
 * @param symbol Instrument symbol
 * @returns Instrument configuration
 */
function getInstrumentBySymbol(symbol: string): Instrument {
  // Default instrument if not found
  const defaultInstrument = INSTRUMENTS['EURUSD'];
  
  // Try to determine the instrument type and properties
  if (symbol.includes('JPY')) {
    return {
      symbol,
      contractSize: 100000,
      pipSize: 0.01,
      quoteCurrency: 'JPY'
    };
  } else if (symbol.includes('XAU') || symbol.includes('GOLD')) {
    return {
      symbol, 
      contractSize: 100,
      pipSize: 0.01,
      quoteCurrency: 'USD'
    };
  } else if (symbol.includes('USD')) {
    if (symbol.startsWith('USD')) {
      // USD is base (USDJPY, USDCAD)
      return {
        symbol,
        contractSize: 100000,
        pipSize: 0.0001,
        quoteCurrency: symbol.substring(3) // Extract quote currency
      };
    } else {
      // USD is quote (EURUSD, GBPUSD)
      return {
        symbol,
        contractSize: 100000,
        pipSize: 0.0001,
        quoteCurrency: 'USD'
      };
    }
  }
  
  // Default to USD-quoted pair
  return {
    symbol,
    contractSize: 100000,
    pipSize: 0.0001,
    quoteCurrency: 'USD'
  };
}

/**
 * Calculate unrealized profit/loss for an open position
 * @param symbol Instrument symbol
 * @param type Trade type (BUY/SELL)
 * @param openPrice Original entry price
 * @param currentPrice Current market price
 * @param lots Number of lots in position
 * @returns Unrealized P/L in USD
 */
export function unrealizedPnl(symbol: string, type: 'BUY' | 'SELL', openPrice: number, currentPrice: number, lots: number) {
  // Default to standard instrument if symbol not found
  const symbolUpper = symbol?.toUpperCase() || 'EURUSD';
  const instrument = INSTRUMENTS[symbolUpper] || getInstrumentBySymbol(symbolUpper);
  
  // Calculate price difference based on direction
  const diff = type === 'BUY' ? currentPrice - openPrice : openPrice - currentPrice;
  
  // Calculate P/L in quote currency
  const pnlQuote = diff * instrument.contractSize * lots;
  
  // Calculate number of pips moved
  const pips = diff / instrument.pipSize;
  
  // For JPY pairs and certain instruments that need conversion
  if (instrument.quoteCurrency !== 'USD') {
    // Convert PnL to USD
    return convertCurrency(pnlQuote, instrument.quoteCurrency, 'USD');
  } else {
    // USD is quote currency, no conversion needed
    return pnlQuote;
  }
}

/**
 * Calculate equity based on account balance and floating P/L
 * @param balance Current account balance
 * @param floatingPnL Unrealized (floating) profit/loss
 * @returns Account equity
 */
export function calculateEquity(balance: number, floatingPnL: number): number {
  return balance + floatingPnL;
}

/**
 * Calculate free margin based on equity and used margin
 * @param equity Current account equity
 * @param usedMargin Current used margin
 * @returns Free margin available for new positions
 */
export function calculateFreeMargin(equity: number, usedMargin: number): number {
  return equity - usedMargin;
}

/**
 * Calculate margin level as a percentage
 * @param equity Current account equity
 * @param usedMargin Current used margin
 * @returns Margin level as a percentage (equity/used margin * 100%)
 */
export function calculateMarginLevel(equity: number, usedMargin: number): number {
  if (usedMargin === 0) return Infinity; // No margin used = infinite margin level
  return (equity / usedMargin) * 100;
}

/**
 * Convert price difference to pips for a specific symbol
 * @param symbol Instrument symbol
 * @param priceDiff Difference between two prices
 * @returns Number of pips
 */
export function priceDiffToPips(symbol: string, priceDiff: number): number {
  const symbolUpper = symbol?.toUpperCase() || 'EURUSD';
  const instrument = INSTRUMENTS[symbolUpper] || getInstrumentBySymbol(symbolUpper);
  return priceDiff / instrument.pipSize;
}

/**
 * Calculate profit from price difference in pips
 * @param symbol Instrument symbol
 * @param priceDiff Difference between two prices
 * @param lots Number of lots
 * @returns Profit in USD
 */
export function profitFromPips(symbol: string, priceDiff: number, lots: number): number {
  const symbolUpper = symbol?.toUpperCase() || 'EURUSD';
  const instrument = INSTRUMENTS[symbolUpper] || getInstrumentBySymbol(symbolUpper);
  
  // Calculate pips
  const pips = priceDiffToPips(symbol, priceDiff);
  
  // Get pip value in USD
  const pipValueInUsd = getPipValue(symbol, priceDiff);
  
  // Calculate profit
  return pips * pipValueInUsd * lots;
}