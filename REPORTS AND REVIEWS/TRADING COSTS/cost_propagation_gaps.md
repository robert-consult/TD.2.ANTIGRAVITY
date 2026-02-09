# Cost Propagation Gaps Report

**Date:** 2026-02-08 | **Scope:** Trade costs → History, Analytics, Audit Trails

---

## Summary

| Area | Status | Gap Description |
|------|--------|-----------------|
| **Trades Table** | ✅ | 10 cost columns fully populated |
| **Trade Close (Engine)** | ✅ | All costs calculated and stored |
| **Trade Close (Routes)** | ✅ | All costs calculated and stored |
| **Auto-Close Cron** | ✅ | All costs calculated and stored |
| **recalcAccount** | ✅ | Includes carry costs in floating P/L |
| **Client History** | ✅ | Uses `netProfitUsd` |
| **Leaderboard** | 🔴 GAP | Uses legacy `profit` column |
| **trade_audit** | 🟡 GAP | No cost columns |
| **storage.closeTrade()** | 🔴 GAP | Doesn't update cost fields |

---

## GAP-1: Leaderboard Uses Legacy Profit (🔴 HIGH)

**Location:** [storage.ts L526-586](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\storage.ts#L526-586)

**Problem:** The `getLeaderboard()` function sums `trades.profit` (legacy text column) instead of `net_profit_usd`:

```sql
-- Current (WRONG)
CASE WHEN t.profit ~ '^-?\d+(\.\d+)?$' THEN t.profit::numeric ELSE 0 END AS profit_num

-- Should be
COALESCE(t.net_profit_usd, 0) AS profit_num
```

**Impact:** Leaderboard rankings do NOT reflect trading costs (commissions, financing, swaps).

**Fix:**
```diff
- CASE WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
-   WHEN t.profit ~ '^-?\d+(\.\d+)?$' THEN t.profit::numeric
-   ELSE 0::numeric
- END AS profit_num
+ COALESCE(t.net_profit_usd, 0)::numeric AS profit_num
```

---

## GAP-2: trade_audit Missing Cost Columns (🟡 MEDIUM)

**Location:** [schema.pg.ts L965-1031](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\shared\schema.pg.ts#L965-1031)

**Problem:** The `trade_audit` table captures execution details but has NO cost breakdown fields:

| trades column | trade_audit equivalent |
|---------------|------------------------|
| `total_costs_usd` | ❌ Missing |
| `gross_profit_usd` | ❌ Missing |
| `net_profit_usd` | ❌ Missing |
| `open_commission_usd` | ❌ Missing |
| `close_commission_usd` | ❌ Missing |
| `financing_accrued_usd` | ❌ Missing |
| `swap_accrued_usd` | ❌ Missing |

**Impact:** Forensic audit trail cannot reconstruct cost breakdown at close time.

**Fix:** Add cost columns to `trade_audit`:
```typescript
// Add to trade_audit schema
totalCostsUsd: real("total_costs_usd"),
grossProfitUsd: real("gross_profit_usd"),
netProfitUsd: real("net_profit_usd"),
openCommissionUsd: real("open_commission_usd"),
closeCommissionUsd: real("close_commission_usd"),
financingAccruedUsd: real("financing_accrued_usd"),
swapAccruedUsd: real("swap_accrued_usd"),
```

---

## GAP-3: storage.closeTrade() Missing Cost Updates (🔴 HIGH)

**Location:** [storage.ts L404-445](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\storage.ts#L404-445)

**Problem:** The `closeTrade()` function only updates:
- `closePrice`, `profit`, `status`, `closedAt`
- Audit fields: `closeReason`, `closeQuoteTs`, `closeSource`, `closeBid/Ask/Mid/Spread`

**Missing from update:** All cost columns (totalCostsUsd, netProfitUsd, grossProfitUsd, commissions, fees, financing, swaps).

**Note:** The orderEngine and routes bypass this function and update trades directly. However, any code path using `storage.closeTrade()` would NOT record costs.

**Fix:** Add cost fields to function signature and update:
```typescript
async closeTrade(
  id: number,
  closePrice: number,
  profit: string,
  costs?: {
    grossProfitUsd?: number;
    netProfitUsd?: number;
    totalCostsUsd?: number;
    openCommissionUsd?: number;
    closeCommissionUsd?: number;
    // ... etc
  },
  audit?: { ... }
): Promise<Trade>
```

---

## What's Working ✅

### 1. Trades Table Schema (Complete)
[schema.pg.ts L230-243](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\shared\schema.pg.ts#L230-243)

| Column | Type | Purpose |
|--------|------|---------|
| `gross_profit_usd` | real | P/L before costs |
| `net_profit_usd` | real | P/L after all costs |
| `total_costs_usd` | real | Sum of all cost components |
| `open_commission_usd` | real | Commission at open |
| `close_commission_usd` | real | Commission at close |
| `open_other_fees_usd` | real | Exchange/clearing fees at open |
| `close_other_fees_usd` | real | Exchange/clearing fees at close |
| `financing_accrued_usd` | real | Daily financing charges |
| `swap_accrued_usd` | real | Overnight swap points |
| `overnight_days` | integer | Days held overnight |
| `category_snapshot` | text | Category at time of trade |
| `cost_model_version` | text | Cost model version used |

### 2. Trade Close in orderEngine.ts ✅

[orderEngine.ts L793-900](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\engine\orderEngine.ts#L793-900) correctly:
- Calls `computeCloseCosts()` from costPolicy
- Stores all cost fields in trade update
- Calculates `netProfitUsd = grossProfitUsd - totalCostsUsd`

### 3. Trade Close in routes.ts ✅

[routes.ts L3654-3773](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\routes.ts#L3654-3773) correctly stores all costs.

### 4. Auto-Close Cron ✅

[autoClose.ts L119-240](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\cron\autoClose.ts#L119-240) correctly stores all costs.

### 5. recalcAccount ✅

[recalcAccount.ts L353-365](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\recalcAccount.ts#L353-365):
```typescript
const holdingCosts = await computeOpenTradeAccrualCosts({...});
const netFloating = pnl - holdingCosts.accruedHoldingCostsUsd;
```

### 6. Client Screens ✅

| Screen | Uses netProfitUsd? |
|--------|-------------------|
| [TradeScreen.tsx](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\client\src\pages\TradeScreen.tsx#L782) | ✅ |
| [HistoryScreen.tsx](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\client\src\pages\HistoryScreen.tsx#L143) | ✅ |
| [AccountScreen.tsx](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\client\src\pages\AccountScreen.tsx#L51) | ✅ |

---

## Priority Fix Order

| Priority | Gap | Effort | Impact |
|----------|-----|--------|--------|
| **P1** | Leaderboard profit column | Low | Rankings incorrect |
| **P2** | storage.closeTrade costs | Medium | Future code paths affected |
| **P3** | trade_audit cost columns | Medium | Audit completeness |
