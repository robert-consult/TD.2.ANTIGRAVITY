// @ts-nocheck
import 'dotenv/config';
import axios from 'axios';
import pThrottle from 'p-throttle';
import BetterSQLite3 from 'better-sqlite3';
import { instruments } from '../../data/instruments';
import { recalcAccount } from '../recalcAccount';
import { onQuotesUpdated } from '../engine/orderEngine';
import { computeSessionDayForQuote, ensureMarketDailyCloseTable } from '../utils/marketDailyClose';
import { publishLiveEvent } from '../services/liveBus';

// Get the API key from environment variables
const API_KEY = process.env.FORGE_KEY;
console.log("1Forge API Key present:", !!API_KEY); // Log if API key is present

// Tier flag - set to true for REST-only mode (no WebSocket from 1Forge)
const STARTER = true;      // Using REST polling at 870ms (100k calls/day tier)

/* ------------ 0) constants & dynamic config ------------ */
const REST_LIMIT_PER_DAY = 100000;             // upgraded tier (100k calls/day)
const MAX_PER_REQ        = 100;                // 1Forge batch cap
const DEFAULT_POLL_MS    = 870;                // Default 870ms for real-time quotes
const DEFAULT_STALE_MS   = 30000;              // Default 30 seconds stale threshold

// Dynamic config - can be updated at runtime without restart
let dynamicConfig = {
  pollIntervalMs: DEFAULT_POLL_MS,
  staleThresholdMs: DEFAULT_STALE_MS
};

// Timer reference for dynamic interval management
let pollTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Load feed config from database
 */
function loadFeedConfig(): { pollIntervalMs: number; staleThresholdMs: number } {
  try {
    const dbClient = new BetterSQLite3('./trading_app.db');
    try { dbClient.pragma("busy_timeout = 5000"); } catch {}
    const row = dbClient.prepare(`
      SELECT feed_poll_ms, stale_threshold_ms FROM system_config WHERE id = 1
    `).get() as any;
    dbClient.close();
    
    if (row) {
      return {
        pollIntervalMs: row.feed_poll_ms ?? DEFAULT_POLL_MS,
        staleThresholdMs: row.stale_threshold_ms ?? DEFAULT_STALE_MS
      };
    }
  } catch (e) {
    console.warn('[FeedConfig] Could not load config from DB, using defaults');
  }
  return { pollIntervalMs: DEFAULT_POLL_MS, staleThresholdMs: DEFAULT_STALE_MS };
}

/**
 * Reload config from database and apply immediately (no restart needed)
 */
export function reloadFeedConfig() {
  const newConfig = loadFeedConfig();
  const oldPoll = dynamicConfig.pollIntervalMs;
  dynamicConfig = newConfig;
  console.log(`[FeedConfig] Reloaded: poll=${dynamicConfig.pollIntervalMs}ms, stale=${dynamicConfig.staleThresholdMs}ms`);
  
  if (oldPoll !== dynamicConfig.pollIntervalMs) {
    console.log(`[FeedConfig] Polling interval changed from ${oldPoll}ms to ${dynamicConfig.pollIntervalMs}ms - applying immediately`);
  }
}

// Load initial config
dynamicConfig = loadFeedConfig();
console.log(`[FeedConfig] Initial: poll=${dynamicConfig.pollIntervalMs}ms, stale=${dynamicConfig.staleThresholdMs}ms`);

// Rate limit backoff tracking
let isRateLimited = false;
let rateLimitBackoffMs = 60000;                // Start with 1 minute backoff when rate limited
let lastRateLimitTime = 0;

/* ------------ DYNAMIC FALLBACK CACHE ------------ */
// In-memory cache for quote snapshots with timestamps - used as fallback when API fails
interface QuoteSnapshot {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  lastUpdated: number;      // Unix timestamp (ms) of last successful API update
  isStale: boolean;         // True if data hasn't been refreshed within threshold
  consecutiveFailures: number; // Track API failures for this symbol
}

// Global cache - continuously updated with fresh API data
const quoteSnapshotCache = new Map<string, QuoteSnapshot>();

// Track last successful API call timestamp
let lastSuccessfulApiCall = 0;
let consecutiveApiFailures = 0;

/**
 * Updates the snapshot cache with fresh quote data
 */
