# Audit 2 — Bug Verification Report

**Audit Date:** 2026-02-17  
**Scope:** All files in the Adaptive Performance & Security Hardening system  
**Method:** Line-by-line static code review of 14 files (~2,800 lines)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 High | 4 |
| 🟡 Medium | 5 |
| 🔵 Low | 4 |
| **Total** | **16** |

---

## 🔴 Critical Bugs

### BUG-01: ConfigSync Perf Merge Overwrites Entire Global Settings Object

**File:** [ConfigSync.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/ConfigSync.tsx) — Lines 41-51

```typescript
const mergePerformance = (prev: unknown) => {
  if (!prev || typeof prev !== "object") return prev;
  const base = prev as Record<string, unknown>;
  return {
    ...base,
    ...(perf as Record<string, unknown>),  // ← SPREADS ALL perf keys into root
    updatedAt: ...
  };
};
```

**Bug:** The `performanceSettings` sub-object is spread directly into the **root** of the global-settings object, not nested under a `performanceSettings` key. If the server sends `{ performanceSettings: { restFallbackPollMs: 1000 } }`, the merge produces `{ ...existingSettings, restFallbackPollMs: 1000 }` — polluting the root namespace and **not** setting `performanceSettings.restFallbackPollMs` where `usePerformanceSettings()` reads it via `resolvePerformanceSettings(query.data)`.

**Impact:** Live admin performance tuning via WebSocket push is **silently broken**. The values are merged at the wrong nesting level, so `usePerformanceSettings()` never sees them. The subsequent `invalidateQueries` call (L57-58) triggers a full re-fetch which overwrites the bad merge, masking the bug — but the optimistic update is wasted.

**Fix:** Nest the merge under the `performanceSettings` key:
```typescript
return {
  ...base,
  performanceSettings: {
    ...(base.performanceSettings as Record<string, unknown> ?? {}),
    ...(perf as Record<string, unknown>),
  },
  updatedAt: ...
};
```

---

### BUG-02: `usePerformanceSettings` Passes Entire API Response, Not Nested `performanceSettings`

**File:** [use-performance-settings.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-performance-settings.ts) — Line 18

```typescript
return resolvePerformanceSettings(query.data);
```

**Bug:** `query.data` is the full `/api/global-settings` response object. `resolvePerformanceSettings()` tries to read fields like `restFallbackPollMs` directly from the passed object (L296-297 in `perfHints.ts`). If the API returns `{ performanceSettings: { restFallbackPollMs: 1000 }, ...otherSettings }`, the hook passes the **outer** object, so `resolvePerformanceSettings` reads `candidate.restFallbackPollMs` which is `undefined`, and falls back to `DEFAULT_PERFORMANCE_SETTINGS.restFallbackPollMs` (500ms).

**Impact:** **All admin-configured performance settings are ignored.** Every consumer hook always uses the hardcoded defaults. The entire admin perf config pipeline (server → WS → ConfigSync → usePerformanceSettings → hooks) is a no-op.

**Fix:** Extract the nested key:
```typescript
const perfData = (query.data as any)?.performanceSettings ?? query.data;
return resolvePerformanceSettings(perfData);
```

> [!CAUTION]
> BUG-01 and BUG-02 combine to completely nullify the admin performance tuning feature. Neither the optimistic WS merge nor the API fetch path correctly delivers admin settings to consumers.

---

### BUG-03: SW `isCacheableResponse` Missing Font/Image/WASM Content-Types

**File:** [sw.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts) — Lines 48-54

```typescript
const contentType = String(response.headers.get("content-type") || "").toLowerCase();
return (
  contentType.includes("text/html") ||
  contentType.includes("javascript") ||
  contentType.includes("text/css") ||
  contentType.includes("application/json")
);
```

**Bug:** The `/assets/` fetch handler (L207-226) uses `isCacheableResponse()` to decide whether to cache fetched assets. However, Vite outputs fonts (`.woff2`), images (`.svg`, `.png`), and potentially WASM (`.wasm`) into the `/assets/` directory. These content-types are **not whitelisted**, so:
- Font files served from `/assets/` are fetched but **never cached**
- Image assets are fetched but **never cached**
- Every page load re-downloads these assets even when cached versions should be available

