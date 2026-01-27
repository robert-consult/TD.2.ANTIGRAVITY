# iOS App Deployment Readiness - Task Tracker

## ✅ All Non-macOS Work Complete

---

## Phase 1: React Native Code [COMPLETE]

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

### Navigation ✅
- [x] MainTabNavigator with all tabs
- [x] App.tsx with Journal, ProfileSettings, EmailVerification routes

---

## Phase 2: iOS Configuration [COMPLETE]

### Info.plist ✅
- [x] Privacy descriptions (Face ID, Camera, Location, Photos)
- [x] Background modes (push, fetch)
- [x] Deep linking URL scheme (tradequip://)
- [x] Dark mode default
- [x] Firebase messaging config

### Launch Screen ✅
- [x] LaunchScreen.storyboard with branding
- [x] LaunchIcon.imageset/Contents.json

### App Icons ✅
- [x] AppIcon.appiconset/Contents.json (all 18 sizes)

### Push Notifications ✅
- [x] TradeQuipNative.entitlements (dev)
- [x] TradeQuipNativeRelease.entitlements (prod)
- [x] GoogleService-Info.plist (placeholder)

### Native Code ✅
- [x] AppDelegate.mm (Firebase + notification handling)
- [x] AppDelegate.h (UNUserNotificationCenterDelegate)

### Xcode Project ✅
- [x] project.pbxproj with entitlements references
- [x] Bundle ID: com.tradequip.native
- [x] CODE_SIGN_ENTITLEMENTS configured

### Dependencies ✅
- [x] Podfile with Firebase pods
- [x] package.json with biometrics + FCM deps

---

## Phase 3: macOS-Only Steps (REMAINING)

### Install & Build
- [ ] `npm install`
- [ ] `pod install --repo-update`
- [ ] Run iOS Simulator build

### Replace Placeholders
- [ ] Real GoogleService-Info.plist from Firebase
- [ ] App icon PNG files
- [ ] Launch icon PNG

### Xcode Configuration
- [ ] Select Development Team
- [ ] Configure Provisioning Profiles
- [ ] Archive for App Store

### Testing
- [ ] Test all navigation flows
- [ ] Test authentication
- [ ] Test trading features
- [ ] Test biometric auth
- [ ] Test push notifications

### App Store
- [ ] Upload to App Store Connect
- [ ] Submit for review