function updateSnapshotCache(quotes: any[]) {
  const now = Date.now();
  for (const quote of quotes) {
    if (quote && quote.symbol) {
      const updatedAt = typeof quote.lastUpdated === "number" ? quote.lastUpdated : now;
      quoteSnapshotCache.set(quote.symbol, {
        symbol: quote.symbol,
        price: quote.price,
        bid: quote.bid,
        ask: quote.ask,
        lastUpdated: updatedAt,
        isStale: false,
        consecutiveFailures: 0
      });
    }
  }
  lastSuccessfulApiCall = now;
  consecutiveApiFailures = 0;
  console.log(`[Fallback Cache] Updated ${quotes.length} quote snapshots`);
}

/**
 * Gets cached quotes as fallback data when API is unavailable
 * Marks quotes as stale if they exceed the freshness threshold
 */
function getCachedQuotesAsFallback(): QuoteSnapshot[] {
  const now = Date.now();
  const fallbackQuotes: QuoteSnapshot[] = [];
  
  for (const [symbol, snapshot] of quoteSnapshotCache) {
    const ageMs = now - snapshot.lastUpdated;
    const isStale = ageMs > dynamicConfig.staleThresholdMs;
    
    fallbackQuotes.push({
      ...snapshot,
      isStale,
      consecutiveFailures: snapshot.consecutiveFailures + 1
    });
    
    // Update the cache entry to reflect staleness
    quoteSnapshotCache.set(symbol, {
      ...snapshot,
      isStale,
      consecutiveFailures: snapshot.consecutiveFailures + 1
    });
  }
  
  return fallbackQuotes;
}

/**
 * Export function to get current cache state for API endpoint
 */
export function getQuoteSnapshotCache(): Map<string, QuoteSnapshot> {
  return quoteSnapshotCache;
}

/**
 * Export function to get cache statistics
 */
export function getCacheStats() {
  return {
    cacheSize: quoteSnapshotCache.size,
    lastSuccessfulApiCall,
    consecutiveApiFailures,
    staleCount: [...quoteSnapshotCache.values()].filter(q => q.isStale).length
  };
}

/**
 * Uses cached fallback data when API is unavailable
 * Persists the cached quotes (ALWAYS marked as stale) so the app continues to function
 */
function useFallbackCache() {
  const fallbackQuotes = getCachedQuotesAsFallback();
  
  if (fallbackQuotes.length > 0) {
    console.log(`[Fallback] Using ${fallbackQuotes.length} cached quotes as fallback (marked stale)`);
    
    // Convert to the format expected by persist function
    // ALWAYS mark as stale since we're using cached data, not live API data
    const quotesForPersist = fallbackQuotes.map(q => ({
      symbol: q.symbol,
      price: q.price,
      bid: q.bid,
      ask: q.ask,
      timestamp: Math.floor(q.lastUpdated / 1000),
      isStale: true,  // Always stale when using fallback
      lastUpdated: q.lastUpdated
    }));
    
    // Persist with staleness metadata
    persistWithMeta(quotesForPersist);
  } else {
    console.warn('[Fallback] No cached data available - cache is empty');
    // As a last resort, use static fallback prices (also marked as stale)
    const staticFallback = generateSimulatedQuotes(['EURUSD', 'GBPUSD', 'USDJPY', 'EURJPY', 'GBPJPY', 'AUDUSD']);
    console.log('[Fallback] Using static fallback prices as last resort (marked stale)');
    // Use persistWithMeta for static fallback too so they're marked stale
    const staticWithMeta = staticFallback.map(q => ({
      ...q,
      isStale: true,
      lastUpdated: Date.now()
    }));
    persistWithMeta(staticWithMeta);
  }
}

/**
 * Gets all active instruments from the database
 * @param dbClient - SQLite database client
 * @returns Array of active instrument symbols
 */
function getActiveInstruments(dbClient: any): string[] {
  try {
    // Get all active instruments (enabled = 1)
    const query = `SELECT symbol FROM symbol_configs WHERE enabled = 1`;
    const results = dbClient.prepare(query).all();
    return results.map((row: any) => row.symbol);
  } catch (error) {
    console.error('[1Forge] Error getting active instruments:', error);
    // Return a minimal set of instruments as fallback
    return ['EURUSD', 'GBPUSD', 'USDJPY', 'EURJPY', 'GBPJPY'];
  }
}

/**
 * Formats symbols for the 1Forge API
 * @param symbols - Array of instrument symbols
 * @returns Comma-separated string of 1Forge-formatted symbols
 */
