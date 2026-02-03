# Trade Propagation and History Audit Report

## Executive Summary

A deep audit of the trade architecture was conducted, focusing on the propagation of trade actions (execution, closure) and the recording of trade history.

**Status**: **CRITICAL ISSUES FOUND**
The current implementation of the "Order Engine" (`server/engine/orderEngine.ts`) contains fundamental flaws in how financial state (User Balance, Margin) is propagated. These flaws will lead to **financial discrepancies, lost P&L updates, and risk limit breaches** under concurrent load or simple race conditions.

## Component Analysis

### 1. Database Schema (`shared/schema.pg.ts`)
- **Status**: **Robust**
- **Findings**: The schema is well-designed.
    - `trades`: Tracks trade lifecycle (`PENDING`, `OPEN`, `CLOSED`) with appropriate timestamps.
    - `trade_audit`: An institutional-grade audit table is present, capturing granular events (`ORDER_FILLED`, `ORDER_REJECTED`, `SL_TRIGGERED`) with full context (pricing, snapshots).
    - `users`: Stores `balance`, `equity`, `used_margin`.
- **Note**: The schema supports correct implementation, but the application logic does not properly utilize transactional safety.

### 2. Order Engine (`server/engine/orderEngine.ts`)
- **Status**: **CRITICAL**
- **Purpose**: Processes `PENDING` orders and monitors open positions for SL/TP triggers.
- **Findings**:
    - **Architecture**: Singleton polling loop (`running` flag per process).
    - **Logic**: Iterates over trades and processes them sequentially *logic-wise*, but performs database persists asynchronously without transactions.

## Critical Findings

### 1. Non-Atomic Balance Propagation (The "Lost Update" Bug)
**Location**: `server/engine/orderEngine.ts` (Function: `processStopsForOpenTrades`)
**Severity**: **CRITICAL**

When a trade is closed (e.g., Stop Loss hit), the system calculates the new balance and updates the user record *directly*, separate from the trade update.

```typescript
// Current Implementation Pattern
const u = r.u; // Fetched at start of loop (STALE!)
// ... calculate profit ...
const newBalance = (Number(u.balance) + Number(profit)).toFixed(2);
await db.update(users).set({ balance: newBalance }).where(eq(users.id, u.id));
```

**The Vulnerability**:
If a user has multiple open trades on the same symbol (e.g., 2 Buy positions on EURUSD) and the price drops, triggering SL for both:
1.  **Loop Start**: Fetches User Balance = $10,000.
2.  **Trade A Actions**:
    - Calculates Loss = -$100.
    - Updates User Balance = $9,900.
3.  **Trade B Actions** (in same loop iteration):
    - Uses *original* User Balance = $10,000 (from `u`).
    - Calculates Loss = -$100.
    - Updates User Balance = $9,900.
4.  **Result**: User Balance is $9,900. **Actual Balance should be $9,800.**
5.  **Impact**: The P&L from Trade A is effectively erased from the user's balance.

### 2. Stale Margin Checks (Risk Limit Breach)
**Location**: `server/engine/orderEngine.ts` (Function: `processPendingForSymbol`)
**Severity**: **HIGH**

When processing pending orders, the engine checks `freeMargin` to ensure the user can afford the trade.

```typescript
// Current Implementation Pattern
const freeMargin = Number(u.freeMargin ?? 0); // Fetched at start of loop (STALE!)
if (freeMargin < neededMargin) {
  // ... reject ...
}
```

**The Vulnerability**:
If a user submits 5 pending orders and only has margin for 1:
1.  **Loop Start**: Fetches `u.freeMargin` = $1,000.
2.  **Order 1**: Needs $1,000. Check passes ($1,000 >= $1,000). Order Fills.
3.  **Order 2**: Needs $1,000. Check passes (still sees $1,000). Order Fills.
4.  **Result**: User opens $2,000 worth of margin positions with only $1,000 equity.
5.  **Impact**: User enters negative margin / immediate liquidation cascade.

### 3. Missing Transaction Boundaries
**Location**: Throughout `orderEngine.ts`
**Severity**: **HIGH**

Operations that must be atomic are split into multiple DB calls:
1.  Update `trades` table (Status = CLOSED/OPEN).
2.  Update `users` table (Balance/Margin).
3.  Insert `trade_audit` record.

If the server crashes or DB fails between step 1 and 2:
- Trade is CLOSED.
- Balance is NOT UPDATED.
- Money is lost/gained in limbo.

## Recommendations (No Code Edits Performed)

To fix these issues, the following architectural changes are required:

1.  **Implement Database Transactions**:
    - Wrap the entire Trade Close + Balance Update sequence in a transaction (`db.transaction(...)`).
    - Propagate the transaction object (`tx`) to all update calls.

2.  **Atomic Balance Updates**:
    - Never calculate new balance in application memory based on a read.
    - Use SQL atomic increments: `UPDATE users SET balance = balance + ${profit} WHERE id = ...`.

3.  **Row Locking (Select for Update)**:
    - When checking margin for pending orders, lock the user record: `SELECT * FROM users WHERE id = ? FOR UPDATE`.
    - This ensures Order 2 waits for Order 1 to release the lock and commit its margin usage.

4.  **Centralized Balance/Margin Manager**:
    - Move balance/margin logic out of the loop and into a dedicated service that guarantees atomicity.

## Trade History Audit

The **Trade History** propagation itself (the audit trail) appears robust.
- The `trade_audit` table captures `quoteTs`, `quoteSource`, `fillPrice`, `slippage`, `riskResult`, etc.
- This provides excellent forensic capability *if* the data makes it to the DB.
- However, the *financial impact* of that history (the User Balance) is what is compromised by the engine's implementation.
