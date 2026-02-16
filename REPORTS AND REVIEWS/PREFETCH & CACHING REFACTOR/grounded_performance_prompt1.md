# Slow-4G Performance Optimization — Grounded Architecture Prompt

> **Repo:** `TD.2.ANTIGRAVITY` (TradeQuip)
> Grounded in real codebase analysis: all file paths, modules, hooks, and patterns reference the actual repo.

---

## Role & Objective

Act as a **Senior Full-Stack Architect** and **Performance Engineer**. Optimize the existing **TradeQuip** trading application for extreme performance on **Slow 4G networks** (high-latency, low-bandwidth). The application must achieve an "instant load" feel via aggressive prefetching, an App Shell Architecture, and secure local caching.

---

## Current Tech Stack (Verified)

| Layer | Technology | Key Files |
|---|---|---|
| **Runtime** | Node.js + TypeScript 5.9 | [tsconfig.json](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/tsconfig.json) |
| **Server** | Express 5, single port 5000 | [server/index.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/index.ts) |
| **Database** | PostgreSQL via Drizzle ORM | [shared/schema.pg.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/shared/schema.pg.ts) |
| **Cache/PubSub** | Valkey (Redis-compatible) | [server/services/valkey.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/services/valkey.ts) |
| **Frontend** | React 19, Vite 7, wouter routing | [client/src/App.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/App.tsx) |
| **State** | Tanstack Query (`staleTime: Infinity`) | [client/src/lib/queryClient.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryClient.ts) |
| **Real-time** | WebSocket (`ws` library), custom protocol | [shared/ws/protocol.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/shared/ws/protocol.ts) |
| **Styling** | TailwindCSS 4, Radix UI, Framer Motion | [tailwind.config.cjs](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/tailwind.config.cjs) |
| **Bundling** | Vite with esbuild prod bundle, Brotli/gzip precompression | [server/vite.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/vite.ts) |
| **Mobile** | Capacitor 8 (Android/iOS) | [MOBILE/](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/MOBILE) |
| **Security** | CSRF, bot-proof PoW, identity headers, E2EE (Web Crypto API) | [client/src/lib/e2ee.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/e2ee.ts) |

---

## Existing Architecture You Must Integrate With

### Route Map (wouter `Switch/Route` in App.tsx)

| Route | Component | Loading Strategy |
|---|---|---|
| `/` | `Dashboard` → tab-based SPA shell | `lazyWithPing` (React.lazy wrapper) |
| `/login` | `LoginPage` | `lazyWithPing` |
| `/admin` | `AdminDashboard` | `lazyWithPing` |
| `/journal` | `JournalPage` | `lazyWithPing` |
| `/profile` | `ProfileSettings` | `lazyWithPing` |
| `/partner` | `PartnerPortal` | `lazyWithPing` |
| `/verify-email` | `VerifyEmail` | `lazyWithPing` |

### Dashboard Tab Panels (in [Dashboard.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/pages/Dashboard.tsx))

These are the **primary trader-facing tabs** that must load instantly:

| Tab Key | Component | Bundle Size | Description |
|---|---|---|---|
| `quotes` | `QuotesScreen` | 16 KB | Live forex/instrument quotes grid |
| `chart` | `ChartScreen` | 27 KB | TradingView-style chart |
| `trade` | `TradeScreen` | **106 KB** | Order form, open positions, margin |
| `history` | `HistoryScreen` | 46 KB | Closed trades history + analytics |
| `leaderboard` | `LeaderboardScreen` | 17 KB | Rankings |
| `account` | `AccountScreen` | 31 KB | Account details, equity, margin |

> All 6 tab panels use `lazyWithPing(() => import("./XScreen"))` — meaning they are code-split and fetched on-demand only when the user navigates to them. **This is the core bottleneck on slow networks.**

### Provider Hierarchy (App.tsx)

```
QueryClientProvider (Tanstack Query, staleTime: Infinity)
  └── AuthProvider (session, user object, CSRF)
       └── I18nProvider (locale bundles)
            └── LiveUpdatesProvider (singleton WebSocket connection)
                 └── QuotesProvider (WS quote streaming + HTTP poll fallback)
                      └── AppRoutes (wouter Switch)
```

### Live Data Layer

| Module | File | What It Does |
|---|---|---|
| `LiveUpdatesProvider` | [live/LiveUpdatesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/LiveUpdatesProvider.tsx) | Singleton WebSocket via `useWebSocket` hook, pub/sub listener pattern for all real-time messages |
| `QuotesProvider` | [live/QuotesProvider.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/QuotesProvider.tsx) | WS-driven quote streaming (`quotes:subscribe`, `quotes:update`, `quotes:snapshot`), adaptive flush intervals via `perfHints`, HTTP poll fallback via Tanstack Query |
| `ConfigSync` | [live/ConfigSync.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/ConfigSync.tsx) | Invalidates Tanstack Query caches on WS events: `symbols:updated`, `global-settings:updated`, `system-config:updated`, `challenges:updated` |
| `AccountSummarySync` | [live/AccountSummarySync.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/live/AccountSummarySync.tsx) | Syncs equity/balance/margin from `/api/account/summary` into AuthContext |

