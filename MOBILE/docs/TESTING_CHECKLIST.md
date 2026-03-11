# Mobile Testing Checklist

Wrapper target platforms: Android and iOS. Run the same session, transport, deep-link, and push checks on both shells before marking a cycle complete.

Host note:
- Android automation/build checks can run from this Linux host.
- iOS wrapper launch/device checks require macOS + Xcode.

## Automated Gates

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `cd MOBILE && npm run sync`
- [ ] `cd MOBILE && npm run doctor`
- [ ] `cd MOBILE && npm audit --audit-level=high`
- [ ] `npm run e2e`

## Session Handling Tests

### Test 1: Login Persistence
- [ ] Open app → Login with valid credentials
- [ ] Close app completely (remove from recent apps)
- [ ] Reopen app → Should remain logged in
- [ ] Expected: Session cookie persists across app restarts

### Test 2: Background Resume
- [ ] Login to app
- [ ] Press home button (app goes to background)
- [ ] Wait 5+ minutes
- [ ] Return to app → Should remain logged in
- [ ] Expected: Session still valid, no re-authentication needed

### Test 3: Session Expiry
- [ ] Login to app
- [ ] On server: manually expire/invalidate session
- [ ] Trigger any API call from app
- [ ] Expected: User is redirected to login screen

### Test 4: Logout Flow
- [ ] Login → Navigate to Profile → Tap "Sign Out"
- [ ] After logout, close and reopen app
- [ ] Expected: User sees login screen, not dashboard

---

## Trading Functionality Tests

### Test 5: View Quotes
- [ ] Navigate to Quotes tab
- [ ] Verify real-time price updates via WebSocket
- [ ] Expected: Prices update every few seconds

### Test 6: Place Market Order
- [ ] Navigate to Trade tab
- [ ] Select USDJPY, set 1 lot
- [ ] Tap BUY button
- [ ] Expected: Order executes, confirmation shown

### Test 7: View Positions
- [ ] After placing trade, check History tab
- [ ] Verify position shows with entry price
- [ ] Expected: Active position visible with P&L

### Test 8: Close Position
- [ ] Navigate to active position
- [ ] Tap close/exit button
- [ ] Expected: Position closes at current market price

---

## Security Audit

### Test 9: HTTPS Enforcement
- [ ] Using proxy (Charles/Fiddler), verify all traffic is HTTPS
- [ ] Try to downgrade to HTTP → Should fail
- [ ] Expected: No cleartext traffic in production build

### Test 10: Cookie Security
- [ ] Inspect cookies in WebView debugger
- [ ] Verify `HttpOnly`, `Secure`, `SameSite` flags
- [ ] Expected: Session cookie not accessible via JavaScript

### Test 11: Deep Link Injection
- [ ] Try malicious deep link: `tradequip://javascript:alert(1)`
- [ ] Try URL with unexpected scheme
- [ ] Expected: Invalid links rejected, no code execution

### Test 12: WebView Security
- [ ] Verify WebView only loads from allowed domains
- [ ] Try navigating to external URL
- [ ] Expected: External URLs blocked or open in system browser

### Test 13: Push Registration And Revocation
- [ ] Login on wrapper device
- [ ] Confirm `/api/push/register` stores one wrapper device record
- [ ] Logout and confirm `/api/push/unregister` revokes the stored token
- [ ] Expected: no stale wrapper push token remains bound to the logged-out session

---

## Performance Tests

### Test 14: Cold Start Time
- [ ] Force stop app
- [ ] Launch and time until interactive
- [ ] Expected: < 3 seconds on mid-range device

### Test 15: Memory Usage
- [ ] Open app, navigate through all tabs
- [ ] Check memory usage in Android Profiler
- [ ] Expected: < 150MB RAM usage

### Test 16: Battery Impact
- [ ] Leave app in foreground for 30 minutes
- [ ] Check battery usage in settings
- [ ] Expected: Minimal battery drain (WebSocket efficient)

### Test 17: Network Efficiency
- [ ] Monitor network traffic for 5 minutes
- [ ] Verify no excessive polling
- [ ] Expected: WebSocket for real-time, minimal HTTP requests

---

## Device Compatibility

### Test 18: Screen Sizes
- [ ] Test on phone (< 6")
- [ ] Test on tablet (7"+)
- [ ] Expected: UI adapts appropriately

### Test 19: Platform Versions
- [ ] Test on Android 10+ and Android 14+
- [ ] Test on current iOS simulator and a physical iPhone build
- [ ] Expected: Wrapper lifecycle, auth, and deep links behave consistently on both platforms

### Test 20: Offline And Resume
- [ ] Drop network while on quotes/trade/account screens
- [ ] Restore network and resume the app
- [ ] Expected: wrapper refreshes auth state and live data without duplicate reconnect storms

### Test 21: Dark Mode
- [ ] Enable system dark mode
- [ ] Expected: App respects system theme (or has own dark theme)

---

## Test Results Summary

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Session | /4 | | |
| Trading | /4 | | |
| Security | /5 | | |
| Performance | /4 | | |
| Compatibility | /4 | | |
| **Total** | **/21** | | |

Tested by: ________________
Date: ________________
Device: ________________
Build Version: ________________
