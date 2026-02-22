# Partner Portal & Scout System Audit Report

**Date:** 2026-02-21
**Objective:** Comprehensive diagnostic audit based on the 5-part Research Reports taxonomy.

## 1. Frontend & State Management
*(Focus: React 18 Lifecycle, Hooks, Concurrent Rendering, TypeScript, TanStack Query, Zod)*

### 1.1 Partner Portal (`PartnerPortal.tsx`)
- **Missing Zod Validation & Coercion:** API responses are cast directly to TypeScript interfaces (e.g., `axios.get(...).then(r => r.data as SimulationPreviewResp)`) bypassing Zod entirely. If the backend changes, the app will crash at runtime with `TypeError: Cannot read properties of null` instead of failing gracefully at the network boundary.
- **Type Escape Hatches (`any`):** Multiple `any` escape hatches block TypeScript's strict mode, especially in mutation `onError` handlers: `onError: (error: any) => { ... }` (lines 562, 718, 787, 813, 837). Another egregious cast is `user as any` on line 726 (`const nextName = prev.senderName || String((user as any)?.name || "").trim();`).
- **Potential Render Waterfalls:** `useQueries` depend on `partnerKey` which only resolves after `redeemInvite` or input. Multiple queries fire `enabled: keyReady` concurrently. However, `inquiryRecipientsQuery` and `inquiriesQuery` both wait on `keyReady` but no prefetching is used, which might lead to slight delays, although they fire in parallel.
- **Missing Error Boundaries:** The component is not wrapped in an Error Boundary. If an API returns malformed data (due to the missing Zod boundary), `PartnerPortal` will unmount the entire dashboard.

### 1.2 Scout System (`ScoutWorkbench.tsx`)
- **Missing Zod Validation:** Same issue as PartnerPortal. `axios.get(...).then(r => r.data)` is used for all queries (e.g., `candidatesQuery`, `watchlistQuery`) without Zod validation.
- **Type Escape Hatches (`any`):** Similar `any` abuse in mutation `onError` blocks (lines 583, 607, 647, 668, 686, 719).
- **Stale Closure / Effect Races:** `useEffect` block at line 469 sets `crmDrafts` from `watchlistQuery.data?.rows`. As the array references from `tanstack-query` update, this overwrites user-edited drafts if a background refetch completes. Users typing into a draft just as a background polling refetches will have their inputs wiped!
- **Missing Error Boundaries:** No `<ErrorBoundary>` wrapping feature areas.

## 2. Network & Transport
*(Focus: WebSocket, HTTP, CORS, DNS, TLS)*

### 2.1 Partner Routing & APIs (`partnerPortal.ts`)
- **Missing API Rate Limits / Thundering Herd Prevention:** Sensitive endpoints like `POST /invite/redeem` (line 57) do not have explicit rate limiting to prevent brute-forcing `token` hashes or overwhelming the DB with `sha256Hex(token)` computations.
- **TLS Downgrade Risk:** A utility function `isSecurePartnerTransport` exists (line 381) to check for HTTPS, but the endpoint handlers themselves (like `/data-room` or `/onboarding/profile`) do not explicitly enforce it or reject HTTP requests, relying entirely on upstream infrastructure. If the LB allows HTTP, the API serves it.
- **No Request Batching/Deduplication:** High volume routes like `/tear-sheet/:hashId` execute heavy SQL queries for metrics and top trades. Without caching or deduplication, simultaneous requests will crater Postgres performance.

### 2.2 Scout Routing & APIs (`adminScout.ts`, `scoutService.ts`)
- **Missing Offset Pagination Bounds:** `parseOffset` simply ensures offset >= 0, but there's no hard cap on offset. For large tables, an attacker could request `offset=100000000`, causing a massive Seq Scan in Postgres.
- **Lack of Idempotency on Mutations:** Overriding pipeline or creating partner API keys (`POST /api/admin/partners`) has no idempotency key. A network hiccup (client sending twice) could create duplicate partners or override a state incorrectly.

