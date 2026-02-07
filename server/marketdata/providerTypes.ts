export type ProviderSymbolInput = {
  canonicalSymbol: string;
  providerSymbol: string;
};

export type ProviderQuote = {
  canonicalSymbol: string;
  bid: number | null;
  ask: number | null;
  price: number | null;
  tsMs: number;
};

export type ProviderFetchQuotesResult = {
  quotes: ProviderQuote[];
  raw?: unknown;
};

export type ProviderQuoteStreamState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type ProviderQuoteStreamHandlers = {
  onQuotes: (quotes: ProviderQuote[]) => void | Promise<void>;
  onError: (error: unknown) => void;
  onStateChange?: (state: ProviderQuoteStreamState, meta?: Record<string, any>) => void;
};

export type ProviderQuoteStreamSession = {
  updateSymbols: (symbols: ProviderSymbolInput[]) => void | Promise<void>;
  close: (reason?: string) => void | Promise<void>;
};

export type ProviderCapability = {
  quotesRest: boolean;
  quotesWs: boolean;
  referenceData: boolean;
  batchSymbols: boolean;
};

export interface MarketDataProvider {
  providerKey: string;
  displayName: string;
  driver: string;
  capability: ProviderCapability;
  maxBatchSymbols: number;

  /**
   * Fetch quotes for the requested provider symbols.
   * Implementations should return canonical symbols in the result.
   */
  fetchQuotes(params: { symbols: ProviderSymbolInput[] }): Promise<ProviderFetchQuotesResult>;

  /**
   * Optional streaming quote source.
   * If provided and capability.quotesWs is true, quoteFeed can switch upstream ingestion to provider WS.
   */
  openQuoteStream?(params: {
    symbols: ProviderSymbolInput[];
    handlers: ProviderQuoteStreamHandlers;
  }): Promise<ProviderQuoteStreamSession>;

  /**
   * Optional: list reference instruments for ingestion.
   * Must return an array of provider-native records (raw) that the ingestor can normalize.
   */
  listReference?(params: {
    category: string;
    filter?: Record<string, string>;
    limit?: number;
  }): Promise<Array<Record<string, any>>>;

  /**
   * Optional: default symbol mapping when no per-instrument override exists.
   * Return null to indicate the symbol cannot be requested from this provider.
   */
  mapSymbol?(canonicalSymbol: string): string | null;
}
