# Capacitor Wrapper Implementation Map

> Current execution map for the wrapper track. This document replaces the old Android-only buildout plan.

## 20-Cycle Status Snapshot

### Cycles 1-4: Repo Map, Host Normalization, Architecture
- Complete: wrapper-only architecture, canonical host normalization, Android+iOS shell presence, root/mobile script delegation.

### Cycles 5-10: Session, CSRF, Deep Link, Push, Lifecycle
- Complete: wrapper bridge activation from the web app, same-origin session checks, CSRF-aware push registration, deep-link allowlisting, push route handling, resume/network refresh hooks.
- Remaining: production certificate pin material must still come from ops-managed release inputs.

### Cycles 11-16: Screen Parity
- Complete by source-of-truth design: dashboard, trade, quotes, chart, history, account, profile, journal, leaderboard, and mailbox surfaces all render from the live web app rather than wrapper-local shadow screens.
- Remaining: physical-device UX verification on representative Android/iPhone devices.

### Cycles 17-19: Hardening and Performance
- Complete in code: screenshot mitigation, allowlisted hosts, Android/iOS transport policy, push-device revocation on logout, runtime guardrails for non-macOS iOS workflows.
- Remaining: release-time pin injection and device-matrix performance evidence.

### Cycle 20: Release Evidence
- Remaining: operator credentials, physical device runs, and store-distribution signoff artifacts.

## Key Entry Points

- Wrapper activation: `client/src/components/MobileWrapperBridge.tsx`
- Route state: `client/src/lib/dashboardUrlState.ts`
- App path navigation: `client/src/lib/appNavigation.ts`
- Bridge helpers: `MOBILE/src/mobile/utils/*`
- Android shell: `MOBILE/android/`
- iOS shell: `MOBILE/ios/`

## Release Boundaries

- The wrapper does not own feature UI.
- Release signing, Firebase/APNs setup, and certificate pin values are operator-managed.
- iOS run/build steps require macOS with Xcode.
└─────────────────────────────┘
```

---

## Verification Plan

### Automated Tests

1. **Existing Playwright E2E Tests**
   ```bash
   # Run existing e2e suite to verify web app still works
   npm run e2e
   ```

2. **Capacitor Doctor Check**
   ```bash
   # Verify Capacitor installation
   npx cap doctor
   ```

3. **Android Build Verification**
   ```bash
   # After creating MOBILE folder
   cd MOBILE
   npm install
   npx cap sync
   npx cap open android
   # Check Gradle build succeeds
   ```

### Manual Verification

1. **Android Emulator Testing**
   - Start Android emulator (API 34+)
   - Run `npx cap run android`
   - Verify app launches and connects to backend
   - Test login flow
   - Test trading functionality
   - Verify WebSocket real-time quotes

2. **Session Persistence Check**
   - Login on mobile
   - Background the app
   - Resume app - verify session maintained
   - Kill app and reopen - verify re-authentication if needed

3. **UI/UX Verification**
   - Check all touch targets are ≥48px
   - Verify safe area handling (notch/cutout)
   - Test keyboard behavior on forms
   - Verify scroll performance

---

## User Review Required

> [!IMPORTANT]
> **Backend URL Decision**: The mobile app requires a publicly accessible backend URL for production. Should we:
> 1. Use the existing deployment at `https://YOUR_DOMAIN`?
> 2. Set up a separate mobile API subdomain?
> 3. Use `http://localhost:5000` for development (via `adb reverse tcp:5000 tcp:5000`) or a trusted HTTPS tunnel?

> [!WARNING]
> **API Keys in .env**: The `.env` file contains `OPENAI_API_KEY` which should remain server-side only. Verify this is not exposed to the client bundle.

> [!CAUTION]
> **Play Store Requirements**: Publishing to Google Play Store requires:
> - Privacy Policy URL
> - App signing key management
> - Content rating questionnaire
> - Data safety form completion

---

## Next Steps After Approval

1. Create MOBILE folder structure
2. Initialize Capacitor Android project
3. Install required Capacitor plugins
4. Generate mobile UI mockups
5. Implement mobile-specific components
6. Test on Android emulator
7. Security hardening
8. Play Store preparation
