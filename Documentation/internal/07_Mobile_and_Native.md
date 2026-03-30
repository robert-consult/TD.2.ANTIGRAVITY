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
  - MOBILE/src/mobile/
  - NATIVE/src/services/
  - NATIVE/src/theme/
last_verified: 2026-03-29
status: maintained
---

# Mobile And Native

This repo contains two distinct mobile surfaces and they should not be documented as one thing.

## Decision Rule

- if the feature is still the authenticated web app and the goal is native-shell integration, it belongs in `client/` plus wrapper bridge code under `MOBILE/src/mobile/`
- if the feature needs native UI or native navigation/state ownership, it belongs in `NATIVE/src/`

## Capacitor Wrapper

- `MOBILE/` is the remote-URL wrapper for the authenticated web app
- same-origin behavior is the point: cookie session, CSRF bootstrap, and `/ws` stay aligned with the server
- `MOBILE/src/mobile/` is for wrapper-only bridge concerns such as lifecycle, deep links, push, and session helpers
- platform shell files stay in `MOBILE/android/` and `MOBILE/ios/`
- signing/build glue for Android lives under `MOBILE/android/`, with example config in `key.properties.example`

## React Native App

- `NATIVE/` is a separate React Native product surface, not a wrapper around `client/`
- shared app logic lives in `NATIVE/src/`
- backend integration boundaries are in `NATIVE/src/services/` for runtime config, CSRF, API, and WebSocket handling
- theming lives in `NATIVE/src/theme/`
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

Maintained follow-on references:

- wrapper/native implementation guide: [Adding A Mobile Feature](guides/Adding_Mobile_Feature.md)
- release credentials and distribution: [Mobile Signing And Distribution](guides/Mobile_Signing_and_Distribution.md)
- push transport and device registration: [Push Notifications](guides/Push_Notifications.md)

Use [Repository Inventory](../generated/Repository_Inventory.md) for the full repo-level placement of mobile files and source docs.
