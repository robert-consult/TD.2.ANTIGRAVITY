# Deep Audit Report: Trader Search & Provider System Implementation

> [!IMPORTANT]
> **Audit Action**: Analysis of uncommitted changes and implementation gaps.
> **Date**: 2026-02-03
> **Scope**: Trader Search (Scouting) and Market Data Provider System.

## 1. Executive Summary

A deep audit of the uncommitted changes connected to the Trader Search and Provider System reveals a solid foundational implementation but highlights several critical logic gaps, performance risks, and reliability concerns.

**Key Findings:**
*   **Critical Logic Flaw (Trader Search):** The "Profit Factor" calculation excludes "perfect" traders (0 losses) from filtered results because division by zero results in `NULL`, which fails numeric value checks.
*   **Performance Risk (Trader Search):** The Search SQL query performs expensive window functions (for Drawdown calculation) on a large dataset before applying key volume filters, potentially causing timeouts under load.
*   **Brittleness (Provider System):** Symbol mapping relies on naive string manipulation (stripping slashes) which may cause collisions or failures for non-standard assets (Crypto/Stocks).
*   **Operational Risk:** No rate limiting handles are implemented in the provider drivers, risking API quota exhaustion.

---

## 2. Trader Search System Audit

### Overview of Changes
*   **Schema**: Added `0014_trader_scouting_indexes.sql` to index `trades(closed_at)`.
*   **API**: Implemented `/api/admin/trader-scouting/search` with a complex CTE-based SQL query.
*   **UI**: Added `TraderSearchTab` with extensive filtering capabilities.

### Detailed Findings

#### [Critical] Profit Factor Logic Failure
**Location**: `server/routes/admin.ts` (CTE `candidates`)
**The Issue**: The profit factor is calculated as `gross_profit / NULLIF(ABS(gross_loss), 0)`.
**Impact**: If a trader has **no losses** (`gross_loss = 0`), the result is `NULL`. The search filter `($11::float IS NULL OR a.profit_factor >= $11::float)` will likely evaluate `NULL >= 1.5` as `FALSE` (depending on SQL dialect nuances, usually NULL comparisons yield NULL/False).
**Result**: The *best* performing traders (100% win rate) may be **hidden** from search results when a minimum profit factor is set.

#### [Performance] Inefficient Filtering Pipeline
**Location**: `server/routes/admin.ts` (SQL Query)
**The Issue**:
1.  The query selects **ALL** closed trades for the time period in CTE `ft`.
2.  It calculates complex aggregates in `agg`.
3.  **Then** it filters by `minTrades` in `candidates`.
**Impact**: The database must process thousands of trades for "casual" users (with 1 or 2 trades) only to discard them later.
**Recommendation**: Move the `minTrades` filter condition earlier or use a summary table strategy.

#### [Performance] Expensive Window Functions
**Location**: `server/routes/admin.ts` (CTE `equity` & `equity2`)
**The Issue**: Max Drawdown calculation uses `SUM(...) OVER (PARTITION BY user_id ORDER BY closed_at)` to reconstruct the equity curve for *every candidate* dynamically.
**Impact**: On a database with 100k+ trades, this query will likely time out or lock rows excessively during high-usage periods.

#### [Integrity] Category Mismatches
**Location**: `TRADER_SEARCH_CATEGORIES` vs Database Data
**The Issue**: The code normalizes categories (e.g., "FX" -> "forex"), but the database `symbol_configs.category` is populated from providers. If a provider introduces "indices-cfd" or "crypto-spot", the hardcoded mapping in `admin.ts` (`normalizeCategory`) and the frontend `CATEGORY_CHOICES` will fail to match them, rendering them unsearchable.

---

## 3. Provider System Audit

### Overview of Changes
*   **Schema**: Added `market_data_providers` table and updated `system_config`.
*   **Admin API**: Full CRUD for providers, plus "activate" and "test" endpoints.
*   **Drivers**: Implemented `TwelveData`, `OneForge`, and `GenericRestV1`.

### Detailed Findings

#### [Reliability] Naive Symbol Mapping
**Location**: `server/marketdata/providers/*.ts`
**The Issue**: All drivers use a variation of `symbol.replace("/", "").trim().toUpperCase()` to normalize symbols.
**Impact**:
*   **Collisions**: `BTC/USD` and `BTCUSD` are treated identically. While often desired, this can cause issues if a provider supports `BTC.d` or other variants.
*   **Loss of Fidelity**: Some API providers might differentiate between `BRK.B` (Berkshire) and `BRK/B` or `BRK-B`. The current logic forces a specific format that may not align with all upstream providers.

#### [Security/Ops] Runtime Secret Dependency
**Location**: `server/marketdata/secret.ts`
**The Issue**: Secrets are stored as `env:KEY_NAME` and resolved via `process.env`.
**Impact**: If the application restarts and the environment variables are not correctly propagated (e.g., in a containerized environment where env vars are injected at build time vs run time), the providers will fail silently until a request is made. There is no startup health check to verify *all* active providers have their required secrets available.

#### [Stability] Lack of Rate Limiting
**Location**: `server/marketdata/providers/*`
**The Issue**: The drivers make direct `axios` calls (`axios.get`) without any rate limiting wrapper (e.g., Bottleneck).
**Impact**: If the "Test" button is spammed in the UI, or if the `trader-scouting` drilldown (which might trigger price fetches if expanded to show live data) hits the API, the system could easily exceed the provider's rate limits (e.g., TwelveData's free tier is strict). This would cause cascading failures.

#### [Data Integrity] Generic Driver Validation
**Location**: `server/marketdata/providers/genericRestV1.ts`
**The Issue**: The Generic driver allows defining JSON paths (e.g., `responseMode`, `wrapperKey`).
**Impact**: There is no validation that the configured paths *actually match* the provider's response structure during the "Save" or "Test" phase beyond a simple "Test" button click. Implementers setting up a new generic provider might struggle with silent failures if the JSON path is slightly off (e.g., `data.result` vs `result`).

---

## 4. Recommendations Breakdown

### Immediate Fixes (Logic)
1.  **Fix Profit Factor**: Update the SQL to handle 0 loss.
    ```sql
    CASE WHEN ABS(gross_loss) < 0.0001 THEN 999.0 ELSE gross_profit / ABS(gross_loss) END
    ```
    *(Or use `NULL` but ensure the filter handles `OR profit_factor IS NULL` for profitable traders).*

### Performance Optimizations
1.  **Materialized View**: For Trader Search, `vw_trader_stats` should likely be a materialized view refreshed periodically (e.g., hourly) rather than a live complex query with window functions.
2.  **Pre-Aggregate**: Create a `daily_trader_stats` table to simplify the "Best Day" and "Drawdown" calculations.

### Reliability Enhancements
1.  **Rate Limiter**: Wrap provider fetch calls in a rate-limited queue (shared/singleton per provider key).
2.  **Health Check**: Add a startup routine that verifies all `env:` references in `market_data_providers` actually exist in `process.env` and logs a warning if missing.

### Architecture Improvements
1.  **Robust Symbol Map**: Move away from `replace("/", "")`. Store an explicit `provider_symbol_map` JSON in `symbol_configs` (which is partially there) but rely on *that* more heavily than on-the-fly string maniupulation.
