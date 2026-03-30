---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/App.tsx
  - client/src/AuthenticatedShell.tsx
  - client/src/lib/lazyWithPing.ts
  - client/src/lib/dashboardUrlState.ts
  - client/src/live/
  - client/src/pages/
last_verified: 2026-03-30
status: maintained
---

# Adding A Web Screen

## Current Routing Shape

- `client/src/App.tsx` owns the unauthenticated shell
- `client/src/AuthenticatedShell.tsx` owns authenticated routes
- screen modules are lazy-loaded with `lazyWithPing`

## Recommended Workflow

1. add the page under `client/src/pages/`
2. wire it through `lazyWithPing`
3. mount it in the correct shell
4. connect route-state handling if it participates in dashboard state
5. add or reuse hooks from `client/src/hooks/` and `client/src/lib/`
6. verify loading, auth behavior, and live-update interactions

## Repo-Specific Expectations

- do not introduce a parallel screen system outside `App.tsx` and `AuthenticatedShell.tsx`
- prefer existing route-state helpers over ad hoc query-string handling
- keep quote-heavy screens render-efficient
- if the screen depends on live state, verify it works with the existing `client/src/live/` providers

## Query And Dashboard State

- if the screen participates in the dashboard shell, reuse `client/src/lib/dashboardUrlState.ts`
- do not create a second URL-state convention for tab, symbol, or account-panel state
- keep auth redirects and public-route rules in `App.tsx` consistent with the rest of the app

## Repo-Grounded Example

```tsx
import { Route } from "wouter";
import { lazyWithPing } from "@/lib/lazyWithPing";
import { writeDashboardRouteState } from "@/lib/dashboardUrlState";

const ReportsPage = lazyWithPing(() => import("@/pages/ReportsPage"));

// AuthenticatedShell.tsx
<Route path="/reports" component={ReportsPage} />

// Dashboard-driven navigation keeps the existing URL-state contract.
writeDashboardRouteState({ tab: "trade", symbol: "EURUSD" });
```

## Verification

- `npm run check`
- `npm run build`
- if the screen changes auth, trading, or live update behavior, run `npm run e2e`
