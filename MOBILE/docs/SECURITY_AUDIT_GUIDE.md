# Security Audit Guide For The Wrapper

## Scope

This guide reflects the current `MOBILE/` architecture: Android and iOS shells around the live web app, with bridge utilities in `MOBILE/src/mobile/`.

## Implemented Controls

### WebView / Host Control
- Remote-URL mode keeps wrapper traffic same-origin with the server.
- Deep links are parsed and allowlisted before navigation.
- External or malformed routes are rejected or handed off safely.
- The live bridge is activated from `client/src/components/MobileWrapperBridge.tsx`, not from deleted wrapper-local UI screens.

### Transport
- Android uses `network_security_config.xml` with debug-only local exceptions.
- iOS uses ATS/associated-domain configuration scoped to the canonical host.
- Production certificate pins remain a release-time input; placeholder pin config is not release-ready.

### Session / CSRF
- Session-bound wrapper mutations fetch CSRF from `/api/csrf`.
- Session state is refreshed through `/api/auth/current-user`.
- Push token registration and revocation are authenticated and session-scoped through `/api/push/*`.

### Runtime Hardening
- Screenshot/snapshot mitigation is present in Android and iOS shells.
- Non-macOS iOS workflows fail fast instead of entering partial Xcode/CocoaPods flows.

## Validation Commands

```bash
npm run check
npm run build
cd MOBILE && npm run sync
cd MOBILE && npm run doctor
cd MOBILE && npm audit --audit-level=high
```

## Audit Focus Areas

### High Priority
- [ ] Production certificate pin values supplied from operator-managed release inputs
- [ ] Wrapper host allowlist remains restricted to approved domains/schemes
- [ ] Checked-in signing/Firebase files are not used as final release credentials
- [ ] Logout revokes wrapper push tokens and clears sensitive session state

### Medium Priority
- [ ] Deep-link normalization only targets supported app routes
- [ ] Local development exceptions stay limited to debug workflows
- [ ] External navigation cannot be coerced into arbitrary in-app origins

### Lower Priority / Future Hardening
- [ ] Root/jailbreak detection if required by release policy
- [ ] Overlay/tapjacking detection if required by threat model

## Storage Expectations

| Data Type | Expected Location | Notes |
|-----------|-------------------|-------|
| Session cookies | WebView cookie store | Server-managed, HttpOnly/Secure |
| Push token | Local storage + server registry | Cleared on logout/revocation |
| Device/install IDs | Local storage | Used for identity/push metadata |
| Passwords | Never stored locally | Server auth only |

## Summary

The wrapper codebase is hardened for same-origin session transport, route allowlisting, and basic device shielding. The remaining release-critical gap is operator-supplied production material: certificate pins, signing identities, and final Firebase/APNs configuration.