function formatSymbolsForForgeAPI(symbols: string[]): string {
  // 1Forge requires format like EUR/USD, GBP/JPY, XAU/USD
  const formattedSymbols = symbols.map(symbol => {
    // If symbol already has slash, keep as is
    if (symbol.includes('/')) return symbol;
    
    // For 6-character forex pairs (EURUSD, GBPJPY)
    if (symbol.length === 6 && !symbol.includes('JPY')) {
      return `${symbol.substring(0, 3)}/${symbol.substring(3, 6)}`;
    }
    
    // For JPY pairs (USDJPY, EURJPY)
    if (symbol.includes('JPY')) {
      if (symbol.startsWith('JPY')) {
        return `JPY/${symbol.substring(3, 6)}`;
      } else {
        return `${symbol.substring(0, 3)}/JPY`;
      }
    }
    
    // For commodities
    if (symbol === 'XAUUSD') return 'XAU/USD';
    if (symbol === 'XAGUSD') return 'XAG/USD';
    
    // For indices
    if (symbol === 'US30') return 'USA30';
    if (symbol === 'NGAS') return 'NATGAS';
    if (symbol === 'WTI') return 'USOIL';
    
    // For any other symbols, return as is (will be simulated)
    return symbol;
  }).filter(s => s.includes('/'));
  
  // Always ensure these critical pairs are included
  const requiredPairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'GBP/JPY', 'EUR/JPY'];
  const allPairs = [...new Set([...formattedSymbols, ...requiredPairs])];
  
  return allPairs.join(',');
}

/* ------------ 1) symbol universe ------------ */
const ALL = instruments.map(i => i.symbol);
let dynamicSet = new Set<string>();         // symbols with open positions

/* ------------ 2) throttle guard ------------ */
const throttle = pThrottle({ limit: REST_LIMIT_PER_DAY, interval: 86_400_000 });

