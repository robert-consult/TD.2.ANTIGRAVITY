# Mobile Testing Checklist

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

---

## Performance Tests

### Test 13: Cold Start Time
- [ ] Force stop app
- [ ] Launch and time until interactive
- [ ] Expected: < 3 seconds on mid-range device

### Test 14: Memory Usage
- [ ] Open app, navigate through all tabs
- [ ] Check memory usage in Android Profiler
- [ ] Expected: < 150MB RAM usage

### Test 15: Battery Impact
- [ ] Leave app in foreground for 30 minutes
- [ ] Check battery usage in settings
- [ ] Expected: Minimal battery drain (WebSocket efficient)

### Test 16: Network Efficiency
- [ ] Monitor network traffic for 5 minutes
- [ ] Verify no excessive polling
- [ ] Expected: WebSocket for real-time, minimal HTTP requests

---

## Device Compatibility

### Test 17: Screen Sizes
- [ ] Test on phone (< 6")
- [ ] Test on tablet (7"+)
- [ ] Expected: UI adapts appropriately

### Test 18: Android Versions
- [ ] Test on Android 10 (API 29)
- [ ] Test on Android 14 (API 34)
- [ ] Expected: Works on Android 10+

### Test 19: Dark Mode
- [ ] Enable system dark mode
- [ ] Expected: App respects system theme (or has own dark theme)

---

## Test Results Summary

| Category | Pass | Fail | Notes |
|----------|------|------|-------|
| Session | /4 | | |
| Trading | /4 | | |
| Security | /4 | | |
| Performance | /4 | | |
| Compatibility | /3 | | |
| **Total** | **/19** | | |

Tested by: ________________
Date: ________________
Device: ________________
Build Version: ________________