## 3. Storage, Caching & Offline
*(Focus: IndexedDB, Service Worker, Cache API, Web Locks)*

### 3.1 Partner Portal & Secure Cache (`secureCache.ts`)
- **Persistent Crypto Keys:** `secureCache.ts` uses `localStorage.setItem(SEED_STORAGE_KEY, generated)` to permanently persist the entropy seed (`randomSeedHex(32)`). Since the key is derived from this seed + a static scope, any XSS can steal the seed from `localStorage` and decrypt the entire cache structure. The seed should be session-bound or wrapped by a server-provided key.
- **Quota Exceeded Silent Failure / No LRU:** The `put()` method wraps the IDB write in a try/catch, but only explicitly handles `SECURE_CACHE_ENTRY_TOO_LARGE`. `QuotaExceededError`s will fail silently. There is no LRU eviction logic; the cache will grow until the disk is full and then silently stop accepting new elements, causing Optimistic UI features to silently roll back.
- **Good Pattern Found:** IndexedDB Transaction Auto-Commit bug is successfully avoided. The transaction is properly created *after* the `await crypto.subtle.encrypt` finishes preventing the `TransactionInactiveError`.

### 3.2 Service Worker (`sw.ts`)
- **Stale-While-Revalidate without Reload Prompt:** The `sw.ts` script aggressively calls `self.skipWaiting()` and `self.clients.claim()`. While this prevents the "Eternal Waiting" problem, it causes new service workers to hijack active pages immediately. If the new JS assets expect a different DOM structure than the currently loaded `index.html`, it will cause runtime errors. There doesn't appear to be a `controllerchange` listener prompting the user to reload.

## 4. Security & Cryptography
*(Focus: XSS, CSRF, CSP, Supply Chain, Cookies, Clickjacking, Typescript Scape Hatches)*

### 4.1 Partner Portal & Scout Systems
- **React XSS (URI Injection):** No `href={variable}` or `<a href...>` tag vulnerabilities found in `PartnerPortal.tsx` or `ScoutWorkbench.tsx`.
- **dangerouslySetInnerHTML:** A global search confirmed 0 instances across the `client/src` directory, meaning XSS via raw HTML injection is fully mitigated in these components.
- **ReDoS (Zod Validation):** The Zod regex schemas in `adminScout.ts` and `partnerPortal.ts` were reviewed (e.g. `EMAIL_PATTERN`, `PHONE_EXTENSION_PATTERN`, `^[a-z0-9-_]+$`). They all use strict start/end anchors (`^...$`) without problematic nested quantifiers (like `(a+)+`), avoiding ReDoS vulnerabilities.
- **CSRF & Authentication:** The `adminScout` API uses cookie-based sessions (implied by `req.user`). If `SameSite` isn't strictly enforced on the session or API, the lack of explicit CSRF tokens on administrative mutations (e.g., overriding challenge results) leaves the system vulnerable to cross-site request forgery, especially since `ScoutWorkbench` allows powerful state overrides.

## 5. Build Tooling & Environment
*(Focus: Vite, Rollup, TypeScript, Docker/WSL, CI/CD)*

### 5.1 Vite Configuration (`vite.config.ts`) & Source (`package.json`)
- **Dynamic Import Failures:** The application uses code splitting via `React.lazy` (wrapped in `lazyWithPing`). However, `lazyWithPing.ts` does not implement any `.catch()` logic to force a `window.location.reload()` if the chunk fails to load. If a deployment happens while a user is on the site, navigating to a new route will result in a `ChunkLoadError` and a frozen white screen.
- **Docker / WSL Path Normalization:** Successfully mitigated. `vite.config.ts` correctly normalizes paths using `id.replace(/\\/g, "/")` during the `manualChunks` execution, ensuring Windows paths do not break chunking outputs.
- **Source Map Exposure:** Successfully mitigated. Build configuration explicitly relies on default settings which disable source maps in production, protecting the application's source code and inner workings.
- **Environment Variable Leaks:** `vite.config.ts` safely passes only `__TQ_BUILD_HASH__` to the client. Back-end secrets defined in `.env` are passed strictly to the Node/Express execution layer and excluded from the Vite bundle. However, the `package.json` relies on raw injection of heavily sensitive API keys directly via the CLI in the `start:e2e` scripts, which could be logged by APM tools if the process faults.