/* ------------ 3) batch pull ------------ */
async function pullBatch() {
  // Check if we're in rate limit backoff period
  if (isRateLimited) {
    const timeSinceRateLimit = Date.now() - lastRateLimitTime;
    if (timeSinceRateLimit < rateLimitBackoffMs) {
      console.log(`[1Forge] Rate limited, waiting ${Math.ceil((rateLimitBackoffMs - timeSinceRateLimit) / 1000)}s before retry. Using cached data.`);
      useFallbackCache();
      return;
    }
    // Backoff period expired, try again
    console.log('[1Forge] Rate limit backoff expired, retrying API call...');
    isRateLimited = false;
  }

  // Get all symbols we care about (dynamic + base symbols, up to the limit)
  const wanted = [...new Set([...dynamicSet, ...ALL.slice(0, MAX_PER_REQ)])];
  const chunks = [];
  
  // Split into chunks of MAX_PER_REQ
  for (let i = 0; i < wanted.length; i += MAX_PER_REQ) {
    chunks.push(wanted.slice(i, i + MAX_PER_REQ));
  }

  for (const slice of chunks) {
    try {
      if (!API_KEY) {
        console.error("ERROR: No 1Forge API key available - please provide a valid FORGE_KEY");
        useFallbackCache();
        return;
      }
      
      // Format symbols as comma-separated list
      const symbolList = slice.join(',');
      
      // Get a list of all active symbols from our database first
      const dbClient = new BetterSQLite3('./trading_app.db');
      try { dbClient.pragma("busy_timeout = 5000"); } catch {}
      const activeSymbolsQuery = dbClient.prepare('SELECT symbol FROM symbol_configs WHERE enabled = 1').all();
      const activeSymbols = activeSymbolsQuery.map((row: any) => row.symbol);
      
      // Get all active instruments from the database
      const activeInstruments = getActiveInstruments(dbClient);
      
      // Format symbols for 1Forge API and prepare the request
      let formattedSymbols = formatSymbolsForForgeAPI(activeInstruments);
      
      // Log active instruments being tracked
      console.log(`[1Forge] Tracking ${activeInstruments.length} active instruments`);
      
      // Ensure we stay within API rate limits by batching requests if needed
      const MAX_SYMBOLS_PER_REQUEST = 20; // 1Forge recommendation
      let symbolBatches: string[] = [];
      
      if (formattedSymbols.split(',').length > MAX_SYMBOLS_PER_REQUEST) {
        // Split into batches to avoid exceeding API limits
        const allSymbols = formattedSymbols.split(',');
        for (let i = 0; i < allSymbols.length; i += MAX_SYMBOLS_PER_REQUEST) {
          symbolBatches.push(allSymbols.slice(i, i + MAX_SYMBOLS_PER_REQUEST).join(','));
        }
        console.log(`[1Forge] Split ${formattedSymbols.split(',').length} symbols into ${symbolBatches.length} batches`);
        
        // Use the first batch for now, other batches will be processed in subsequent calls
        formattedSymbols = symbolBatches[0];
      }
      
      console.log(`[1Forge] Requesting quotes for: ${formattedSymbols.substring(0, 50)}${formattedSymbols.length > 50 ? '...' : ''}`);
      console.log(`[1Forge] API URL: https://api.1forge.com/quotes?pairs=${formattedSymbols.substring(0, 20)}...&api_key=XXXX`);
      
      // Fetch quotes from 1Forge API using properly formatted symbols
      const response = await axios.get(`https://api.1forge.com/quotes?pairs=${formattedSymbols}&api_key=${API_KEY}`);
      
      console.log(`[1Forge] API Response status: ${response.status}`);
      console.log(`[1Forge] API Response type: ${typeof response.data}`);
      console.log(`[1Forge] API Response preview:`, JSON.stringify(response.data).substring(0, 200));
      
      // Handle different response formats from 1Forge API
      let quotesData = response.data;
      
      // If response is an object with error, log it
      if (quotesData && typeof quotesData === 'object' && !Array.isArray(quotesData)) {
        if (quotesData.error || quotesData.message) {
          console.error('[1Forge] API Error:', quotesData.error || quotesData.message);
          return;
        }
        // Maybe the quotes are nested in a property
        if (quotesData.quotes) {
          quotesData = quotesData.quotes;
        }
      }
      
      if (quotesData && Array.isArray(quotesData) && quotesData.length > 0) {
        // Transform the data to our expected format with bid/ask if available
        // 1Forge API uses different field names:
        // p = price, a = ask, b = bid, s = symbol, t = timestamp
        console.log("[1Forge] Raw sample:", JSON.stringify(quotesData[0]));
        
        const transformedData = quotesData.map((quote: any) => {
          // Convert EUR/USD format back to EURUSD for our system
          const formattedSymbol = quote.s ? quote.s.replace('/', '') : 
                                  (quote.symbol ? quote.symbol.replace('/', '') : null);
          
          // Handle different field naming conventions
          const price = quote.p ?? quote.price ?? quote.mid ?? 0;
          const bid = quote.b ?? quote.bid ?? (price * 0.9999);
          const ask = quote.a ?? quote.ask ?? (price * 1.0001);
          const apiTimestamp = typeof quote.t === "number"
            ? quote.t
            : (typeof quote.timestamp === "number" ? quote.timestamp : null);
          // 1Forge API returns timestamps in milliseconds (13 digits)
          // Detect format: if > 10^12, it's already in ms; otherwise it's in seconds
          let lastUpdated: number;
          if (apiTimestamp != null) {
            lastUpdated = apiTimestamp > 1e12 ? apiTimestamp : apiTimestamp * 1000;
          } else {
            lastUpdated = Date.now();
          }
          const timestamp = Math.floor(lastUpdated / 1000);
          
          return {
            symbol: formattedSymbol,
            price: price,
            bid: bid,
            ask: ask,
            timestamp,
            lastUpdated
          };
        }).filter((q: any) => q.symbol && q.price);
        
        console.log(`[1Forge] Successfully fetched ${transformedData.length} real quotes from API`);
        if (transformedData.length > 0) {
          console.log(`[1Forge] First quote sample:`, transformedData[0]);
        }
        
        // ✅ Update the snapshot cache with fresh data for fallback
        updateSnapshotCache(transformedData);
        
        persist(transformedData);
        
        // ✅ Process pending orders and SL/TP through the order engine
        onQuotesUpdated(
          transformedData.map((q: any) => ({
            symbol: q.symbol,
            price: q.price,
            bid: q.bid,
            ask: q.ask,
            isStale: false,
            lastUpdated: typeof q.lastUpdated === "number" ? q.lastUpdated : Date.now()
          }))
        ).catch(err => console.error('[OrderEngine] Error:', err));
      } else {
        console.warn('[1Forge] No valid quotes in API response');
        
        // Use cached fallback data if available
        useFallbackCache();
      }
    } catch (e: any) {
      console.error('[1Forge REST]', e.message || 'Unknown error');
      
      // Check for rate limit errors (429 or message containing "rate" or "limit")
      const isRateLimitError = 
        e.response?.status === 429 || 
        e.message?.toLowerCase().includes('rate') ||
        e.message?.toLowerCase().includes('limit') ||
        e.message?.toLowerCase().includes('exceeded') ||
        e.response?.data?.message?.toLowerCase()?.includes('rate');
      
      if (isRateLimitError) {
        console.warn('[1Forge] Rate limit exceeded - entering backoff mode');
        isRateLimited = true;
        lastRateLimitTime = Date.now();
        // Double the backoff time on each rate limit (up to 5 minutes max)
        rateLimitBackoffMs = Math.min(rateLimitBackoffMs * 2, 300000);
        console.log(`[1Forge] Backoff increased to ${rateLimitBackoffMs / 1000}s`);
      } else {
        // Regular API failure - log it
        console.error('Failed to fetch real price data from 1Forge API');
        if (e.response) {
          console.error('API Response:', e.response.status, e.response.data);
        }
      }
      
      // ✅ Use cached fallback data when API fails (silently, no error to user)
      consecutiveApiFailures++;
      console.log(`[Fallback] API failure #${consecutiveApiFailures}, using cached snapshot data...`);
      useFallbackCache();
    }
  }
}

