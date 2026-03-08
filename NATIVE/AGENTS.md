# AGENTS.md (Native Mobile Subproject)

> **Parent references**: 
> - Root `AGENTS.md` (must read first)
> - `.agents/audit-decomposition.md` (for repo-wide audits, decomposition reviews, and maintainability critiques)
> - `.agents/security.md` (applied to mobile API usage)
> - `.agents/performance.md` (applied to mobile render/network)

## Mission
Build a **premium, performant, and secure** native trading experience that mirrors the web application's capabilities while leveraging device-specific features (biometrics, secure storage, haptics).

## Relationship to MOBILE/ (Capacitor)
This project (`NATIVE/`) and `MOBILE/` are **separate but complementary**:

| Project | Technology | Purpose |
|---------|------------|---------|
| `NATIVE/` | React Native | True native app with native UI components |
| `MOBILE/` | Capacitor | WebView wrapper around the web app |

- **Both target Android/iOS** but serve different deployment strategies.
- **NATIVE** is preferred for performance-critical native features.
- **MOBILE** is faster to update (web changes auto-propagate after sync).
- **Do not merge** their codebases; they have separate `node_modules/`.

## Operational Rules (Native Specific)

1.  **No Secrets in Bundle**: NEVER hardcode API keys, secrets, or administrative credentials in the Javascript bundle or AndroidManifest/Info.plist.
2.  **Secure Storage**: ALWAYS use `react-native-mmkv` with encryption or `Keychain/Keystore` for sensitive tokens (Auth tokens, Refresh tokens).
3.  **Biometrics First**: Prefer Biometric authentication (FaceID/Fingerprint) for re-authentication sessions.
4.  **Bot-Proof**: Respect and forward all identity headers (`x-device-id`, `x-device-fingerprint`, `x-captcha-token`) as defined in `api.ts`.

## Non-functional Requirements (NFRs)

### A) Mobile Performance
- **Render Loop**: Avoid unnecessary re-renders. Use `React.memo`, `useMemo`, and stable callbacks.
- **Startup Time**: Lazy load heavy screens. Initialize non-critical SDKs after interaction.
- **Animations**: Use `react-native-reanimated` (UI thread) for all gestures and transitions. Avoid JS-driven animations.

### B) Mobile Security
- **SSL/TLS**: Ensure all API communication is over HTTPS.
- **Data Leakage**: Do not log sensitive user data to the console in Release builds (use `babel-plugin-transform-remove-console`).
- **Input Validation**: Validate all inputs using `zod` schemas shared with or mirrored from the backend.

### C) Offline & Resilience
- **Graceful degradation**: The app must remain navigable (cached data) when offline.
- **Reconnection**: WebSocket must auto-reconnect with exponential backoff (already implemented in `websocket.ts`).

## Key entrypoints
- **App + navigation**: `src/App.tsx`, `src/navigation/`
- **Data hooks**: `src/hooks/`
- **API + WS services**: `src/services/` (especially `api.ts`)

## Required checks before finalizing
- Tests: `npm test`
- Lint: `npm run lint`
