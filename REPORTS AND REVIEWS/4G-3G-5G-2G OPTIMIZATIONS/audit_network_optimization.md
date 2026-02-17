# Deep Audit Report: Adaptive Performance & Network Optimization

**Date:** 2026-02-16
**Status:** Complete — No Code Edits
**Scope:** All performance-related client-side files

---

## Executive Summary

The app's performance optimization system is **fundamentally binary** — it classifies users as either "constrained" or "unconstrained" and applies a single throttling profile to each group. **It does not scale.** A user on a flagship phone with 5G gets the same polling intervals, prefetch strategy, and flush timing as a user on a 3-year-old mid-range phone with the same 5G. Conversely, a user on slow 4G with a fast phone gets needlessly throttled because the system conflates device power with network quality.

The design intent (per the PRD) was that Slow 4G + mid-tier device was the **worst-case floor** — the app should degrade gracefully there. Instead, the implementation treats that floor as a **ceiling** — performance cannot exceed "unconstrained" even on hardware 10x faster. There is no spectrum; there is only a switch.

> [!CAUTION]
> **The result:** The app feels identically sluggish on a $1,200 flagship phone on Wi-Fi as it does on a $200 mid-range phone on fast 4G. Users with better hardware/network get zero benefit from their investment.

> [!IMPORTANT]
> **Desktop & Laptop Users:** The system also fails to account for desktop/laptop users who typically have powerful CPUs (8-16+ cores), ample RAM (8-32GB), and wired/fast Wi-Fi connections. These users should experience **sub-200ms responsiveness** across the board — yet they receive the same generic "unconstrained" profile as a mid-range mobile phone on average Wi-Fi. Desktop users represent a significant portion of active traders and should be prioritized for the highest performance tier.

---

## Finding Map

| # | Severity | File | Issue |
|---|----------|------|-------|
| F1 | 🔴 Critical | `perfHints.ts` | Binary `isConstrained` conflates device and network |
| F2 | 🔴 Critical | `perfHints.ts` | No continuous scaling — only 2 tiers exist |
| F3 | 🔴 Critical | `LiveUpdatesProvider.tsx` | Hardcoded WS reconnect ignores own backoff library |
| F4 | 🟠 High | `perfHints.ts` | Static snapshot — never re-evaluates when conditions change |
| F5 | 🟠 High | `QuotesProvider.tsx` | Quote flush throttled by device, not rendering capacity |
| F6 | 🟠 High | `routePrefetch.ts` | One-shot prefetch, no capability-aware scheduling |
| F7 | 🟠 High | `queryPersistence.ts` | 200ms hydration timeout is not device-adaptive |
| F8 | 🟡 Medium | `sw.ts` | Service worker doesn't pre-cache JS route chunks |
| F9 | 🟡 Medium | `use-trades.tsx` / `usePendingOrders.ts` / `use-account-summary.tsx` | All 4 polling hooks use the flawed `recommendedPollIntervalMs` |
| F10 | 🟡 Medium | `vite.config.ts` | No `manualChunks` — no control over bundle splitting |
| F11 | 🟡 Medium | `AuthenticatedShell.tsx` | Prefetch fires once on mount, not after auth resolves |
| F12 | 🟢 Low | `queryClient.ts` | `staleTime: Infinity` + `retry: false` — no automatic revalidation |

---

## Detailed Findings

