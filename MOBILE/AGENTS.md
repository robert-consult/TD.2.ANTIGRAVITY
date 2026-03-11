# `MOBILE/` AGENTS.md (Capacitor Wrapper)

## What this area is
`MOBILE/` is the Capacitor wrapper for the live web app. It targets both Android and iOS, stays in remote-URL mode for production, and must not reintroduce a parallel UI app inside this subtree.

## Architecture rules
- User-facing trader/support UI lives in `client/`, not `MOBILE/src/mobile/`.
- `MOBILE/src/mobile/` is bridge-only: lifecycle, deep links, push registration, session checks, safe-area/native helpers.
- Keep platform shell work inside the already-distinct subtrees: `MOBILE/android/` for Android wrapper work and `MOBILE/ios/` for iOS wrapper work.
- Keep runtime host resolution anchored to `https://tradehub.example.com` unless an explicit local/tunnel override is being used for development.
- Any wrapper route mapping must stay aligned with `client/src/components/MobileWrapperBridge.tsx`, `client/src/lib/appNavigation.ts`, and `client/src/lib/dashboardUrlState.ts`.

## Local routing
- `MOBILE/src/mobile/AGENTS.md` for bridge hooks/utilities
- `MOBILE/android/AGENTS.md` for Android shell files
- `MOBILE/ios/AGENTS.md` for iOS shell files
- `MOBILE/android/README.md` for Android wrapper maintenance notes
- `MOBILE/ios/README.md` for iOS wrapper maintenance notes

## Non-negotiables
- Prefer remote URL mode to preserve same-origin cookies, CSRF, and `/ws`.
- Do not add native plugins or permissions without documenting the threat model and review steps.
- Treat checked-in signing or Firebase files as operator material, not authoritative release credentials.
- For repo-wide audits, decomposition reviews, and maintainability critiques that touch this subtree, read `../.agents/audit-decomposition.md` first.

## Key files
- Capacitor config: `MOBILE/capacitor.config.ts`
- Wrapper bridge activation: `client/src/components/MobileWrapperBridge.tsx`
- Wrapper bridge helpers: `MOBILE/src/mobile/`
- Android project: `MOBILE/android/`
- iOS project: `MOBILE/ios/`

## Required checks before finalizing
- If web or wrapper code changes: `cd MOBILE && npm run sync`
- Android sanity: `cd MOBILE && npm run doctor`
- Android build when platform files change: `cd MOBILE && npm run build:android:release`
- iOS launch only on macOS with Xcode: `cd MOBILE && npm run run:ios`
