# `MOBILE/ios/` AGENTS.md

## Scope
iOS shell for the Capacitor wrapper.

## Key files
- `App/App/AppDelegate.swift`
- `App/App/Info.plist`
- `App/App/App.entitlements`
- `App/App.xcodeproj/`

## Rules
- Keep associated domains and deep-link handling aligned with `tradehub.example.com`.
- Do not add ATS relaxations beyond the documented local-development exceptions.
- Preserve screenshot/snapshot shielding and same-origin wrapper assumptions.
- iOS wrapper runs/builds require macOS with Xcode. Keep non-Darwin guardrails intact.

## Checks
- `cd MOBILE && npm run sync`
- `cd MOBILE && npm run run:ios` on macOS + Xcode only
