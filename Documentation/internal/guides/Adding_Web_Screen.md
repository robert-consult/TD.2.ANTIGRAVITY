---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/App.tsx
  - client/src/AuthenticatedShell.tsx
  - client/src/lib/lazyWithPing.ts
  - client/src/lib/dashboardUrlState.ts
  - client/src/pages/
last_verified: 2026-03-27
status: maintained
---

# Adding A Web Screen

Current routing shape:

- `client/src/App.tsx` owns the unauthenticated shell
- `client/src/AuthenticatedShell.tsx` owns authenticated routes
- screen modules are lazy-loaded with `lazyWithPing`

Recommended workflow:

1. add the page under `client/src/pages/`
2. wire it through `lazyWithPing`
3. mount it in the correct shell
4. connect route-state handling if it participates in dashboard state
5. add or reuse hooks from `client/src/hooks/` and `client/src/lib/`
6. verify loading, auth behavior, and live-update interactions

Current repo-specific expectations:

- do not introduce a parallel screen system outside `App.tsx` and `AuthenticatedShell.tsx`
- prefer existing route-state helpers over ad hoc query-string handling
- keep quote-heavy screens render-efficient
- if the screen depends on live state, verify it works with the existing `client/src/live/` providers
