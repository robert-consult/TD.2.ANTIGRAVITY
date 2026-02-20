# Implementation Audit Report: routes.ts Decomposition

## Executive Summary
The implementation agent successfully untangled the `routes.ts` monolith, reducing it from 6,272 lines to 230 lines. Furthermore, it successfully implemented all of the critical logic, variables, and missing features identified in `missed_things.MD.RESOLVED`.

**HOWEVER**, the structural execution drastically deviated from the `DESIGN-001` Implementation Plan. The agent opted for a "semi-monolith" approach rather than the granular folder/file decomposition mandated by the plan. 

## 1. Architectural Deviation (MAJOR GAP)
**Plan Requirement:** 
Create specialized sub-directories (`server/routes/auth/`, `server/routes/profile/`, `server/routes/trader/`, `server/routes/public/`, `server/routes/ws/`) with granular, single-responsibility files (e.g., `login.ts`, `tradeOpen.ts`, `tradeClose.ts`, `wsQuotePush.ts`). 

**Actual Implementation:** 
The agent skipped the folder creation entirely. Instead, it consolidated the logic into monolithic "Core" files placed directly inside the `server/routes/` root directory:
- `traderCore.ts` (86 KB, ~1600+ lines)
- `profileCore.ts` (43 KB)
- `authCore.ts` (38 KB)
- `wsCore.ts` (35 KB)
- `publicCore.ts` (15 KB)
- `quotesCore.ts` (10 KB)

**Impact:** 
`traderCore.ts` remains a massive single file containing `tradeOpen`, `tradeClose`, `tradeTargets`, and `tradeCancel`. This directly violates the explicit instruction in Phase 17 of the plan: *"tradeOpen.ts and tradeClose.ts are the two most critical files. They must undergo a zero-tolerance move: copy the entire handler body verbatim."* By grouping them into `traderCore.ts`, the architectural goal of strict single-responsibility files for the most complex routes was missed.

## 2. RouterContext Pattern Abandoned (MODERATE GAP)
**Plan Requirement:** 
`server/context/routerContext.ts` and `server/context/buildMiddleware.ts` were strictly planned to encapsulate the closure anti-pattern using a shared structural context map, passing `RouterContext` to sub-routers.

**Actual Implementation:** 
The `server/context/` directory was never created. The agent abandoned the explicit `RouterContext` interface pattern entirely. 
Instead, it built the middleware dynamically inside the slimmed-down `routes.ts` file and passed them via inline options objects, such as:
```typescript
registerTraderCoreRoutes(app, {
  ensureAuth,
  ensureDoc1TermsAccepted,
  broadcast: traderBroadcastProxy,
});
```
While this is functionally identical and successfully breaks the master closure, it misses the rigorous, reusable Typing setup that the `RouterContext` interface provided.

## 3. "Missed Things" Successfully Handled (VERIFIED POSITIVES)
Despite the structural failures, the agent meticulously handled the logic items flagged in the `missed_things.MD` audit:

*   **Category 1 (Missing Inner Functions):** `loadQuoteSnapshotConfig` was correctly extracted and placed in `quotesCore.ts:17`. `loadLegalReacceptState` was correctly preserved in `authCore.ts:903`.
*   **Category 2 (Missing Routes):** The orphaned `tradeCancel` route was not lost; it was preserved within `traderCore.ts:1605`.
*   **Category 3 (Type Definitions):** The complex `LiveClient` custom WebSocket type was flawlessly established in `wsCore.ts:57`.
*   **Category 4 (Constants & Mutable State):** The `EMAIL_VERIFICATION_GRACE_PERIOD_MS` constant was properly moved to `lib/computeEmailGracePeriod.ts`. Mutables like `metricTradeCloseRejectedQuoteStaleTotal` were preserved gracefully in `routes/metricsState.ts`. The WebSocket payload limits (`wsMaxPayloadBytes`) are securely present in `wsCore.ts:90`.
*   **Category 5 (WS Helpers):** Utility functions like `expectedWsOriginFromRequest` were successfully lifted from the monolith and injected into `wsCore.ts`.
*   **Category 7 (Jurisdiction Recheck):** The critical `setInterval` loop that executes background WebSocket client jurisdiction checks was established in `wsCore.ts:852`.
*   **Category 11 (requireEnv):** Correctly extracted to the new `server/lib/envUtils.ts` and successfully utilized in `routes.ts`.

## Conclusion
The agent achieved **Functional Success** but **Structural Failure**. 
No logic was lost, the server still boots, and the `routes.ts` file uses just 230 lines; however, the codebase now relies on 6 dense `*Core.ts` files instead of the 35+ granular, distinct module files originally planned. 

To fully realize `DESIGN-001`, a second decomposition phase should be scheduled specifically to split the `*Core.ts` monoliths into their respective target directories.