/* ------------ 4) persist & MTM ------------ */

/**
 * Persist quotes with staleness metadata (used for fallback data)
 */
function persistWithMeta(rows: any[]) {
  let dbClient: BetterSQLite3.Database | null = null;
  
  try {
    dbClient = new BetterSQLite3('./trading_app.db');
    try { dbClient.pragma("busy_timeout = 5000"); } catch {}
    
    // Ensure table has staleness columns
    try {
      dbClient.exec(`ALTER TABLE quotes ADD COLUMN is_stale INTEGER DEFAULT 0`);
    } catch (e) { /* Column may already exist */ }
    try {
      dbClient.exec(`ALTER TABLE quotes ADD COLUMN last_api_update INTEGER`);
    } catch (e) { /* Column may already exist */ }
    
    const stmt = dbClient.prepare(`
      INSERT INTO quotes(symbol, price, bid, ask, updated_at, is_stale, last_api_update)
      VALUES (@symbol, @price, @bid, @ask, datetime('now'), @isStale, @lastUpdated)
      ON CONFLICT(symbol) DO UPDATE SET
        price = excluded.price,
        bid = excluded.bid,
        ask = excluded.ask,
        updated_at = excluded.updated_at,
        is_stale = excluded.is_stale,
        last_api_update = excluded.last_api_update
    `);
    
    const transaction = dbClient.transaction((quotes: any[]) => {
      for (const q of quotes) {
        if (q && q.symbol) {
          stmt.run({
            symbol: q.symbol,
            price: q.price || 0,
            bid: q.bid || null,
            ask: q.ask || null,
            isStale: q.isStale ? 1 : 0,
            lastUpdated: q.lastUpdated || Date.now()
          });
        }
      }
    });
    
    transaction(rows);
    dbClient.close();

    console.log(`[Fallback] Persisted ${rows.length} fallback quotes with staleness metadata`);
    publishLiveEvent({ type: "quotes:updated" });
  } catch (error) {
    console.error('Error persisting fallback quotes:', error);
    if (dbClient) {
      try { dbClient.close(); } catch (e) { /* ignore */ }
    }
  }
}

