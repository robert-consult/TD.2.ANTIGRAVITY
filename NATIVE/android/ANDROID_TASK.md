# Android App Deployment Readiness - Task Tracker

## ✅ All Non-Desktop Work Complete

---

## Phase 1: React Native Code [COMPLETE]

> **Note**: React Native source code is SHARED between iOS and Android.
> All screens, hooks, components, and services in `NATIVE/src/` work on both platforms.

### Screens (12/12) ✅
- [x] SignInScreen, SignUpScreen, EmailVerificationScreen
- [x] QuotesScreen, ChartsScreen, TradeScreen
- [x] HistoryScreen, AccountScreen, DashboardScreen
- [x] JournalScreen, ProfileSettingsScreen, LeaderboardScreen

### Hooks (8/8) ✅
- [x] useAuth, useTrades, useAccountSummary, useQuotes
- [x] useToast, usePendingOrders, useWebSocket, useBiometricAuth

### Components (8/8) ✅
- [x] Button, Input, GlassCard, Toast
- [x] SymbolSelect, EditTradeModal, ActivityTimeline, VerificationCards

### Services (3/3) ✅
- [x] api.ts, websocket.ts, pushNotifications.ts

---

## Phase 2: Android Configuration [COMPLETE]

### AndroidManifest.xml ✅
- [x] Internet and network permissions
- [x] Biometric permissions (USE_BIOMETRIC, USE_FINGERPRINT)
- [x] Push notification permissions
- [x] Deep linking (tradequip:// scheme)
- [x] App Links (https://tradequip.app)
- [x] Firebase Messaging service
- [x] Network security config

### Build Configuration ✅
- [x] Root build.gradle with Firebase plugin
- [x] App build.gradle with dependencies
- [x] Proguard rules for production
- [x] APK split by ABI

### Resources ✅
- [x] colors.xml - TradeQuip dark theme
- [x] styles.xml - Dark theme with splash screen
- [x] network_security_config.xml - Dev/prod HTTPS
- [x] launch_screen.xml - Splash screen drawable

### Firebase ✅
- [x] google-services.json (placeholder)

---

## Phase 3: Desktop/CI Steps (REMAINING)

### Install & Build
- [ ] `npm install`
- [ ] `cd android && ./gradlew assembleDebug`
- [ ] Run on emulator/device

### Replace Placeholders
- [ ] Real google-services.json from Firebase Console
- [ ] App icon PNG files in mipmap folders
- [ ] Notification icon (ic_notification.png)

### Release Signing
- [ ] Generate release keystore
- [ ] Configure signing in build.gradle
- [ ] Create signed APK/AAB

### Testing
- [ ] Test all navigation flows
- [ ] Test authentication
- [ ] Test trading features
- [ ] Test biometric auth
- [ ] Test push notifications

### Play Store
- [ ] Upload to Google Play Console
- [ ] Submit for review
