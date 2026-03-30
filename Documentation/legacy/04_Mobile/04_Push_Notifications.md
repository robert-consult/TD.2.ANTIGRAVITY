# Push Notifications

> **Diátaxis quadrant:** How-To Guide
> **Sources:** `MOBILE/docs/PUSH_NOTIFICATION_SETUP.md`, `NATIVE/src/services/pushNotifications.ts`

---

## Setup

1. Configure Firebase project for both Android and iOS
2. Place `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
3. Implement device token registration via `pushNotifications.ts`
4. Server-side: register device tokens in user profile for targeted push delivery

---

## Related Pages

- [App Signing →](03_Signing_Distribution.md)
- [Capacitor Guide →](01_Capacitor_Guide.md)
- [React Native Guide →](02_React_Native_Guide.md)