### WebSocket Protocol (shared/ws/protocol.ts)

```typescript
// Real-time message types already defined:
WS_MSG_AUTH_HELLO          // "auth:hello"
WS_MSG_QUOTES_SUBSCRIBE   // "quotes:subscribe"  
WS_MSG_QUOTES_UPDATE      // "quotes:update"     ← live tick data
WS_MSG_QUOTES_SNAPSHOT     // "quotes:snapshot"   ← full state on connect
WS_MSG_TRADES_UPDATE       // "trades:update"     ← open position P/L
WS_MSG_ACCOUNT_UPDATE      // "account:update"    ← equity/margin
WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED  // symbol config changes
```

### Existing Performance Infrastructure

| Module | File | What It Already Does |
|---|---|---|
| `perfHints` | [lib/perfHints.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/perfHints.ts) | Detects `navigator.connection.effectiveType` (slow-2g/2g/3g/4g), `saveData`, RTT, downlink, device memory. Returns `isConstrained` flag. Already used to adapt poll intervals and WS reconnect backoff. |
| `lazyWithPing` | [lib/lazyWithPing.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/lazyWithPing.ts) | Wraps React.lazy with a "ping" notification to force Suspense boundaries to re-render when chunks resolve. |
| `serveStatic` | [server/vite.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/vite.ts) | Serves precompressed Brotli/gzip assets. Assets under `/assets/` get `Cache-Control: public, max-age=31536000, immutable`. |
| `e2ee.ts` | [lib/e2ee.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/e2ee.ts) | **Already uses Web Crypto API** with AES-256-GCM + RSA-OAEP-SHA256 for mailbox message encryption. Currently stores keys in `localStorage`, not IndexedDB. |

### Server-Side Quote Pipeline

```
Valkey (q:v1:{SYMBOL})  →  quoteHub.ts (in-memory Map)  →  WebSocket fanout  →  QuotesProvider (client)
                         →  /api/quotes/latest (HTTP fallback)
```

---

## Key Requirements

### 1. Aggressive Route Prefetching Strategy

**The Problem:** All 6 Dashboard tabs (`QuotesScreen`, `ChartScreen`, `TradeScreen`, `HistoryScreen`, `LeaderboardScreen`, `AccountScreen`) are code-split via `lazyWithPing`. On Slow 4G (~400ms RTT, ~1.5 Mbps), navigating to a new tab triggers a network round-trip for the chunk, causing 1–3 second delays.

**The Solution:**

- **Trigger:** Immediately after successful authentication (when `isAuthenticated` becomes `true` in `AuthProvider`), silently prefetch **all 6 Dashboard tab chunks** in the background.
- **Also prefetch** the top-level route chunks: `JournalPage`, `ProfileSettings`, `PartnerPortal`.
- **Prioritization:** Prefetch in order of likely usage: `QuotesScreen` → `TradeScreen` → `ChartScreen` → `HistoryScreen` → `AccountScreen` → `LeaderboardScreen` → secondary routes.
- **Respect `perfHints.isConstrained`:** If on a severely constrained network (2G/slow-2G or `saveData`), defer non-critical chunks and only prefetch the first 3 tabs.
- **Implementation:** Create `client/src/lib/routePrefetch.ts` — a utility that calls `import()` for each chunk with `requestIdleCallback` scheduling. Wire it into `AppRoutes` in `App.tsx` via a `useEffect` guarded by `isAuthenticated`.

### 2. Secure "Offline-First" Caching (Encrypted IndexedDB)

**The Problem:** The existing `e2ee.ts` uses `localStorage` for key material, which is synchronous, has a 5–10MB limit, and blocks the main thread. Static assets and user state are not cached locally at all — every fresh load fetches everything from the server.

**The Solution:**

- **Storage:** Use **IndexedDB** (via a thin wrapper) to store:
  - App Shell HTML/CSS/JS asset hashes for cache validation
  - Tanstack Query cache snapshots (serialized query data for `/api/config/symbols`, `/api/account/summary`, `/api/global-settings`, `/api/quote-subscriptions/allowed-symbols`)
  - User preferences + settings (language, timezone, lot presets)
- **Encryption:** Extend the existing `e2ee.ts` Web Crypto infrastructure:
  - Create a new module `client/src/lib/secureCache.ts` that uses **AES-256-GCM** (already proven in `e2ee.ts`) to encrypt/decrypt cached data Blobs before writing to/reading from IndexedDB.
  - Derive the encryption key from the user's session token or a PBKDF2-derived key stored in the `CryptoKey` API (non-extractable).
  - This protects cached financial data (balances, positions, trade history) even if the device is physically compromised.
- **Migration:** Move the existing `localStorage`-based E2EE key storage (`tq.mailbox.e2ee.v1.*`) to IndexedDB as well, within `secureCache.ts`.

### 3. App Shell Architecture (Static vs. Dynamic Split)

