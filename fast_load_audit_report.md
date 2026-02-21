# Fast Load Audit Report

This report provides a deep audit of the aggressive prefetching, preloading, and caching systems in the TD.2.ANTIGRAVITY trading application. It identifies implementation flaws, systemic bottlenecks, and mismatches that prevent the app from achieving maximum bandwidth allocation and "snappy" tab navigation. 

Following the audit findings, a set of researched, high-performance solutions are presented to achieve the 20MB-40MB burst preloading capability across all device and network profiles.

---

## 1. Aggressive Prefetch System (`routePrefetch.ts`)
### Current Implementation
The system attempts to prefetch 9 critical chunk targets (Quotes, Trade, Chart, History, Account, etc.) using dynamic imports. It executes either sequentially or in parallel based on a `tierPrefetchPlan`.

### Bugs, Failures & Mismatches
*   **Not Truly Aggressive (Idle Yielding):** The sequential prefetch mode utilizes `requestIdleCallback` (with a 100ms fallback). This inherently yields to the main thread and low-priority tasks. It contradicts the goal of "maxing out all available bandwidth" for a 20MB-40MB initial burst, as it waits for the CPU to be idle rather than saturating the network.
*   **Overly Conservative Start Delays:** The prefetch heavily delays starting based on the network tier. A `FAST` tier waits **0ms**, but a `MODERATE` tier waits **3,000ms**, and `CONSTRAINED/MINIMAL` waits **5,000ms - 10,000ms** (set in `AuthenticatedShell.tsx`). This means a user on a 3G network sits for up to 10 seconds before the app even *attempts* to cache standard pages, completely defeating the purpose of perceived snappiness upon navigation.
*   **Parallel Execution Blindspot:** When both device and network are `INSTANT`, the app fires all 9 dynamic imports simultaneously via `Promise.all`. This triggers 9 concurrent JS chunk requests + associated CSS/Vendor chunks. Browsers cap concurrent connections per domain (usually 6). This causes heavy network contention, blocking critical initial API REST or WebSocket calls from resolving quickly.

## 2. Caching System & Service Worker (`sw.ts`)
### Current Implementation
The Service Worker caches `/index.html` and manifest candidate chunks (`manifest.json` parsing). It uses a cache-first strategy for `/assets/` and a stale-while-revalidate strategy for navigation.

### Bugs, Failures & Mismatches
*   **Incomplete Pre-caching:** The Service Worker installation specifically looks for ONLY 4 hints in the manifest to cache ("Dashboard", "QuotesScreen", "TradeScreen", "ChartScreen") via `CRITICAL_ROUTE_KEY_HINTS`. It completely ignores History, Account, Leaderboard, Journal, Profile, and PartnerPortal chunks. 
*   **Race Conditions on Install:** `cacheCriticalRouteChunks` loops over the manifest and caches assets manually on SW install, while `routePrefetch.ts` triggers standard browser cache on the main thread. If a user installs the SW and visits the dashboard, these two systems duplicate network load because they aren't synchronized.
*   **Bypass Flaw:** The SW fetches ignore `isBypassPath` which excludes `/api/` and `/ws`. However, it doesn't aggressively intercept or prioritize the heavy 20MB-40MB payload if it's not strictly an asset in the manifest (e.g., dynamically generated WebAssembly, large charting libraries loaded asynchronously, or generic fonts/images).

## 3. Phone Performance & Internet Speed Profiles (`perfHints.ts`)
### Current Implementation
Evaluates `navigator.connection`, `deviceMemory`, and `hardwareConcurrency` to bin the user into `INSTANT`, `FAST`, `MODERATE`, `CONSTRAINED`, or `MINIMAL`. 

### Bugs, Failures & Mismatches
*   **Pessimistic Combination Logic:** The `combineTier` function takes the **worst** of the network and device tiers (`TIER_RANK[networkTier] >= TIER_RANK[deviceTier] ? networkTier : deviceTier`). If a user has an extremely fast iPhone 15 Pro but slightly patchy 4G (MODERATE network), the entire app degrades to MODERATE. This restricts prefetching to sequential (meaning 1 chunk at a time, slowly) and delays prefetch by 3 seconds, making the powerful phone feel sluggish.
*   **Polling & Flush Bottlenecks:** The quote flush intervals and API polling stagger significantly based on tier. On `CONSTRAINED`, the quote flush drops to 500ms (2 FPS). This makes the UI feel broken or unresponsive rather than "snappy".