function persist(rows: any[]) {
  let dbClient: BetterSQLite3.Database | null = null;
  
  try {
    dbClient = new BetterSQLite3('./trading_app.db');
    try { dbClient.pragma("busy_timeout = 5000"); } catch {}
    
    if (dbClient) {
      // Create the quotes table if it doesn't exist with staleness columns
      dbClient.exec(`
        CREATE TABLE IF NOT EXISTS quotes (
          symbol TEXT PRIMARY KEY,
          price REAL NOT NULL,
          bid REAL,
          ask REAL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_stale INTEGER DEFAULT 0,
          last_api_update INTEGER
        )
      `);
      
      // Ensure staleness columns exist (for existing tables)
      try {
        dbClient.exec(`ALTER TABLE quotes ADD COLUMN is_stale INTEGER DEFAULT 0`);
      } catch (e) { /* Column may already exist */ }
      try {
        dbClient.exec(`ALTER TABLE quotes ADD COLUMN last_api_update INTEGER`);
      } catch (e) { /* Column may already exist */ }

      ensureMarketDailyCloseTable(dbClient);
      let rolloverTz = 'America/New_York';
      let rolloverTime = '17:00';
      try {
        const cfg = dbClient
          .prepare(`SELECT fx_rollover_tz AS tz, fx_rollover_time AS time FROM system_config WHERE id = 1`)
          .get() as any;
        if (cfg?.tz) rolloverTz = String(cfg.tz);
        if (cfg?.time) rolloverTime = String(cfg.time);
      } catch {}

      // Only INSERT if no record exists for this session day - do NOT update
      // This preserves the FIRST price captured as the session's baseline
      // The "close" becomes a static reference point for % change calculations
      const dailyCloseStmt = dbClient.prepare(`
        INSERT OR IGNORE INTO market_daily_close (symbol, session_day, close, close_ts_ms)
        VALUES (?, ?, ?, ?)
      `);
      
      // Insert/update statement with staleness tracking (fresh data from API)
      const stmt = dbClient.prepare(`
        INSERT INTO quotes(symbol, price, bid, ask, updated_at, is_stale, last_api_update)
        VALUES (@symbol, @price, @bid, @ask, datetime('now'), 0, @lastApiUpdate)
        ON CONFLICT(symbol) DO UPDATE SET
          price = excluded.price,
          bid = excluded.bid,
          ask = excluded.ask,
          updated_at = excluded.updated_at,
          is_stale = 0,
          last_api_update = excluded.last_api_update
      `);
      
      // Track affected symbols
      const affectedSymbols: string[] = [];
      
      // Start a transaction
      const transaction = dbClient.transaction((quotes: any[]) => {
        for (const q of quotes) {
          if (q && q.symbol) {
            const lastApiUpdate = typeof q.lastUpdated === "number" ? q.lastUpdated : Date.now();
            // Insert/update with staleness tracking (fresh data from API)
            stmt.run({
              symbol: q.symbol,
              price: q.price || 0,
              bid: q.bid || null,
              ask: q.ask || null,
              lastApiUpdate
            });

            try {
              const bid = typeof q.bid === 'number' ? q.bid : null;
              const ask = typeof q.ask === 'number' ? q.ask : null;
              const mid = (bid != null && ask != null)
                ? (bid + ask) / 2
                : (typeof q.price === 'number' ? q.price : null);
              if (Number.isFinite(mid) && mid > 0) {
                const sessionDay = computeSessionDayForQuote(lastApiUpdate, {
                  rolloverTz,
                  rolloverTime,
                });
                dailyCloseStmt.run(q.symbol, sessionDay, mid, lastApiUpdate);
              }
            } catch (e) {
              console.warn('[market_daily_close] upsert failed:', e);
            }
            
            if (!affectedSymbols.includes(q.symbol)) {
              affectedSymbols.push(q.symbol);
            }
          }
        }
      });
      
      // Execute the transaction
      transaction(rows);
      
      // Get users with open trades on these symbols
      try {
        if (affectedSymbols.length > 0) {
          const query = `
            SELECT DISTINCT user_id as userId
            FROM trades 
            WHERE status = 'OPEN'
          `;
          
          let userIds: number[] = [];
          
          // For smaller sets, filter by symbol
          if (affectedSymbols.length < 20) {
            const placeholders = affectedSymbols.map(() => '?').join(',');
            const filteredQuery = `${query} AND symbol_id IN (
              SELECT id FROM symbol_configs WHERE symbol IN (${placeholders})
            )`;
            
            try {
              const userIdsResult = dbClient.prepare(filteredQuery).all(affectedSymbols);
              userIds = userIdsResult.map((r: any) => r.userId);
            } catch (e) {
              console.error("Error querying filtered users:", e);
              // Fallback to getting all users with open trades
              const userIdsResult = dbClient.prepare(query).all();
              userIds = userIdsResult.map((r: any) => r.userId);
            }
          } else {
            // For larger sets, just get all users with open trades
            const userIdsResult = dbClient.prepare(query).all();
            userIds = userIdsResult.map((r: any) => r.userId);
          }
          
          dbClient.close();
          dbClient = null;
          
          // Update the dynamic set with symbols that have open positions
          refreshDynamicSet();
          
          // Recalculate margin for affected users
          userIds.forEach((userId: number) => {
            try {
              void recalcAccount(userId, { emit: true, reason: "QUOTE_TICK" });
            } catch (error) {
              console.error(`Error recalculating account ${userId}:`, error);
            }
          });
        } else {
          dbClient.close();
          dbClient = null;
        }
      } catch (error) {
        console.error('Error processing account updates:', error);
        if (dbClient) {
          dbClient.close();
          dbClient = null;
        }
      }
    }
    if (rows.length > 0) {
      publishLiveEvent({ type: "quotes:updated" });
    }
  } catch (error) {
    console.error('Error persisting quotes:', error);
    if (dbClient) {
      try {
        dbClient.close();
      } catch (e) {
        // Ignore errors closing
      }
    }
  }
}

