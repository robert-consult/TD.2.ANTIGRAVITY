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