## 4. UI Rendering & React Context (`lazyWithPing.ts` & `queryPersistence.ts`)
### Bugs, Failures & Mismatches
*   **Global Ping Re-renders:** When a lazy component loads, `lazyWithPing()` calls `emit()` which fires a global `setTimeout(..., 0)` to ping React state. Because this forces a global re-render across Suspense boundaries, clicking a tab forces the main thread to freeze momentarily to parse the JS chunk AND re-render the app shell. This creates visual jank when navigating.
*   **IndexedDB Blocking:** React Query persists data to IndexedDB (`secureCache`). On mount, it hydrates `ESSENTIAL_HYDRATION_KEYS`. If the cache is bloated (e.g., holding heavy trade histories or symbols), deserializing 10MB+ from IndexedDB on a mobile device synchronously blocks the main thread, causing a noticeable delay before Time to Interactive (TTI).

---

## 5. Suggested Solutions (Research & Deep Logic)

To achieve a true "max bandwidth" 20MB-40MB burst that makes the app feel instantly snappy across all tabs, we must fundamentally shift from "React Dynamic Imports" to "Service Worker Background Streaming" and "HTML Preload Scanners".

### Solution A: The "Background Sync" SW Burst Architecture
Instead of having the React main thread dynamically import 9 files (which executes Javascript and blocks the UI), shift the 20MB-40MB payload fetching entirely to the Service Worker.
1.  **Vite Asset Manifesting:** Generate a specific `burst-manifest.json` during build that contains the exact URLs of all trader-facing chunks, vendor libraries, and CSS.
2.  **SW Message Passing:** When the app detects the critical path is rendered (e.g., Dashboard mounted), instead of running `routePrefetch.ts` on the main thread, it sends a `postMessage({ type: 'INITIATE_BURST_PREFETCH' })` to the Service Worker.
3.  **Controlled Concurrency Queue in SW:** The Service Worker opens a dedicated fetch queue, explicitly capping at 4-5 concurrent connections (leaving 1-2 open for WebSockets/REST). It downloads the 20MB payload directly into the Cache Storage API. Because it happens in a background worker thread, **the main UI thread remains 100% unblocked** and the app stays buttery smooth.

### Solution B: Preload Header Links (`<link rel="preload">`)
For the absolute most essential routes (Quotes, Trade), inject `<link rel="modulepreload" href="...">` directly into `index.html`. 
The browser's native HTML parser will download these bits in the background *before* React even boots up. This maximizes the allocation pipeline instantly upon HTTP response, bypassing the delay of waiting for React to mount and evaluate `perfHints.ts`.

### Solution C: Decouple Device and Network Tiers
Revamp `perfHints.ts` to separate the concerns of **Network Throttling** vs **Device Throttling**:
*   **Network (3G/4G):** Should dictate *how many* concurrent requests happen (concurrency limit) and WebSocket ping rates. It should *not* dictate `requestIdleCallback`. If the network is slow, it should fetch in the background aggressively as early as possible so the user doesn't wait when they click a tab.
*   **Device (RAM/Cores):** Should dictate whether we use heavy animations (Glassmorphism blur), the size of the DOM (virtualized lists), and quote flush rates.
*   **Fix:** Never force a fast device to execute sequentially just because the network is `MODERATE`. 

### Solution D: Fix Lazy Loading Jank (Transition API)
Replace `lazyWithPing.ts` entirely. Modern React >=18 provides `useTransition().` When a user clicks a tab in the header:
```javascript
startTransition(() => {
  navigate('/quotes');
});
```
This keeps the current UI fully responsive and interactive, fetches the cached chunk instantly from the Service Worker, and renders the next screen in memory before painting it to the screen. This completely eliminates the "freeze" felt between tab navigation.

### Solution E: Memory-first Query Caching
For the React Query indexedDB hydration, offload the deserialization to a Web Worker, or only hydrate essential keys (`currentUser`, `globalSettings`) blocking the render, and lazily hydrate large datasets (`trades`, `symbols`) in the background after the initial paint. 

---
*End of Report*
