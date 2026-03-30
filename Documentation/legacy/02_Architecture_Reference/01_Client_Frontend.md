# Client Frontend Architecture

> **Diátaxis quadrant:** Reference
> **Sources:** `client/AGENTS.md`, `.agents/performance.md`, `design_guidelines.md`

---

## Technology Stack

- **Framework:** React 18 with TypeScript
- **Bundler:** Vite (HMR in dev, production build with manual chunks)
- **Styling:** Tailwind CSS + shadcn/ui primitives (48 components)
- **State:** TanStack React Query (server state) + local React state
- **Routing:** Wouter (lightweight client-side routing)
- **i18n:** i18next with DB-backed translations
- **PWA:** Service worker for shell caching and critical chunk pre-cache

---

## Key Entrypoints

| File | Purpose |
|---|---|
| `client/src/main.tsx` | React bootstrap, query persistence setup |
| `client/src/App.tsx` | Root router, auth guards, provider tree |
| `client/src/AuthenticatedShell.tsx` | Post-auth layout with route pages |
| `client/src/index.css` | Global styles (Tailwind base) |
| `client/src/sw.ts` | Service worker (shell cache, chunk pre-cache) |

---

## Component Hierarchy

```
App
├── QueryClientProvider
│   └── AuthProvider
│       └── I18nProvider
│           ├── MobileWrapperBridge     (Capacitor bridge activation)
│           ├── AppRoutes
│           │   ├── LoginPage           (unauthenticated)
│           │   ├── VerifyEmail         (unauthenticated)
│           │   └── AuthenticatedShell  (authenticated)
│           │       ├── Dashboard
│           │       ├── TradeScreen
│           │       ├── HistoryScreen
│           │       ├── AdminDashboard
│           │       ├── PartnerPortal
│           │       └── ... (24 pages total)
│           └── Toaster
```

---

## Startup Performance Model

TradeQuip uses a quote-first readiness approach:

1. **Immediate WS handshake** — quote WebSocket connects during bootstrap
2. **Tiered prefetch** — routes and data pre-fetched based on network tier (`INSTANT` → `MINIMAL`)
3. **In-flight dedup** — prevents duplicate startup fetches
4. **Encrypted persistent cache** — user-scoped, purged on logout

Key files:
- `client/src/lib/startupDataPrefetch.ts`
- `client/src/lib/routePrefetch.ts`
- `client/src/lib/perfHints.ts`
- `client/src/lib/queryPersistence.ts`
- `client/src/live/QuotesProvider.tsx`
- `client/src/live/ConfigSync.tsx`

---

## Performance Rules

> Also see `.agents/performance.md` for the full checklist.

- Avoid unnecessary re-renders on quote-heavy screens (memoize selectors)
- Prefer delta updates for live data; avoid replacing entire arrays per tick
- Keep charting/table rendering efficient (virtualize large lists)
- Treat `/ws` payload size as a first-class constraint
- SW must never cache `/api/*` or `/ws`

---

## Related Pages

- [Adding a Web Screen →](../01_Development_Guides/00_Adding_Web_Screen.md)
- [WebSocket Protocol →](05_WebSocket_Protocol.md)
- [Server Backend →](02_Server_Backend.md)
