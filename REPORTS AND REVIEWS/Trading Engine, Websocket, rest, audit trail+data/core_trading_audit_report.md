# Core Trading & Infrastructure Security Audit Report

## Executive Summary
This report details the findings from a deep architecture and security audit of the Core Trading Engine, Trade APIs, Risk Management, Data Processing Layers, and the Trade Audit Trail for the TradeQuip platform. 

The audit focused on identifying race conditions, transaction integrity, logical flaws, bypass vulnerabilities, and systemic risks. While the execution and transactional integrity of the trading core are extraordinarily robust and hedge-fund grade, the risk engine and evaluation systems suffer from a pervasive and critical architectural flaw regarding floating ("Unrealized") PnL.

---

## 1. Critical Finding: Pervasive Ignorance of Floating (Open) PnL
The most severe vulnerability discovered during this audit represents a complete bypass of the platform's risk management, challenge evaluation, and margin systems. 

Across multiple isolated systems, the codebase *explicitly excludes* floating (unrealized) profit and loss from open positions when enforcing risk limits. A malicious or reckless trader can exploit this to pass challenges, rank on leaderboards, and avoid margin calls indefinitely.

### 1.1 Complete Absence of Margin Call / Stop Out Engine
- **Finding:** While `server/recalcAccount.ts` correctly calculates `floatingPnl`, `equity`, and `marginLevel`, **there is no mechanism that acts on this data to liquidate positions**.
- **Impact:** An account can drop below 0% margin level, going deeply into negative equity. The database will reflect this, but the trades will remain open indefinitely until the user manually closes them or they hit the multi-day `maxHoldTime` via `autoClose.ts`.
- **Evidence:** Codebase-wide grep for `MARGIN_STOP_OUT` (the defined close reason) yields no active usage. No cron jobs or services actively poll for and liquidate accounts under margin call thresholds.

### 1.2 Bypass of Global Daily & Lifetime Loss Limits
- **Finding:** In `server/risk.ts`, the `riskMiddleware` enforces `maxDailyLossRaw` and `maxLifetimeLossRaw`. However, the SQL query explicitly filters `AND status = 'CLOSED'`.
- **Impact:** A live trader can open a position, let it float to a -$1,000,000 loss, and the system will never freeze their account or stop them from opening *new* trades, because their *closed* losses are $0.

### 1.3 Exploit in Scout Challenge Evaluations
- **Finding:** In `server/recruitment/challengesV4/challengeEvaluation.ts`, `computePhaseStats` is responsible for evaluating user performance against Challenge Max Daily Loss and Total Drawdown limits. It uses this SQL: `WHERE tr.user_id = ${userId} AND tr.status = 'CLOSED'`.
- **Impact:** A challenge participant can open massive, highly leveraged, reckless trades. If the trade goes into a 90% drawdown, the evaluation engine ignores it. If it eventually bounces back, they close it for a profit and pass the challenge with a "0% drawdown" record.

### 1.4 Exploit in Partner Capital Drawdown Limits (`shadowStopPct`)
- **Finding:** In `server/recruitment/engines.ts` (`syncPartnerAllocationsPass`), the system checks if funded traders have breached their max drawdown limit (`shadowStopPct`). It relies on `computeAllocationPnlUsd`, which strictly filters `AND t.status = 'CLOSED'`.
- **Impact:** A funded trader can blow the firm's capital by holding a massive losing position, and the partner firm's `shadowStopPct` protection will silently fail to trigger.

---

## 2. Strengths & Robust Architecture (What Working Well)
Despite the floating PnL vulnerability, the underlying transactional and execution architecture is exceptionably well-designed.

*   **Flawless Transaction Integrity (No Double-Spends/Race Conditions):** 
    *   `server/engine/orderEngine.ts` and `server/routes/traderCore.ts` utilize strict, `FOR UPDATE` row-level locks within `db.transaction()` blocks. 
    *   Margin reservation (`reserveUserMargin`) and balance deltas are atomic. It is logically impossible to execute a double-spend or race condition on trade closures.
*   **Hedge-Fund Grade Audit Trail:** 
    *   `writeTradeAudit` provides exhaustive provenance, logging execution IDs, correlation IDs, spread, slippage points, bid/ask quotes, latency, and system context parameters.
    *   `server/cron/tradeAuditVerification.ts` acts as an aggressive anomaly detection system, validating the cryptographic hash chain of the audit trail via `verifyTradeAuditChain`. If a mismatch is found, it can `Fail Fast` and halt the process.
*   **Strict State Machine Enforcement:** 
    *   `server/routes/trader/tradeCancel.ts` and `tradeClose.ts` strictly enforce the state machine. A `PENDING` order cannot be manually closed, and an `OPEN` order cannot be cancelled. 
*   **Decoupled Async Grift Detection:** 
    *   Anti-fraud tools (Geo/IP/Device tracking) are decoupled gracefully via `extractGriftContext` and `onSessionActivity`, ensuring they do not block core latency-sensitive execution paths.
*   **Stale Quote Protection:** 
    *   Manual closes and limit triggers actively reject execution utilizing stale pricing, ensuring the platform isn't exploited by latency arbitrage.

---

## 3. Secondary Observations & Optimizations

### 3.1 Potential Bottleneck: In-Memory Excursion Tracking
- **Observation:** `server/trades/excursionTracking.ts` relies on an in-memory `Map<number, TradeExcursionTracker>` to track Intraday Highs (MFE) and Intraday Lows (MAE) per trade.
- **Risk:** In-memory maps on a single Node instance will not scale horizontally across multiple stateless Kubernetes pods or load-balanced servers. Excursion data will be fragmented across processes, or worse, lost upon server restarts.
- **Recommendation:** Shift MAE/MFE tracking to a clustered fast-store like Valkey/Redis, or write periodic snapshots to the PostgreSQL `trades` table.

### 3.2 Quote Latency Dependency
- **Observation:** The execution engine relies on fetching real-time quotes during the transaction block (`getExecutionQuote`). 
- **Risk:** If the quote provider (1Forge/Polygon API) spikes in latency, it forces the database transaction to stay open longer, holding the `FOR UPDATE` lock on the `users` row. This could cause transaction queuing and degraded performance under heavy load.
- **Recommendation:** Fetch the quote *before* opening the database transaction, then validate its freshness *inside* the transaction against a rapidly-updating local cache (like Valkey).

## Conclusion
The core infrastructure of the trading engine is structurally sound, secure against classic web vulnerabilities (IDOR, Race Conditions, SQLi), and features top-tier auditing. However, the systemic failure to account for Floating PnL across Risk, Leaderboards, Margin Calls, and Challenge Evaluations represents a critical business and security risk that must be addressed immediately via a unified Margin Call / Equity Evaluation service.
