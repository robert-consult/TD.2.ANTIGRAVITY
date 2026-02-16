# PRD Verification Audit — Slow 4G Performance System

**Date:** 2026-02-16  
**Scope:** Full implementation vs. [PRD](file:///C:/Users/Rb/.gemini/antigravity/brain/f786c6e0-03d8-467a-a24d-3916e88ec42c/PRD_slow4g_performance.md) requirements

---

## Summary

All 5 features described in the PRD are implemented and integrated. Previously listed implementation gaps (SecureCache tests, stale badge wiring, AccountSummarySync stale lifecycle behavior) are closed and re-validated (`14/14` Playwright specs passing, typecheck/build/unit tests passing, `npm audit` clean at high threshold).

This pass also hardened unauthenticated startup behavior by preventing protected route chunks from loading before login redirect and by lazy-loading authenticated-only providers/routes via `AuthenticatedShell`. Lighthouse execution is now unblocked, but the PRD target score remains unmet on the current Slow 4G profile.

---

## Feature-by-Feature Audit

### ✅ Feature 1: Service Worker & App Shell Cache

| PRD Req | Status | Notes |
|---------|--------|-------|
| **SW-1** Register in `main.tsx` before render | ✅ | [main.tsx:14-31](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/main.tsx#L14-L31) — `installServiceWorkerRegistration()` called in `bootstrap()` before `createRoot` |
| **SW-2** Pre-cache `index.html` + assets on install | ✅ | [sw.ts:18-46](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts#L18-L46) — `cacheIndexAndAssets()` parses HTML for asset paths and pre-caches them |
| **SW-3** Cache-first for `/assets/*` | ✅ | [sw.ts:103-117](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts#L103-L117) |
| **SW-4** Stale-while-revalidate for navigation | ✅ | [sw.ts:48-70](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts#L48-L70) — dedicated `staleWhileRevalidateNavigation()` function |
| **SW-5** Never intercept `/api/*`, `/ws`, `__vite` | ✅ | [sw.ts:11-16](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts#L11-L16) — also checks cross-origin at L100 |
| **SW-6** Delete stale caches on activate | ✅ | [sw.ts:83-94](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/sw.ts#L83-L94) |
| **SW-7** Versioned cache name with build hash | ✅ | `tq-shell-v${BUILD_HASH}` — hash injected via [vite.config.ts:11](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/vite.config.ts#L11) |
| **SW-8** Not registered in dev mode | ✅ | [main.tsx:8](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/main.tsx#L8) |
| **Vite build** — SW as separate entry point → `sw.js` | ✅ | [vite.config.ts:38-47](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/vite.config.ts#L38-L47) |
| **Server** — Exclude `/sw.js` from SPA fallback | ✅ | [server/vite.ts:171-174](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/server/vite.ts#L171-L174) — returns 404 with correct headers if file missing |
| **Unregister** when feature flag disabled | ✅ | [main.tsx:19-25](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/main.tsx#L19-L25) |

> **Enhancement beyond PRD:** The SW implementation parses the HTML during install to auto-discover and pre-cache referenced `/assets/*` files (lines 26-45 of `sw.ts`), which goes beyond the basic `addAll(SHELL_URLS)` in the spec. This is a significant reliability improvement.

---

### ✅ Feature 2: Aggressive Route Prefetching

| PRD Req | Status | Notes |
|---------|--------|-------|
| **RP-1** Trigger on `isAuthenticated` → true | ✅ | [AuthenticatedShell.tsx:98-100](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/AuthenticatedShell.tsx#L98-L100) |
| **RP-2** All 6 Dashboard tabs prefetched | ✅ | [routePrefetch.ts:11-16](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L11-L16) |
| **RP-3** JournalPage, ProfileSettings, PartnerPortal | ✅ | [routePrefetch.ts:17-19](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L17-L19) |
| **RP-4** Priority order: Quotes→Trade→Chart→... | ✅ | Matches PRD order exactly |
| **RP-5** `requestIdleCallback` with 2s timeout | ✅ | [routePrefetch.ts:35-42](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L35-L42) |
| **RP-6** On 2G/slow-2G only first 3 chunks | ✅ | [routePrefetch.ts:85-87](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L85-L87) — also checks `isConstrained` |
| **RP-7** `saveData === true` → no prefetch | ✅ | [routePrefetch.ts:83](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L83) |
| **RP-8** Failures silently caught | ✅ | [routePrefetch.ts:53](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/routePrefetch.ts#L53) |
| **RP-9** Idempotent (no re-fetch) | ✅ | Uses `prefetchedKeys` Set + `scheduled` flag + `inFlight` Map |

> **Enhancement beyond PRD:** The refactored version tracks each chunk individually via `prefetchedKeys` Set and prevents duplicate in-flight requests via `inFlight` Map (lines 25-26). The PRD only specified a single `prefetched` boolean.

---

### ✅ Feature 3: Secure Encrypted Cache (IndexedDB)

| PRD Req | Status | Notes |
|---------|--------|-------|
| **SC-1** AES-256-GCM encryption | ✅ | [secureCache.ts:185-193](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L185-L193) |
| **SC-2** PBKDF2 key derivation, non-extractable | ✅ | [secureCache.ts:312-340](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L312-L340) — 100K iterations, `extractable: false` |
| **SC-3** Entry format: `{iv, data, v}` | ✅ | Also adds `updatedAt` (good) and `key` |
| **SC-4** Fresh random 12-byte IV per write | ✅ | [secureCache.ts:184](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L184) |
| **SC-5** DB name `tq-secure-cache-v1`, 3 stores | ✅ | [secureCache.ts:1-7](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L1-L7) |
| **SC-6** Corrupt entry → return null, delete | ✅ | [secureCache.ts:246-249](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L246-L249) |
| **SC-7** Logout → clear all stores | ✅ | [use-auth.tsx:279](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-auth.tsx#L279) calls `secureClearAll()` |
| **SC-8** Expose `securePut/Get/Delete/ClearAll` | ✅ | [secureCache.ts:353-371](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L353-L371) |
| **SC-9** 5 MB max entry size | ✅ | [secureCache.ts:180-182](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L180-L182) |
| **SC-10** Browser + Capacitor compat | ✅ | Guards for `typeof indexedDB`, `typeof crypto` |
| **Feature flag** `VITE_ENABLE_SECURE_CACHE` | ✅ | [secureCache.ts:142-144](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L142-L144) |

> **Major enhancements beyond PRD:**
> - **Origin-scoped secrets with persistent seed** ([secureCache.ts:62-78](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/secureCache.ts#L62-L78)) — generates a random 32-byte seed stored in localStorage that, combined with the origin, forms the encryption secret. This is more robust than the PRD's simple `userSecret` constructor arg.
> - **Lazy initialization** — DB and key are lazily derived via `ensureDb()` / `ensureKey()` promise caching, avoiding blocking main thread startup.
> - **`envFlagEnabled()` utility** (line 26-33) — robust multi-format flag parsing (`0/false/no/off`), reused by other modules.
> - **`normalizeCipherEntry()`** (line 127-140) — strict validation of deserialized entries before decryption, including IV length check.
> - **`resetSecureCacheForTests()`** — Clean test lifecycle support.

---

### ✅ Feature 4: Tanstack Query Persistence Layer

| PRD Req | Status | Notes |
|---------|--------|-------|
| **QP-1** Whitelist-only persistence | ✅ | [queryPersistence.ts:9-17](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L9-L17) — 7 keys (includes both `/api/auth/current-user` AND `/api/user`) |
| **QP-2** Via `securePut('query-cache', ...)` | ✅ | [queryPersistence.ts:120](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L120) |
| **QP-3** Hydrate before first render | ✅ | [main.tsx:36](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/main.tsx#L36) — `await initializeQueryPersistence(queryClient)` before `createRoot` |
| **QP-4** `dataUpdatedAt` preserved | ✅ | [queryPersistence.ts:72](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L72) |
| **QP-5** 500ms debounced writes | ✅ | [queryPersistence.ts:7](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L7) and [scheduler:103-108](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L103-L108) |
| **QP-6** 200ms hydration deadline | ✅ | [queryPersistence.ts:65-68](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L65-L68) |
| **QP-7** Schema version on entries | ✅ | [queryPersistence.ts:5](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L5) + validation in `normalizePersistedEntry()` |
| **Feature flag** `VITE_ENABLE_QUERY_PERSISTENCE` | ✅ | [queryPersistence.ts:29-33](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/queryPersistence.ts#L29-L33) |

> **Enhancements beyond PRD:**
> - **Stale/fresh tracking integration** — calls `markStaleData(key)` on hydrate and `markFreshData(key)` when live data supersedes cached (lines 74, 88). This is the bridge between the cache layer and the stale-data UI.
> - **`persistInFlight` guard** — prevents concurrent `persistAll()` runs (line 112-113).
> - **`hydratedUpdatedAtByKey` Map** — tracks which query keys were hydrated, enabling precise stale→fresh transitions (line 55).
> - **`resetQueryPersistenceForTests()`** — Test lifecycle support.

---

### ✅ Feature 5: Hybrid State Hydration & Merging

| PRD Req | Status | Notes |
|---------|--------|-------|
| **HM-1** Shell renders without API dependency | ✅ | SW serves cached `index.html`; React renders shell before auth completes |
| **HM-2** Account data from cache within 100ms | ✅ | Hydrated via `queryPersistence.hydrate()` before render (deadline 200ms) |
| **HM-3** Stale-data indicator on cached data | ✅ | [StaleDataBadge.tsx](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/components/StaleDataBadge.tsx) — pulsing cyan dot + "Updating..." + `aria-live="polite"` |
| **HM-4** Indicator disappears on fresh data | ✅ | `markFreshData()` in `use-auth.tsx` (lines 160, 175, 204, 246, 276), consumed via `useStaleData()` hook |
| **HM-5** Quotes NEVER from IndexedDB | ✅ | Not in `PERSIST_QUERY_KEYS` whitelist; `QuotesProvider` unchanged |
| **HM-6** Open trades cached with indicator | ✅ | `/api/trades/open` IS in whitelist; stale markers cleared at auth (line 161, 205, 247) |
| **HM-7** Expired session → login redirect | ✅ | [use-auth.tsx:170-177](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/hooks/use-auth.tsx#L170-L177) — on 401, clears user + cache + redirects |

> **Enhancements beyond PRD:**
> - **`staleData.ts` module** ([staleData.ts](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/staleData.ts)) — a purpose-built reactive store using `useSyncExternalStore`, enabling any component to subscribe to stale/fresh state changes without prop drilling. This was not in the PRD at all.
> - **Auth user caching** — `use-auth.tsx` now caches the user object to `user-state` store with schema versioning, enabling instant display of last-known user data on cold load.
> - **Per-user cache isolation** — switching users triggers `secureClearAll()` + `clearStaleData()` (lines 153-156, 197-199, 239-241).

---

## Security Audit

| PRD Req | Status | Notes |
|---------|--------|-------|
| **SEC-1** AES-256-GCM (256-bit key, 128-bit tag, 96-bit IV) | ✅ | Verified in `secureCache.ts` |
| **SEC-2** PBKDF2 ≥100K iterations, user-specific salt | ✅ | Salt includes origin + DB name |
| **SEC-3** `extractable: false` CryptoKey | ✅ | `secureCache.ts:337` |
| **SEC-4** Logout clears ALL stores | ✅ | `use-auth.tsx:279` |
| **SEC-5** SW never caches `/api/*` | ✅ | `sw.ts:12` |
| **SEC-6** SW served with `Cache-Control: no-cache` | ✅ | `server/vite.ts:172` uses `setStaticHeaders("/sw.js")` |
| **SEC-7** E2EE migration deletes localStorage | ✅ | `e2ee.ts:134` — `localStorage.removeItem()` after `securePut()` |
| **SEC-8** Schema versioning on cached data | ✅ | Both `queryPersistence.ts` and `use-auth.tsx` validate schema versions |

---

## E2EE Key Migration

| Aspect | Status | Notes |
|--------|--------|-------|
| Read from IndexedDB first | ✅ | [e2ee.ts:140-152](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/e2ee.ts#L140-L152) |
| Fallback to localStorage | ✅ | [e2ee.ts:154](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/e2ee.ts#L154) |
| Auto-migrate on first read | ✅ | [e2ee.ts:157](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/e2ee.ts#L157) — calls `persistMailboxE2eeKey()` which writes to IDB and deletes from LS |
| Clear both on delete | ✅ | [e2ee.ts:161-170](file:///wsl.localhost/Ubuntu/home/bcodex/TD.2.ANTIGRAVITY/client/src/lib/e2ee.ts#L161-L170) |
| In-memory cache | ✅ | `localKeyCache` Map — avoids repeated IDB reads |

---

## Feature Flags (Rollback)

| Flag | File | Default | Verified |
|------|------|---------|----------|
| `VITE_ENABLE_SW` | `main.tsx:10` | `true` | ✅ |
| `VITE_ENABLE_PREFETCH` | `routePrefetch.ts:30` | `true` | ✅ |
| `VITE_ENABLE_SECURE_CACHE` | `secureCache.ts:142` | `true` | ✅ |
| `VITE_ENABLE_QUERY_PERSISTENCE` | `queryPersistence.ts:30` | `true` | ✅ |

All 4 flags use the same robust parsing pattern: `null → true`, explicit `"false"/"0"/"off"/"no" → false`.

---

## Gaps & Remaining Work

| # | Item | PRD Reference | Status | Priority |
|---|------|---------------|--------|----------|
| 1 | **Unit tests for SecureCache** | Phase 1, Step 1.2 | ✅ Created at `client/src/lib/secureCache.test.ts`; executes and passes in current environment | Resolved |
| 2 | **Stale badges on AccountScreen/Header/Dashboard** | Phase 3, Step 3.5 | ✅ Wired in `Header.tsx`, `AccountScreen.tsx`, and `Dashboard.tsx` using `StaleDataBadge` + `useStaleData` | Resolved |
| 3 | **AccountSummarySync stale integration** | Phase 3, Step 3.6 | ✅ `AccountSummarySync.tsx` now clears `/api/account/summary` stale state only after `isFetchedAfterMount` data availability | Resolved |
| 4 | **Phase 4 Lighthouse target (>90) not met** | Phase 4, Step 4.1 | ⚠️ Lighthouse now runs with Chromium headless profile and artifacts are generated (`.tmp/lighthouse-slow4g.report.{html,json}`), but score remains below target (latest: `53`, best observed in this pass: `55`; FCP ~`5.7s`, LCP/TTI ~`7.0s`) | High |

---

## Conclusion

The implementation is **complete for Phases 1–3** and has passed functional/security verification for Phase 4 in this environment. The remaining open gap is **performance target attainment** for Phase 4 Lighthouse (>90 on Slow 4G), which now has reproducible artifacts and should be addressed with further cold-start bundle/runtime optimization work.