**Impact:** Significantly increased bandwidth on repeat visits. Fonts cause FOUT (Flash of Unstyled Text) on slow connections because they can't be served from cache. Offline mode breaks for any page that depends on cached font/image assets.

**Fix:** Add missing content-types:
```typescript
contentType.includes("font/") ||
contentType.includes("image/") ||
contentType.includes("application/wasm") ||
contentType.includes("application/octet-stream")
```

---

## 🟠 High Severity Bugs

### BUG-04: QuotesProvider Flush Timer Not Cancelled on Unmount During Pending Flush

**File:** [QuotesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/QuotesProvider.tsx) — Lines 177-181

```typescript
useEffect(() => {
  if (flushTimerRef.current === null || !pendingFlushRef.current) return;
  window.clearTimeout(flushTimerRef.current);
  flushTimerRef.current = window.setTimeout(flushNow, quoteFlushMs);
}, [flushNow, quoteFlushMs]);
```

**Bug:** When `quoteFlushMs` changes (tier change), this effect clears and reschedules the timer. But it has **no cleanup function**. If the component unmounts while this effect's timer is pending, the timer fires after unmount, calling `flushNow()` → `setQuotes()` on an unmounted component. The separate unmount cleanup effect (L356-363) runs, but React doesn't guarantee ordering between independent `useEffect` cleanups.

**Impact:** Potential `setState` on unmounted component warnings. In React 18+ with concurrent features, this could cause a stale state update.

**Fix:** Add a cleanup return:
```typescript
useEffect(() => {
  if (flushTimerRef.current === null || !pendingFlushRef.current) return;
  window.clearTimeout(flushTimerRef.current);
  flushTimerRef.current = window.setTimeout(flushNow, quoteFlushMs);
  return () => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  };
}, [flushNow, quoteFlushMs]);
```

---

### BUG-05: `useTrades` Dependency Array Uses `user` Object Reference

**File:** [use-trades.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-trades.tsx) — Line 40

```typescript
}, [user?.id, isTradeWsConnected, sendMessage]);
```

But the `subscribe` effect (L42-56) uses `user?.id` in the body while depending on `user`:

```typescript
}, [queryClient, subscribe, user?.id]);
```

**Bug:** The subscribe effect at L42 references `user?.id` inside the callback at L48, which captures `user` by closure. The dependency array correctly lists `user?.id`. However, `use-account-summary.tsx` (L54) has `[user?.id, isWsConnected, sendMessage]` for the WS subscribe effect, but `usePendingOrders.ts` (L39) uses `[queryClient, subscribe, user]` — passing the **full `user` object**. Since `user` is a new object reference on every auth query refetch, this causes the pending orders subscribe effect to tear down and re-subscribe on every refetch cycle.

**Impact:** Unnecessary WS listener churn in `usePendingOrders` causing brief windows where trade update messages are dropped.

**Fix:** In `usePendingOrders.ts` L39, change `user` to `user?.id`:
```typescript
}, [queryClient, subscribe, user?.id]);
```

---

### BUG-06: `secureClearAll` Does Not Clear Service Worker Caches

**File:** [secureCache.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts) — Lines 408-411

```typescript
export async function secureClearAll(): Promise<void> {
  const cache = await getSecureCache();
  await cache.clearAll();
}
```

**Bug:** `secureClearAll()` only clears IndexedDB stores (`query-cache`, `user-state`, `e2ee-keys`). It does **not** clear:
1. Service Worker `CacheStorage` (`caches.delete()`) — the SW shell cache persists after logout
2. `localStorage` items (the encryption seed `tq.secure-cache.seed.v1` and scope survive)

**Impact:** After logout, the next user on the same browser inherits:
- The cached app shell (contains no sensitive data — low risk)
- The localStorage encryption seed (medium risk — if the same seed is reused with a different user scope, cached entries from the previous user could theoretically be decrypted if the scope derivation is predictable)

**Fix:** Add SW cache and localStorage cleanup:
```typescript
export async function secureClearAll(): Promise<void> {
  const cache = await getSecureCache();
  await cache.clearAll();
  // Clear SW caches
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  // Clear seed
  try { localStorage.removeItem(SEED_STORAGE_KEY); } catch {}
  try { localStorage.removeItem(SCOPE_STORAGE_KEY); } catch {}
}
```

---

### BUG-07: `queryClient` Retry Count Reads Stale Hints

