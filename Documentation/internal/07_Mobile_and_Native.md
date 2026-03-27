---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - CAPACITOR.md
  - MOBILE/README.md
  - MOBILE/AGENTS.md
  - NATIVE/README.md
  - NATIVE/AGENTS.md
  - client/src/components/MobileWrapperBridge.tsx
  - NATIVE/src/services/
last_verified: 2026-03-27
status: maintained
---

# Mobile And Native

This repo contains two distinct mobile surfaces and they should not be documented as one thing.

## Capacitor Wrapper

- `MOBILE/` is the remote-URL wrapper for the authenticated web app
- same-origin behavior is the point: cookie session, CSRF bootstrap, and `/ws` stay aligned with the server
- `MOBILE/src/mobile/` is for wrapper-only bridge concerns such as lifecycle, deep links, push, and session helpers
- platform shell files stay in `MOBILE/android/` and `MOBILE/ios/`

## React Native App

- `NATIVE/` is a separate React Native product surface, not a wrapper around `client/`
- shared app logic lives in `NATIVE/src/`
- backend integration boundaries are in `NATIVE/src/services/` for runtime config, CSRF, API, and WebSocket handling
- platform shell files stay in `NATIVE/android/` and `NATIVE/ios/`

## Ownership Boundaries

- web UI source of truth remains `client/`
- wrapper-specific changes should not create a parallel feature implementation inside `MOBILE/`
- native features should reuse shared contracts and transport rules instead of re-implementing backend semantics
- auth, legal, verification, mailbox, and quote/trade contracts still come from the main app/server/shared surfaces

## Commands

- root wrapper sync: `npm run cap:sync`
- wrapper workflow: `cd MOBILE && npm run sync`, `cd MOBILE && npm run run:android`, `cd MOBILE && npm run build:android:release`
- native workflow: `cd NATIVE && npm test`, `cd NATIVE && npm run lint`, `cd NATIVE && npm run android`

Use [Repository Inventory](../generated/Repository_Inventory.md) for the full repo-level placement of mobile files and source docs.
