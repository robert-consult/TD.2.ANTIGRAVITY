# `MOBILE/src/mobile/` AGENTS.md

## Scope
Bridge-only wrapper code for the Capacitor shells. This subtree is not allowed to become a second feature app.

## Source of truth
- UI, routes, and trader/support product behavior live in `client/`.
- This subtree exists to support native wrapper behavior: lifecycle, session checks, deep links, safe-area/native utilities, and push registration.

## Required alignment
- Keep route mapping aligned with:
  - `client/src/components/MobileWrapperBridge.tsx`
  - `client/src/lib/appNavigation.ts`
  - `client/src/lib/dashboardUrlState.ts`
- Keep mutation/session calls same-origin and CSRF-aware.
- Keep push payload fields aligned with `server/routes/pushDevices.ts`.

## Do not do
- Do not recreate deleted `components/*` shadow screens here.
- Do not hardcode alternative production hosts.
- Do not add permissions or native APIs without updating the wrapper shell docs and review steps.

## Tests/checks
- Update/add tests in `MOBILE/src/mobile/utils/*.test.ts` when bridge logic changes.
- Run `npm run check`.
- Run `cd MOBILE && npm run sync`.