**File:** [queryClient.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryClient.ts) — Lines 146-148

```typescript
retry: (failureCount, error) => {
  if (shouldSkipRetry(error)) return false;
  return failureCount < tierRetryCount(getPerfHints());
},
```

**Bug:** `getPerfHints()` calls `refreshPerfHints()` which reads `navigator.connection` synchronously. This is called on **every retry decision**, which is correct for getting fresh hints. However, the `QueryClient` is instantiated as a **module-level singleton** (L139). If the module is loaded in an SSR/Node context (e.g., during tests or server-side rendering), `navigator` is undefined, and `getPerfHints()` returns a snapshot with `effectiveType: "unknown"` and `tier: "FAST"` — resulting in `tierRetryCount` = 1.

**Impact:** In SSR or test environments, queries retry only once regardless of configuration. This is a minor concern in production but causes test flakiness when tests expect `retry: false` behavior (the plan's original intent).

---

## 🟡 Medium Severity Bugs

### BUG-08: `calculatePctChange` Returns 0 for Valid Zero Prices

**File:** [QuotesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/QuotesProvider.tsx) — Lines 77-80

```typescript
function calculatePctChange(current: number | null, previous: number | null): number {
  if (!current || !previous || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}
```

**Bug:** `!current` is truthy when `current === 0`. If price drops to exactly 0 (e.g., a delisted symbol), this returns 0% change instead of -100%. The `!previous` check similarly fails for valid zero previous prices, though `previous === 0` catch handles that case redundantly.

---

### BUG-09: `routePrefetch` Never Resets `scheduledPlanKey` After Completion

**File:** [routePrefetch.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts) — Lines 146-164

```typescript
if (scheduledPlanKey === planKey) return;  // dedup guard
scheduledPlanKey = planKey;
// ... runs prefetch
```

**Bug:** Once a prefetch plan executes, `scheduledPlanKey` retains the last plan key permanently. If the user's network tier changes (e.g., from FAST to CONSTRAINED and back to FAST), the second FAST plan has the same key and is skipped by the dedup guard. The prefetch targets may have been evicted from memory by browser GC in the interim.

**Impact:** After a network tier round-trip, prefetching stops working until page reload.

---

### BUG-10: `perfHints.ts` Listener Leak — `detachNativeListeners` Never Called

**File:** [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts) — Lines 231-250

```typescript
function ensureNativeListeners() {
  if (detachNativeListeners || typeof window === "undefined") return;
  // ... attaches listeners
  detachNativeListeners = () => { ... };
}
```

**Bug:** `ensureNativeListeners()` is called by `subscribeHints()`, `getHintsSnapshot()`, and `getPerfHints()`. The detach function is created but **never called anywhere** — there is no teardown path. The `change`, `online`, and `offline` event listeners persist for the entire page lifetime.

**Impact:** Minor — these are intentionally global listeners. But if the module is loaded in a test environment that simulates window teardown, the listeners leak.

---

### BUG-11: `queryPersistence` Hydration Deadline Can Skip All Keys

**File:** [queryPersistence.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts) — Lines 80-83

```typescript
const deadline = Date.now() + getQueryPersistHydrateTimeoutMs();
for (const key of PERSIST_QUERY_KEYS) {
  if (Date.now() > deadline) break;
```

**Bug:** On INSTANT/FAST tiers, `getQueryPersistHydrateTimeoutMs()` returns 100ms. Each `secureGet()` call involves IndexedDB read + AES-GCM decryption (100K PBKDF2 iterations for key derivation on first call). On devices where the first `secureGet` takes >100ms (cold IndexedDB + key derivation), the deadline breaks the loop after only 1-2 keys, leaving critical data like `/api/auth/current-user` and `/api/trades/open` unhydrated.

**Impact:** On fast-tier devices with cold caches, the app may show a loading spinner for auth state even though valid cached data exists in IndexedDB. Paradoxically, fast devices get **worse** hydration coverage because their timeout is shorter.

---

### BUG-12: `use-websocket` `connect` Callback Has Stale `url` Closure

**File:** [use-websocket.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-websocket.tsx) — Line 145 & 87

```typescript
const connect = useCallback(() => {
  // ...
  const ws = new WebSocket(url);  // url from closure
}, [clearReconnectTimer, shouldLog, url]);
```

The main `useEffect` depends on `[clearReconnectTimer, connect, enabled]`:

```typescript
useEffect(() => {
  // ...
  connect();
  return () => { ws.close(); };
}, [clearReconnectTimer, connect, enabled]);
```

**Bug:** If `url` changes, `connect` gets a new reference, triggering the effect cleanup (closing the old socket) and reconnection. This is correct behavior. However, during automatic reconnection (L129-134), the `connect` called from `setTimeout` captures the `connect` from the **closure at time of scheduling**, which could be stale if `url` changed between the close event and the reconnect timer firing.

**Impact:** After a URL change during an active reconnection backoff, the reconnect may connect to the **old** URL for one attempt before the effect cleanup corrects it.

---

## 🔵 Low Severity Bugs

### BUG-13: `QuotesProvider` WS Subscribe Effect Uses `.join("|")` in Dependency Array

**File:** [QuotesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/QuotesProvider.tsx) — Line 273

```typescript
}, [isAuthenticated, isWsConnected, requestedSymbols.join("|"), sendMessage]);
```

**Bug:** `requestedSymbols.join("|")` creates a new string on every render. React compares dependencies by reference for objects and by value for primitives. Since `join()` returns a primitive string, this works correctly for equality comparison. However, it's unconventional and bypasses React's exhaustive-deps lint rule expectations. If a symbol name ever contains `|`, two different symbol sets could produce the same join result.

---

### BUG-14: `secureCache` Seed Persists in localStorage Across Users

**File:** [secureCache.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts) — Lines 63-74

**Bug:** The encryption seed (`tq.secure-cache.seed.v1`) is generated once and stored in `localStorage` permanently. It survives `secureClearAll()`. While the scope changes per user (via `setSecureCacheUserScope`), the seed is shared across all users on the same browser. The PBKDF2 derivation uses `scope + seed + origin` as input, so different users get different keys. However, the seed is a high-value target — compromising it plus knowing the scope formula would allow offline decryption of any user's cached data.

---

### BUG-15: `perfHints` `combineTier` Takes the Worse Tier, Not Average

**File:** [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts) — Lines 165-167

```typescript
function combineTier(networkTier: PerformanceTier, deviceTier: PerformanceTier): PerformanceTier {
  return TIER_RANK[networkTier] >= TIER_RANK[deviceTier] ? networkTier : deviceTier;
}
```

**Bug (by design?):** A device with INSTANT network and CONSTRAINED CPU reports overall tier = CONSTRAINED. This is conservative but may over-throttle polling for CPU-constrained devices on fast networks. Polling is I/O-bound, not CPU-bound, so the network tier should arguably dominate for poll intervals. Currently, the combined tier is used for **all** decisions including poll intervals.

**Impact:** High-end network users on budget phones get unnecessarily slow poll rates.

---

### BUG-16: `vite.config.ts` `manualChunks` Has No Size Guard

**File:** [vite.config.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/vite.config.ts) — Lines 47-65

**Bug:** The `vendor` catch-all chunk puts **all** `node_modules` into a single chunk. For large dependency trees, this can produce a 1MB+ vendor bundle that blocks first paint. There's no `maxSize` or secondary split.

---

## Files Reviewed — No Bugs Found

| File | Lines | Status |
|------|-------|--------|
| [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts) | 609 | Clean (core tier logic is sound) |
| [use-account-summary.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-account-summary.tsx) | 97 | Clean |

---

## Priority Fix Order

| Priority | Bug | Effort |
|----------|-----|--------|
| 1 | BUG-02 — `usePerformanceSettings` wrong nesting | 5 min |
| 2 | BUG-01 — ConfigSync merge overwrites root | 10 min |
| 3 | BUG-03 — SW missing font/image content-types | 5 min |
| 4 | BUG-06 — `secureClearAll` misses SW caches + localStorage | 15 min |
| 5 | BUG-05 — `usePendingOrders` dependency array uses full `user` object | 2 min |
| 6 | BUG-04 — QuotesProvider flush timer cleanup | 5 min |
| 7 | BUG-11 — Hydration deadline too aggressive on fast tiers | 10 min |
| 8 | BUG-07 — queryClient retry in SSR context | 5 min |
| 9 | BUG-09 — routePrefetch stale plan key | 5 min |
| 10-16 | Remaining | Low priority |
