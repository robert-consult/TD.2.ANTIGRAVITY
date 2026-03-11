# Native iOS Notes

`NATIVE/ios/` is the iOS-native shell for the React Native app. Podfile, entitlements, plist, Xcode, and Apple-signing work belongs here.

## Owns
- `Podfile`
- `TradeQuipNative/AppDelegate.mm`
- `TradeQuipNative/Info.plist`
- `TradeQuipNative/*.entitlements`
- Xcode project/workspace settings

## Does Not Own
- Shared React Native screens/hooks/services in `NATIVE/src/`
- Android shell files

## Main Checks
```bash
cd NATIVE
npm run pod:install   # macOS + Xcode only
npm run build:ios     # macOS + Xcode only
```

## Release Notes
- Replace `GoogleService-Info.plist` with the correct operator-managed environment file before release.
- Keep bundle id, universal links, and push entitlements aligned with `tradehub.example.com`.
