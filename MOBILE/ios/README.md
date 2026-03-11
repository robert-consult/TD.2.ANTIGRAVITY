# iOS Wrapper Notes

`MOBILE/ios/` is the iOS-specific Capacitor wrapper project. Keep iOS wrapper work here instead of mixing shell changes into shared docs or Android files.

## Owns
- `App/App/AppDelegate.swift`
- `App/App/Info.plist`
- `App/App/App.entitlements`
- Associated domains and ATS policy
- Xcode project settings for the wrapper shell

## Does Not Own
- Trader/support UI
- Shared wrapper bridge logic in `MOBILE/src/mobile/`
- Android wrapper settings

## Main Checks
```bash
cd MOBILE
npm run sync
npm run run:ios   # macOS + Xcode only
```

## Release Notes
- iOS wrapper execution and signing require macOS with Xcode.
- Keep universal-link domains aligned with `tradehub.example.com`.