### F1 — Binary `isConstrained` Conflates Device and Network
**File:** [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts#L33-L53)

```typescript
// Line 33-43: Both conditions feed into ONE boolean
const networkConstrained = saveData || effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g" ||
  (effectiveType === "4g" && ((rttMs != null && rttMs > 350) || (downlinkMbps != null && downlinkMbps < 1.6)));

const deviceConstrained = (deviceMemoryGB != null && deviceMemoryGB <= 4) || (hardwareConcurrency != null && hardwareConcurrency <= 4);

// Line 52: Merged into one flag
isConstrained: networkConstrained || deviceConstrained,
```

**Problem:** A user with 8GB RAM and 8 cores on slow 4G is treated identically to a user with 2GB RAM and 2 cores on Wi-Fi. The system should throttle *network operations* for the first user and reduce *UI complexity* for the second — but instead it applies the same blanket throttle to both.

**Impact:** Every downstream consumer (6 files) inherits this incorrect conflation.

---

### F2 — No Continuous Scaling — Only 2 Tiers
**File:** [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts#L56-L65)

```typescript
// Line 56-60: recommendedPollIntervalMs
if (!hints.isConstrained) return base; // Tier 1: "Fast" — base interval
const multiplier = hints.effectiveType === "4g" ? 2 : 3; // Tier 2: "Slow" — 2x or 3x
```

**Problem:** The system has exactly **2 performance tiers** + one sub-tier for 4G constrained. There is no spectrum between them.

Using a corrected **base interval of 2000ms** (admin-configurable, see R13) and targeting **≤200ms for 5G/Desktop**:

| Actual Capability | What App Does Now | What App Should Do |
|---|---|---|
| **Desktop / Laptop** (wired/fast Wi-Fi, 8+ cores, 8+ GB) | Base interval (4000ms) | **≤200ms** — WS primary, REST instant fallback, all features at max fidelity |
| **5G + Flagship** (best mobile) | Base interval (4000ms) | **≤200ms** — identical to desktop, WS primary |
| **Wi-Fi + Mid-tier phone** | Base interval (4000ms) | **≤500ms** — fast polling, slightly longer flush |
| **Fast 4G + Flagship** | Base interval (4000ms) | **≤1500ms** — fast enough to feel near-instant |
| **Slow 4G + Mid-tier** | 2× base (8000ms) | **2× base (4000ms)** ✅ Correct ratio, lower absolute |
| **3G + Low-end** | 3× base (12000ms) | **3× base (6000ms)** ✅ Correct ratio, lower absolute |
| **2G / Offline** | 3× base (12000ms) | **Minimal polling (15s+), aggressive cache** |

> [!WARNING]
> **Congestion Advisory:** Pushing REST fallback below 500ms on mobile raises the risk of network contention on shared cell towers. For **5G and Desktop/Wi-Fi**, sub-200ms polling is safe because bandwidth is abundant and latency is low. For **4G**, staying at or above 1500ms avoids overwhelming the connection when WS is down. The WS channel itself operates at **≤1ms server-side push** and is not subject to polling contention — it should always be the primary data path. REST polling is the *fallback*, not the primary channel.

The top 4 tiers are **all treated identically** despite massive capability differences. A desktop trader on fiber or a 5G flagship user should feel *instantaneous* — sub-200ms data refresh — but gets the same 4-second base poll as slow 4G.

---

### F3 — WebSocket Reconnect Ignores Own Library
**File:** [LiveUpdatesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/LiveUpdatesProvider.tsx#L24-L27)

```typescript
// Line 24-27: Hardcoded values
const { isConnected, sendMessage } = useWebSocket(wsUrl, {
  enabled: isAuthenticated,
  reconnectInterval: 1500,   // ← HARDCODED
  reconnectAttempts: 50,     // ← HARDCODED — should be capped at 30
```

**Meanwhile, `perfHints.ts` exports:**
```typescript
computeWsReconnectDelayMs(attempt, baseMs, hints) // exponential backoff with jitter — NEVER CALLED by LiveUpdatesProvider
```

**Impact:**
- On slow 4G: 50 reconnection attempts at 1.5s intervals = 75 seconds of aggressive retries, causing network contention. **Cap at 30 attempts max.**
- On fast Wi-Fi / Desktop: The exponential backoff is actually *too conservative* for a momentary glitch — should retry faster initially

---

### F4 — Static Snapshot, Never Re-Evaluates
**File:** [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts#L22-L54)

`getPerfHints()` is called **once** and cached in `useMemo(() => getPerfHints(), [])` across consumers. The `navigator.connection` API provides a `change` event that fires when the user moves from Wi-Fi to cellular, or from 4G to 3G. **This event is never listened to.**

**Impact:** User walks from Wi-Fi to parking lot (4G → 3G). The app still uses Wi-Fi polling intervals. User walks back inside to Wi-Fi. The app still uses the low-bandwidth profile from 3G if it was captured during the transition.

---

### F5 — Quote Flush Throttled Incorrectly
**File:** [perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts#L63-L65) → consumed by [QuotesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/QuotesProvider.tsx#L164)

```typescript
// perfHints.ts L63-65
export function recommendedQuoteFlushIntervalMs(hints = getPerfHints()): number {
  return hints.isConstrained ? 500 : 250;
}
```

**Problem:** On a **device-constrained** but **network-fast** connection, quotes arrive quickly via WS but are flushed to the UI at 500ms intervals. The bottleneck isn't rendering speed — it's the blanket `isConstrained` flag. Conversely, a powerful device on a slow network gets 250ms flush intervals even though quotes trickle in at 2-3 second intervals anyway (wasteful timer).

**Correct behavior:** Flush interval should scale with **device capability** (CPU/rendering budget), not network speed.

---

### F6 — One-Shot Prefetch, Not Capability-Aware
**File:** [routePrefetch.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L78-L90) + [AuthenticatedShell.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/AuthenticatedShell.tsx#L98-L100)

```typescript
// AuthenticatedShell.tsx L98-100
useEffect(() => {
  prefetchAllRoutes(); // Fires once on mount
}, []);
```

**Problems:**
1. **No "instant mode" for fast devices:** On a flagship + fast network, all 9 chunks could be prefetched aggressively and **in parallel** — the device can handle it. Instead, `requestIdleCallback` serializes them one-by-one with 2s timeout fallbacks.
2. **No adaptive chunk count:** On Slow 4G, only chunks on `slow-2g` or `2g` are limited (to 3). Regular 4G with bad RTT still prefetches all 9 — burning limited bandwidth.
3. **For slow devices with good network:** Should prefetch **all** chunks aggressively (bandwidth is cheap) but schedule execution carefully (CPU is expensive). Current logic doesn't distinguish.

---

### F7 — Hardcoded 200ms Hydration Timeout
**File:** [queryPersistence.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L7-L82)

```typescript
export const QUERY_PERSIST_HYDRATE_TIMEOUT_MS = 200; // Line 7

// Line 79-82: Iterates through PERSIST_QUERY_KEYS, bails if > 200ms
for (const key of PERSIST_QUERY_KEYS) {
  if (Date.now() > deadline) break; // ← SKIPS remaining keys
```

**Problem:** 200ms is generous for a flagship phone but tight for a mid-range device with slow IndexedDB + AES-256-GCM decryption. On a slow device, the hydration may only restore 3 of 7 cached keys before the deadline, leaving the user with partial cached data. On a fast device, 200ms is wasted budget — it could hydrate everything in 20ms.

**Missing:** The timeout should scale with device capability. Fast devices should have a shorter timeout (they finish quickly anyway). Slow devices should have a *longer* timeout because the cached data is their primary win.

---

### F8 — Service Worker Doesn't Pre-Cache Route Chunks
**File:** [sw.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts#L9)

```typescript
const SHELL_URLS = ["/index.html"]; // Only caches index.html
```

The SW caches `index.html` and then reactively caches `/assets/*` on first fetch. But **on slow 4G, the first fetch IS the problem.** For the "app close → reopen" scenario the user described, the SW should proactively cache the critical route chunks (`QuotesScreen`, `TradeScreen`, `ChartScreen`) during `install`, so that on reopen, even without network, the shell + critical tabs render instantly from SW cache.

Currently, the `cacheIndexAndAssets` function (line 24) parses `index.html` for `<script src>` and `<link href>` tags and fetches those. This catches the main bundle but **not the lazy-loaded chunks** (which are `import()` calls, not `<script>` tags in HTML).

---

### F9 — All Polling Hooks Use Flawed `recommendedPollIntervalMs`
**Files:**
- [QuotesProvider.tsx L329](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/QuotesProvider.tsx#L329): `recommendedPollIntervalMs(5000)`
- [use-account-summary.tsx L72](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-account-summary.tsx#L72): `recommendedPollIntervalMs(7000)`
- [use-trades.tsx L58,70](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-trades.tsx#L58): `recommendedPollIntervalMs(7000)`
- [usePendingOrders.ts L40](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/usePendingOrders.ts#L40): `recommendedPollIntervalMs(10000)`

All inherit the binary `isConstrained` → 2x/3x multiplier. On a flagship + Wi-Fi or Desktop:
- Quotes poll: 5000ms (should be **500ms** default, admin-configurable)
- Account summary: 7000ms (should be **500ms** default, admin-configurable)
- Trades: 7000ms (should be **500ms** default, admin-configurable)
- Pending orders: 10000ms (should be **500ms** default, admin-configurable)
- **WS push interval:** Currently undefined (server-side) — should be **≤1ms** (instantaneous push on state change)

These are **HTTP fallback** intervals (used when WS is down). When WS works, polling is disabled — which is correct. But the fallback intervals should also scale.

> [!IMPORTANT]
> **Admin-Configurable Intervals (New Requirement):** All polling intervals, WS push frequencies, and flush timings should be surfaced as configurable settings in the **Admin Control Panel → System Config → Market Data** section using cards. Defaults: **500ms for REST fallback, ≤1ms for WS push**. Changes must propagate **instantaneously** to all connected clients via `global-settings:updated` WS event — **no reload, restart, or refresh required.**

---

### F10 — No `manualChunks` in Vite Config
**File:** [vite.config.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/vite.config.ts#L35-L48)

```typescript
build: {
  rollupOptions: {
    input: { main: ..., sw: ... },
    output: {
      entryFileNames: (chunk) => chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
    },
    // ← No manualChunks configuration
  },
},
```

**Missing:** No explicit chunk splitting for `admin/`, `vendor/`, or critical-path vs deferred modules. Vite's default splitting may bundle heavy vendor libraries (chart libraries, i18n dictionaries) into the main chunk, increasing initial load. For slow 4G, every KB matters.

---

### F11 — Prefetch Fires on Mount, Not After Auth
**File:** [AuthenticatedShell.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/AuthenticatedShell.tsx#L98-L100)

```typescript
useEffect(() => {
  prefetchAllRoutes();
}, []); // ← Empty deps — fires on component mount
```

This fires as soon as `AuthenticatedShell` mounts. At this point, auth *is* resolved (since `AppRoutes` gates on `isAuthenticated`). However, the network may still be busy with initial data fetches (`/api/auth/current-user`, `/api/config/symbols`, etc.). Prefetching chunks during this critical window **competes with essential data** for bandwidth.

**For slow 4G:** Prefetch should be deferred until after initial data loads complete.
**For fast networks:** Parallel prefetch is fine, bandwidth isn't a constraint.

---

### F12 — `staleTime: Infinity` with `retry: false`
**File:** [queryClient.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryClient.ts#L126-L139)

```typescript
defaultOptions: {
  queries: {
    staleTime: Infinity, // Data never considered stale by default
    retry: false,        // Failed fetches never retried
  },
},
```

Combined with `refetchOnWindowFocus: false` (set on most hooks), this means: if a query fails once (e.g., on a spotty slow 4G connection), it **never retries** and the data stays empty until the user manually refreshes. For slow 4G resilience, `retry: 2` with exponential backoff would be more appropriate. For fast networks, `retry: 1` with immediate retry would mask transient failures.

---

## Recommendation Strategy: "Meet Every User at Their Level"

### Principle: Performance Tiers, Not Binary Switch

Replace `isConstrained: boolean` with a **performance tier system** (5 tiers). Most users (desktop, laptop, flagship mobile, good 4G) should land in **INSTANT** or **FAST** — feeling instantaneous with all features enabled:

| Tier | Network | Device | REST Fallback | WS Push | Flush | Prefetch | Animations |
|------|---------|--------|--------------|---------|-------|----------|------------|
| **INSTANT** | 5G / Fast Wi-Fi / Wired (RTT < 50ms, DL > 10 Mbps) | Desktop, Laptop, Flagship mobile (8+ cores, 8+ GB) | **≤200ms** (admin default: 500ms) | **≤1ms** (instantaneous) | 50ms | All 9 chunks in parallel | Full |
| **FAST** | Good 4G / Wi-Fi (RTT < 150ms, DL > 5 Mbps) | Mid-range+ (4+ cores, 4+ GB) | **≤500ms** | **≤1ms** | 150ms | All 9 sequential | Full |
| **MODERATE** | 4G with latency (RTT 150-350ms, DL 1.5-5 Mbps) | 4+ cores, 2-4 GB | **1500ms** | **≤1ms** | 300ms | Top 6 chunks | Reduced |
| **CONSTRAINED** | Slow 4G (RTT > 350ms, DL < 1.5 Mbps) | 2-4 cores, 2-4 GB | **4000ms** (2× base) | **≤1ms** | 500ms | Top 3 chunks | Minimal |
| **MINIMAL** | 2G/3G/saveData | < 2 cores, < 2 GB | **6000ms** (3× base) | **≤1ms** | 1000ms | None | Disabled |

> [!NOTE]
> **Desktop/Laptop users** will virtually always land in **INSTANT** tier: they typically have 8-16 cores, 8-32GB RAM, and wired or fast Wi-Fi. The `navigator.hardwareConcurrency` and `navigator.deviceMemory` APIs accurately detect these capabilities. These users should experience the app as indistinguishable from a native desktop application.

### Core Refactors

#### R1. Split `isConstrained` into `isNetworkConstrained` + `isDeviceConstrained`
Each downstream consumer picks the appropriate flag. Network polling uses network flag. UI flush uses device flag. Reconnect backoff uses network flag.

#### R2. Introduce `getPerformanceTier()` → `"INSTANT" | "FAST" | "MODERATE" | "CONSTRAINED" | "MINIMAL"`
This function combines network + device signals into a single tier that maps to a full behavior profile (polling intervals, prefetch count, flush timing, retry policy, animation budget).

#### R3. Make Hints Reactive
Subscribe to `navigator.connection.addEventListener('change', callback)` and re-evaluate the tier when network conditions change. Use a React context or external store that consumers `useSyncExternalStore` from.

#### R4. Integrate WS Backoff into `LiveUpdatesProvider`
Replace hardcoded `reconnectInterval: 1500` with `computeWsReconnectDelayMs()` from `perfHints.ts`. **Cap reconnect attempts at 30** (not 50). On slow networks, use longer base delays; on fast networks/desktop, use shorter.

#### R5. Device-Adaptive Hydration Timeout
Scale the `QUERY_PERSIST_HYDRATE_TIMEOUT_MS`:
- **INSTANT/FAST**: 100ms (they'll finish in <50ms anyway)
- **MODERATE**: 300ms
- **CONSTRAINED**: 500ms (cache is their lifeline — give them time)
- **MINIMAL**: 800ms

#### R6. Service Worker Chunk Pre-Caching
After `install`, parse the Vite manifest (or a generated chunk list) and pre-cache the top 3 critical route chunks (`QuotesScreen`, `TradeScreen`, `ChartScreen`). This ensures "close app → reopen" renders the critical tabs from SW cache without network.

#### R7. Capability-Aware Prefetch Scheduling
- **INSTANT tier**: Prefetch all 9 chunks in parallel (fast device + fast network = no contention)
- **FAST tier**: Prefetch all 9 sequentially via `requestIdleCallback`
- **MODERATE/CONSTRAINED**: Prefetch top 3-6 only, deferred until initial data loads complete
- **MINIMAL**: No prefetch (save every byte of bandwidth for essential data)

#### R8. Scale fallback poll intervals to tier (base: 2000ms, admin-configurable default: 500ms)
- **INSTANT** (Desktop / 5G / Fast Wi-Fi): **≤200ms** — WS is primary, REST barely needed
- **FAST** (Good 4G / Wi-Fi + mid-range+): **≤500ms**
- **MODERATE** (4G with latency): **1500ms**
- **CONSTRAINED** (Slow 4G): **4000ms** (2× base)
- **MINIMAL** (2G/3G): **6000ms** (3× base)

#### R9. Add `retry` to QueryClient defaults
```typescript
retry: (failureCount, error) => {
  if (error instanceof ApiError && error.status === 401) return false;
  return failureCount < (tier === "CONSTRAINED" || tier === "MINIMAL" ? 3 : 1);
},
retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
```

#### R10. Explicit `manualChunks` in Vite Config
```typescript
manualChunks(id) {
  if (id.includes("/src/admin/") || id.includes("/pages/Admin")) return "admin";
  if (id.includes("node_modules/recharts") || id.includes("node_modules/d3")) return "charts-vendor";
  if (id.includes("node_modules")) return "vendor";
},
```

#### R13. Admin-Configurable Performance Settings (NEW)
Surface the following settings in **Admin Control Panel → System Config → Market Data** as individual cards:

| Setting | Default | Description |
|---------|---------|-------------|
| REST Fallback Poll Interval | **500ms** | Base interval when WebSocket is unavailable |
| WS Push Frequency | **≤1ms** (instant on state change) | Server pushes data immediately on change |
| Quote Flush Interval | **50ms** (INSTANT tier) | How often UI redraws quote data |
| Prefetch Strategy | **All chunks** | How many route chunks to prefetch |
| Max WS Reconnect Attempts | **30** | Cap on reconnection tries before giving up |
| WS Reconnect Base Delay | **1500ms** | Starting delay for exponential backoff |

**Propagation:** When an admin changes any setting, the server broadcasts a `global-settings:updated` WS event. All connected clients pick up the new values **instantly** — no page reload, app restart, or manual refresh required. The client already has a `ConfigSync` component that listens for this event and invalidates the `/api/global-settings` query.

**Client-side override:** The performance tier system applies a **multiplier** on top of the admin-configured base. For example, if admin sets REST fallback to 500ms, the CONSTRAINED tier applies 2× = 1000ms. The INSTANT tier uses the admin value as-is or lower.

#### R11. Defer Prefetch on Slow Networks
On `CONSTRAINED` / `MINIMAL` tiers, delay `prefetchAllRoutes()` by 5-10 seconds after mount (or until initial data queries settle) to avoid competing with critical data for bandwidth.

#### R12. "Remember Me" + Cache = Instant Reopen
The auth flow already caches user state in IndexedDB and restores it on mount (good). But the UX impact is weakened because:
- Hydration may time out on slow devices (F7)
- Route chunks aren't SW-cached (F8)
- Quotes are never cached (by design, correct for accuracy, but a "last known" with stale badge would be better than empty)

For the "close and reopen with Remember Me" flow to feel instant:
1. SW serves app shell from cache (✅ works today)
2. SecureCache hydrates auth + account data (✅ works, but needs more time on slow devices)
3. SW serves route JS chunks from cache (❌ not implemented — F8)
4. App renders with cached data + stale badge (✅ works)
5. Background revalidation replaces stale data (✅ works)

Step 3 is the **missing link** for truly instant reopens.

---

## Files Requiring Changes

| File | Changes Required | Complexity |
|------|------------------|------------|
| `client/src/lib/perfHints.ts` | R1, R2, R3, R8 — Complete rewrite of the tier system | High |
| `client/src/live/LiveUpdatesProvider.tsx` | R4 — Use `computeWsReconnectDelayMs`, cap at 30 | Low |
| `client/src/live/QuotesProvider.tsx` | R1, R8 — Use network flag for poll, device flag for flush | Medium |
| `client/src/hooks/use-account-summary.tsx` | R8 — Use tier-scaled poll interval, read admin config | Low |
| `client/src/hooks/use-trades.tsx` | R8 — Use tier-scaled poll interval, read admin config | Low |
| `client/src/hooks/usePendingOrders.ts` | R8 — Use tier-scaled poll interval, read admin config | Low |
| `client/src/lib/routePrefetch.ts` | R7, R11 — Tier-aware scheduling | Medium |
| `client/src/lib/queryPersistence.ts` | R5 — Device-adaptive hydration timeout | Low |
| `client/src/sw.ts` | R6 — Pre-cache route chunks | Medium |
| `vite.config.ts` | R10 — `manualChunks` | Low |
| `client/src/AuthenticatedShell.tsx` | R11 — Conditional prefetch delay | Low |
| `client/src/lib/queryClient.ts` | R9 — Add retry config | Low |
| `server/routes/globalSettings.ts` | R13 — Add performance config fields to global settings API | Medium |
| `client/src/pages/AdminDashboard.tsx` | R13 — System Config → Market Data cards for perf settings | Medium |
| `client/src/live/ConfigSync.tsx` | R13 — Propagate updated perf config to consumers instantly | Low |