/* ------------ 5) timer (dynamic interval) ------------ */
/**
 * Schedules the next poll using current dynamic config
 * Uses recursive setTimeout so interval can change on-the-fly
 */
function schedulePoll() {
  pollTimerId = setTimeout(async () => {
    await throttle(pullBatch)();
    schedulePoll(); // Schedule next with current config interval
  }, dynamicConfig.pollIntervalMs);
}

// Start the polling loop
pullBatch(); // first run immediately
schedulePoll(); // then schedule subsequent polls

/* ------------ 6) update dynamic set ------------ */
function refreshDynamicSet() {
  try {
    const dbClient = new BetterSQLite3('./trading_app.db');
    try { dbClient.pragma("busy_timeout = 5000"); } catch {}
    
    // Check if the trades table exists and has the right schema
    const tableInfo = dbClient.prepare("PRAGMA table_info(trades)").all();
    const hasSymbolId = tableInfo.some((col: any) => col.name === 'symbolId');
    
    // Get all symbols with open trades (handle both schema versions)
    let symbols;
    if (hasSymbolId) {
      symbols = dbClient.prepare(`
        SELECT DISTINCT sc.symbol 
        FROM trades t
        JOIN symbol_configs sc ON t.symbolId = sc.id
        WHERE t.status = 'OPEN'
      `).all().map((r: any) => r.symbol);
    } else {
      // Fallback - just get all configured symbols
      symbols = dbClient.prepare(`
        SELECT DISTINCT symbol FROM symbol_configs
      `).all().map((r: any) => r.symbol);
    }
    
    dbClient.close();
    
    // Update the dynamic set
    dynamicSet = new Set(symbols);
    if (symbols.length > 0) {
      console.log(`Dynamic symbol set updated: ${[...dynamicSet].join(', ')}`);
    } else {
      console.log('Dynamic symbol set is empty, using default symbols');
    }
  } catch (error) {
    console.error('Error refreshing dynamic symbol set:', error);
    // Fallback to a minimal set of common symbols if we can't get from DB
    dynamicSet = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']);
  }
}

// Generate simulated data with realistic bid/ask spreads
function generateSimulatedQuotes(symbols: string[]) {
  // Base prices for common forex pairs (when API is unavailable)
  const basePrices: Record<string, number> = {
    'EURUSD': 1.09421,
    'USDJPY': 144.87,
    'GBPUSD': 1.27152,
    'AUDUSD': 0.65321,
    'USDCAD': 1.35982,
    'NZDUSD': 0.61024,
    'USDCHF': 0.89758,
    'EURGBP': 0.85982,
    'EURJPY': 158.524,
    'GBPJPY': 184.213
  };
  
  return symbols.map(symbol => {
    // Get base price or generate a random one if not in our base list
    const basePrice = basePrices[symbol] || (Math.random() * 100);
    
    // Create small random price movement (±0.05%)
    const priceChange = basePrice * (Math.random() * 0.001 - 0.0005);
    const price = basePrice + priceChange;
    
    // Generate realistic bid/ask with 2 pip spread
    const spread = symbol.includes('JPY') ? 0.02 : 0.0002; // JPY pairs have different pip values
    const halfSpread = spread / 2;
    
    return {
      symbol,
      price,
      bid: price - halfSpread,
      ask: price + halfSpread,
      timestamp: Math.floor(Date.now() / 1000)
    };
  });
}

// Initialize by refreshing dynamic set
refreshDynamicSet();

// Export the module
export default { pullBatch };
// @ts-nocheck
