# App Signing & Distribution

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `MOBILE/docs/APP_SIGNING_GUIDE.md`, PRD-MOBILE-001, PRD-MOBILE-002, PRD-IOS-001

---

## Android Signing

- Use operator-managed keystores, **not** repository placeholders
- CI release builds must set `TRADEQUIP_REQUIRE_GOOGLE_SERVICES_FOR_RELEASE=1` to fail on missing Firebase config
- Local smoke builds can proceed without Firebase material

## iOS Signing

- Requires macOS with Xcode + `xcodebuild` + `xcrun`
- Non-Darwin hosts must fail fast with clear guidance
- Configure signing in Xcode/App Store Connect with operator credentials

## Firebase Config

- `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) are operator material
- Replace repository placeholders with environment-specific configs before release

---

## Related Pages

- [Push Notifications →](04_Push_Notifications.md)
- [Capacitor Guide →](01_Capacitor_Guide.md)
- [React Native Guide →](02_React_Native_Guide.md)