**The Problem:** Currently, the entire app re-renders and re-fetches on every cold load. The `Dashboard.tsx` layout (Header, SideNavigation, MobileNavigation, AppShell) must re-download even though it's structurally static.

**The Solution:**

| Data Class | Source | Cache Strategy |
|---|---|---|
| **App Shell** (layout, nav, tab bar, CSS) | Vite bundle | Service Worker `cache-first` with stale-while-revalidate |
| **Static Config** (symbols, global settings, lot presets) | `/api/config/symbols`, `/api/global-settings` | Encrypted IndexedDB, revalidate on WS `symbols:updated` / `global-settings:updated` events from `ConfigSync.tsx` |
| **User State** (balance, equity, margin, free margin) | `/api/account/summary` | Encrypted IndexedDB snapshot, rapidly updated by WS `account:update` via `AccountSummarySync.tsx` |
| **Live Quotes** (bid, ask, price, spread) | WS `quotes:update` / `quotes:snapshot` | In-memory only (via `QuotesProvider` `quotesRef` Map) — never cache stale prices |
| **Trade Data** (open positions, P/L) | WS `trades:update` + `/api/trades/open` | Encrypted IndexedDB for last-known state; overlay with live WS updates |
| **Notifications** | `/api/notifications` | Fetch on-demand, no cache |

**Implementation:**

- Create a **Service Worker** (`client/public/sw.ts` or `client/src/sw.ts`) that:
  - Intercepts `/assets/*` requests and serves from Cache API (already immutable per `server/vite.ts` headers)
  - Intercepts `index.html` and serves cached App Shell, then background-refreshes
  - Does **NOT** intercept `/api/*` or `/ws` requests — those always hit the network
- Integrate with the existing Vite build pipeline (`vite.config.ts`) using `vite-plugin-pwa` or a manual approach
- Register the Service Worker in `client/src/main.tsx`

### 4. Hybrid State Merging

**The Problem:** On cold load over Slow 4G, the user sees a loading spinner (`FullScreenLoading`) for 2–5 seconds while `AuthProvider`, symbols, and quotes are all fetched serially.

**The Solution:**

- On app init, **immediately** read the encrypted IndexedDB cache for:
  1. User session state (last known auth user object)
  2. Symbol configs (`/api/config/symbols` snapshot)
  3. Account summary (balance, equity, margin)
- Render the App Shell with this cached data instantly (showing last-known values with a subtle "updating..." badge)
- In parallel, establish WebSocket connection and fire API revalidation requests
- As fresh data arrives (via WS or HTTP), **merge** it into the rendered state:
  - `ConfigSync.tsx` already invalidates query caches on WS events — leverage this
  - `AccountSummarySync.tsx` already patches the auth context with fresh balances
  - `QuotesProvider.tsx` already replaces the quote map on `quotes:snapshot`

---

## Implementation Deliverables

### Files to Create

| File | Purpose |
|---|---|
| `client/src/lib/secureCache.ts` | IndexedDB encrypted cache utility (AES-256-GCM via Web Crypto API) |
| `client/src/lib/routePrefetch.ts` | Background prefetcher for all route chunks, respects `perfHints` |
| `client/src/sw.ts` | Service Worker — cache-first for shell assets, network-first for API |
| `client/src/lib/queryPersistence.ts` | Tanstack Query cache persistence adapter (serialize → encrypt → IndexedDB) |

### Files to Modify

| File | Changes |
|---|---|
| `client/src/App.tsx` | Add `routePrefetch` trigger after authentication, register Service Worker |
| `client/src/main.tsx` | Register Service Worker on app bootstrap |
| `client/src/lib/e2ee.ts` | Migrate key storage from localStorage → IndexedDB via `secureCache` |
| `client/src/lib/queryClient.ts` | Wire up `queryPersistence` hydration on init |
| `client/src/live/QuotesProvider.tsx` | On init, load cached symbol names from IndexedDB before WS connects |
| `client/src/live/AccountSummarySync.tsx` | On init, hydrate from IndexedDB; display cached values with "stale" badge |
| `client/src/pages/Dashboard.tsx` | Remove individual `lazyWithPing` for tabs (prefetcher handles it), add stale-data indicator |
| `vite.config.ts` | Add Service Worker build configuration |
| `server/vite.ts` | Ensure SW is excluded from SPA fallback catch-all |

---

## Verification Plan

### Automated Testing
- Chrome DevTools → Network Throttling → "Slow 4G" preset
- Lighthouse Performance audit targeting > 90 on throttled connection
- Measure Time to Interactive (TTI) and First Contentful Paint (FCP) before/after
- Tab navigation latency: measure from click to render for all 6 Dashboard tabs

### Manual Verification
- Cold load with empty cache on Slow 4G: App Shell renders in < 1.5s
- Tab switch (e.g., Quotes → Trade) completes in < 100ms after prefetch
- Disable network entirely → verify cached Shell + last-known data renders
- Inspect IndexedDB in DevTools → verify all stored blobs are AES-encrypted
- Re-enable network → verify WS reconnects and fresh data merges seamlessly