## 6. Priority Recommendations & Remediation Plan

### 6.1 Frontend & State Management
- **Implement Strict Zod Boundaries:** Wrap all `axios` calls in a service layer that safely parses responses through Zod schemas (e.g., `simulationPreviewSchema.parse(response.data)`). This ensures the app fails early with clear validation errors rather than unpredictable `TypeError` exceptions deep in the UI.
- **Eliminate `any` Types:** Review all `useMutation` hooks and replace `(error: any)` with strict type checking (e.g., using AxiosError type guards). Provide a centralized utility for safely extracting error messages from API responses.
- **Introduce Global Error Boundaries:** Wrap key sections of the Partner Portal and Scout Workbench in React `<ErrorBoundary>` components with meaningful fallback UIs. This prevents a single malformed API response from unmounting the entire dashboard and provides users with a way to recover (retry button).

### 6.2 Network & Transport
- **Enforce Offset Limits:** Update `parseOffset` in server utility files to accept and enforce a hard cap (e.g., `Math.min(parsedOffset, 1000)`). For tables requiring deep pagination, transition to cursor-based pagination to prevent performance degradation and CPU starvation attacks on the Postgres database.
- **Implement Rate Limiting:** Add `express-rate-limit` middleware specifically to sensitive routes like `POST /invite/redeem` (e.g., max 5 attempts per 15 minutes per IP) to prevent brute-forcing and CPU exhaustion from hashing functions.
- **Add Mutation Idempotency:** Require an `X-Idempotency-Key` header for critical mutations originating from the Scout Workbench (e.g., pipeline overrides). The backend should store and verify these keys (using Redis or DB) to guarantee that network retries do not result in duplicated state or actions.

### 6.3 Storage, Caching & Offline
- **Session-Bound Encryption:** Refactor `secureCache.ts` to derive its encryption key from a short-lived session token or memory-only variable rather than a persistent `SEED_STORAGE_KEY` in `localStorage`. If `localStorage` must be used, clear the root seed violently upon explicit user logout or session expiration.
- **Implement LRU Cache Eviction:** Upgrade the IndexedDB logic in `secureCache.ts` to track entry sizes and last-accessed timestamps. Catch `QuotaExceededError` explicitly and run an eviction cycle that removes the oldest 20% of the cache before retrying the failed `put()` operation.
- **Safe Service Worker Updates:** Modify `sw.ts` to remove the immediate `skipWaiting()` call on install. Instead, implement a message listener that allows the frontend to orchestrate the update. When a new service worker is detected, display a "New version available" toast to the user, and only call `skipWaiting()` when the user clicks 'Reload', preventing DOM/asset mismatch crashes.

### 6.4 Security & Cryptography
- **Strict SameSite Cookie Enforcement:** Verify that the `express-session` initialization in the backend hardcodes `cookie: { sameSite: 'strict', secure: true, httpOnly: true }`. 
- **Implement Anti-CSRF Tokens:** Even with SameSite cookies, add a Synchronizer Token Pattern (CSRF Token) for administrative endpoints in the Scout system. The frontend should fetch a token on initial load and include it in the `X-CSRF-Token` header for all `POST`, `PUT`, and `DELETE` requests to ensure that actions cannot be forged cross-site.

### 6.5 Build Tooling & Environment
- **Resilient Dynamic Imports:** Update `lazyWithPing.ts` to wrap the dynamic import Promise with a `.catch()`. If the chunk fails to load natively (e.g. `ChunkLoadError` post-deployment), the catch block should trigger `window.location.reload(true)` to force the browser to fetch the latest `index.html` and resolve the new chunk hashes.

---
*Audit & Recommendations Complete.*
