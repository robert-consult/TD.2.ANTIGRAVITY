# Trade Action Audit Report

**Date:** 2026-02-02
**Subject:** Investigation of Trade Close/Edit Propagation, Stale Price Handling, and Market Closed Logic

## 1. Executive Summary

A deep audit of the codebase was conducted to investigate how manually closing and editing trades handles stale prices and market closed states.

**Key Findings:**
- **Market Closed (Close Trade):** Correctly enforced. The system blocks manual closes if the market is closed.
- **Stale Prices (Close Trade):** **Current implementation contradicts requirements.** The system detects stale prices but explicitly *allows* the close to proceed after logging a warning, instead of waiting for a live price.
- **Edit Trade (SL/TP):** Appears to lack validation against current market prices and market status. Edits to Stop Loss and Take Profit levels do not trigger a check for market open/closed status, nor do they validate the new levels against the current (potentially stale) price.
- **Risk Propagation:** `riskMiddleware` efficiently protects *opening* trades, but manual *modify* actions bypass the strict "block on stale" logic to prioritize user control, which leads to the identified discrepancy.

## 2. Detailed Investigation Findings

### 2.1. Close Trade Logic
**Location:** `server/routes.ts` (Handler for `POST /api/trades/:id/close`)

*   **Market Closed Check:** ✅ **Verified.**
    The system correctly calls `getExecutionQuote(..., "CLOSE")` and checks `if (!q.marketOpen)`. If the market is closed, it returns a `409 Conflict` error with the message "Market is closed. Try again when market re-opens."

*   **Stale Price Handling:** ⚠️ **Issue Identified.**
    The user requirement states: *"close trades should wait until live prices are available to close"*.
    The current implementation does the following:
    ```typescript
    // Warn but allow stale quotes for manual closes (user explicitly requested close)
    if (q.isStale) {
      console.warn(`Manual close with stale quote: ...`);
    }
    ```
    The system explicitly detects the stale quote (`q.isStale`) but chooses to **proceed** with the execution using the stale price. There is no mechanism to "wait" or queue the request until a fresh price arrives.

*   **Propagation:**
    *   The trade status is updated to `CLOSED`.
    *   Realized P/L is calculated based on the *stale* execution price.
    *   Balance is immediately updated.
    *   `trades:updated` event is broadcast to all clients.

### 2.2. Edit Trade Logic (SL/TP)
**Location:** `server/routes.ts` (Handler for `PATCH /api/trades/:id/targets`)

*   **Market Closed / Stale Price Checks:** ❌ **Missing.**
    The handler updates the trade's `takeProfit` and `stopLoss` columns directly after verifying ownership.
    *   It attempts to fetch a quote (`getExecutionQuote`) *only for audit logging purposes*.
    *   This fetch is wrapped in a `try/catch` block that suppresses errors.
    *   There is no blocking check for `marketOpen` or `isStale`.
    *   **Implication:** A user can edit SL/TP levels while the market is closed or when prices are stale. This is often desired behavior (features allowing off-hours management), but it means no validation ensures the new SL/TP isn't already "hit" by the (unknown) current market price.

*   **Validation:** ❌ **Missing.**
    Unlike the Open Trade logic, which validates that Limit/Stop orders are at least 10 pips away from the current price, the manual Edit handler does *not* appear to enforce distance validation against the current price.

### 2.3. Risk System Database & Algorithm
**Location:** `server/risk.ts`, `server/engine/orderEngine.ts`, `server/services/quoteService.ts`

*   **Risk Middleware:**
    The `riskMiddleware` is applied to `POST /api/trades` (Open) and strictly blocks opening trades if quotes are stale (`blockOpenOnStaleQuotes` config). This protection is **not** applied to Close or Edit routes.

*   **Order Engine:**
    The `orderEngine` runs in the background to process Pending Orders and SL/TP triggers. It uses `processStopsForOpenTrades` which consumes quotes. If quotes are stale (not emitted), the engine simply doesn't process triggers. This effectively "waits" for live prices for *automated* closures, which aligns with requirements. The issue is isolated to *manual* actions.

## 3. Propagation Analysis

| Action | Stale Price Behavior | Market Closed Behavior | Live Price Wait? |
| :--- | :--- | :--- | :--- |
| **Open Trade** | **Blocked** (409 Quote Stale) | **Blocked** (403 Market Closed) | No (Immediate Failure) |
| **Close Trade** | **Allowed** (Warns only) | **Blocked** (409 Market Closed) | **No** (Executes on Stale) |
| **Edit Trade** | **Allowed** (Ignored) | **Allowed** (Ignored) | No |
| **Auto-SL/TP** | **Waits** (Engine loop) | **Waits** (Engine loop) | **Yes** (Inherently) |

## 4. Recommendations for Remediation (Code Changes Required)

To align with the user request *"close trades should wait until live prices are available"*:

1.  **Modify Manual Close (`POST /api/trades/:id/close`):**
    *   Change the `if (q.isStale)` block to return an error (e.g., `409 Conflict`) instead of a warning, matching the *Open Trade* behavior.
    *   **Implementation of "Wait":** Since HTTP is request/response, the backend cannot easily "wait" indefinitely in a single request without timing out. The standard pattern is:
        *   **Frontend:** The UI should receive the `409 Quote Stale` error and show a "Waiting for price..." spinner.
        *   **Frontend Check:** The UI should listen for `price:update` events via WebSocket. Once a fresh price arrives, it should automatically retry the Close request.
    *   **Alternative Backend "Wait":** Implement a polling mechanism inside the route handler that loops for a short duration (e.g., 5 seconds) checking for a fresh price before failing.

2.  **Modify Edit Trade (`PATCH /api/trades/:id/targets`):**
    *   Add `getExecutionQuote` validation to ensure the new SL/TP respects minimum distance rules against the *current* (or last known valid) price.
    *   Decide if edits should be allowed during Market Closed (usually yes, but standard industry practice differs). If strict validation is required, edits during market close should be blocked.

## 5. Conclusion
The current implementation successfully protects against actions during market closures (for Close) but fails to enforce "Live Price Only" for manual closures, creating a risk where trades are executed at stale prices. The Edit logic is permissive and lacks validation against market conditions.
