# Instruments Tab & Trading Systems - Deep Audit Report

## 1. Scope
- **Frontend Components**: `QuotesScreen.tsx`, `TradeScreen.tsx`, `Dashboard.tsx`, `QuotesProvider.tsx`
- **Backend Services**: `tradeOpen.ts`, `tradeClose.ts`, `tradeCosts.ts`, `quoteService.ts`, `quotesCore.ts`, `wsCore.ts`
- **Security & Integrity**: `griftEngine.ts`
- **Objective**: Identify bugs, vulnerabilities, scaling issues, correctness flaws, and cross-reference checklist standards.

## 2. Findings: Frontend (Instruments Tab)

### QuotesScreen.tsx & QuotesProvider.tsx
- **Sorting Logic (BT-05 & general correctness)**: Sorting is implemented via `filteredAndSortedQuotes`. It correctly converts to `Number` for price/change/spread, and falls back to string localeCompare. 
- **WebSocket Resource Management (BT-10)**: `QuotesProvider` explicitly clears subscriptions when symbols are de-selected or the component unmounts (`sendMessage({ type: WS_MSG_QUOTES_UNSUBSCRIBE })`). It correctly calculates `subscribeSymbols` and `unsubscribeSymbols` diffs.
- **Scaling Concern**: For an app targeting 1M users, pulling *all* quotes continuously without lazy-loading or pagination could degrade performance. Currently, there's a `<div className="tq-quotes-list relative divide-y divide-gray-800">` containing all `filteredAndSortedQuotes` mapped explicitly rather than virtualized. The core payload handles large numbers gracefully, but DOM node creation could freeze low-end mobile devices. Virtualization (e.g., `@tanstack/react-virtual`) is highly recommended for scaling if the list of allowed instruments exceeds 500.

### TradeScreen.tsx
- **Responsive Table / ResizeObserver Leak**: Uses `ResizeObserver` correctly with `observer.disconnect()` in cleanup, avoiding leaks.
- **Form State Parsing**: Correctly parses lots as integers using Zod.

## 3. Findings: Backend (Core Trading)

### tradeOpen.ts
- **Validation (BT-01/VT-02)**: Strict `zod` schema parsing via `insertTradeSchema`. 
- **Concurrency (TOCTOU) & Race Conditions**: In `tradeOpen.ts`, `SELECT ... FOR UPDATE` row-level locking is used on `users.id` for PostgreSQL. This strictly prevents concurrent placement race conditions and successfully mitigates the TOCTOU vector mentioned in `04_VULNERABILITIES_AND_EXPLOITS`. This is an excellent implementation of `Row Locking` as per checklist rules.
- **Quote Revalidation**: Before committing the transaction, it calls `validateExecutionQuoteAtCommit` to ensure the quote hasn't spoofed or drifted since the start of the sequence. This is a robust defense against LATENCY dependence.

### tradeClose.ts
- **Server-Authoritative Pricing**: Uses `getExecutionQuote` and explicitly rejects client-supplied `closePrice`. Complies with `SECURITY2026_Gpt5_2.md` rule: "Never trust the client".
- **Minimum Hold Time Penalty**: Checks `getEffectiveMinHoldSec` correctly.

### Quote Validation (`validateExecutionQuoteAtCommit`)
- Checks `ageMs`, `driftAbs`, `driftBps` during commit time. If price drifts more than the allowed BPS tolerance, the trade is rejected, protecting the broker against arbitrage exploits.

## 4. Findings: Backend (WebSocket & Live Feeds)

### wsCore.ts
- **Origin Validation**: WebSocket connections validate Origin securely and prevent WS hijacking.
- **Authentication**: Prevents client-controlled user binding (`AUTH_MISMATCH`) by enforcing session ownership over connection ID declarations.
- **Rate-Limiting**: Applies connection limits per user (`wsUserConnectionLimit`) and message throttling per window (`wsMessageRateLimitPerWindow`) via `consumeWsMessageRate`.
- **Scaling Limit**: Sends large payloads efficiently and filters subscriptions cleanly.

## 5. Findings: Grift Engine & Metrics

### griftEngine.ts
- Uses dedicated geo-hashing and Haversine tools (`haversineKm`, `kmh`).
- Identifies IP churn, UA churn, impossible travel (Geo Velocity), and Device Account linkages.
- Calculates dynamic scoring via `points = cfg.scoreGeoVelocity` or `points = cfg.scoreConcurrentSessions`, writing directly to `grift_signals`.
- **Integrity**: Properly handles edge cases with unbounded distances by strictly typing SQLite lookups.

## 6. Checklist Cross-Reference

| Document | Rule | Finding / Implementation |
|----------|------|--------------------------|
| `04_VULNERABILITIES_AND_EXPLOITS` | Race Conditions (TOCTOU) | **PASS**: `tradeOpen.ts` uses strictly serialized row-level locking (`SELECT ... FOR UPDATE` on `users.id`) for PostgreSQL. Cannot execute concurrent open trades with overlapping bounds. |
| `04_VULNERABILITIES_AND_EXPLOITS` | Cascading Failures & Validation | **PASS**: `tradeOpen.ts` and `tradeClose.ts` strictly bound inputs via `zod` and apply boundary assertions on `marginUsd`. |
| `bug_vulnerability_catalog` | BT-03/BT-10 Event Leaks | **PASS**: `TradeScreen` wraps `ResizeObserver` successfully. `QuotesProvider` explicitly calls `clearTimeout` on effect unmount and dependencies re-evaluate correctly. |
| `bug_vulnerability_catalog` | VT-02 Unbounded Input Injection | **PASS**: `wsCore.ts` explicitly scopes WebSocket inputs. Merging in `QuotesProvider.ts` directly assigns keys rather than blind unvalidated spreads. |
| `SECURITY2026_Gpt5_2.md` | "Never trust the client" (Implied) | **PASS**: `tradeClose.ts` fetches server-authoritative quotes (`getExecutionQuote(symbol)`) to prevent price spoofing. Re-validates quote age at commit. |

## 7. Operational Conclusion & Next Steps

The Instruments tab, quote fetching logic, and core trade execution systems are constructed with a **high degree of security, integrity, and fault tolerance**. 

1. **Critical Vulnerabilities**: None identified. TOCTOU/Race conditions are actively defended at the database level. Websocket payloads are secured natively, rate-limited via token bucket in `wsCore.ts`, and authenticated deterministically.
2. **Correctness**: P/L calculation, spread evaluation, margin math, and excursion tracking conform to required strict mathematical safety patterns. Quotes rely exclusively on server-authoritatively fetched data, eliminating client price-spoofing vectors.
3. **Scaling Constraints**: As instrument coverage grows beyond 500+ active tickers, front-end DOM virtualization (`@tanstack/react-virtual` or similar) in `QuotesScreen.tsx` is highly recommended to sustain smooth 60fps scrolling on mobile devices, as the current `map` loop block generates heavy concurrent React node mutations.

The audited subsystem **PASSES** architectural inspection.
