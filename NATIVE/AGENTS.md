# AGENTS.md (Native Mobile Subproject)

> **Parent references**: 
> - Root `AGENTS.md` (must read first)
> - `.agents/audit-decomposition.md` (for repo-wide audits, decomposition reviews, and maintainability critiques)
> - `.agents/security.md` (applied to mobile API usage)
> - `.agents/performance.md` (applied to mobile render/network)

## Mission
Build and maintain the React Native trader/support app for both Android and iOS while keeping transport, CSRF, WebSocket, locale, legal, and mailbox contracts aligned with the live web/server stack.

## Relationship to MOBILE/ (Capacitor)
This project (`NATIVE/`) and `MOBILE/` are **separate but complementary**:

| Project | Technology | Purpose |
|---------|------------|---------|
| `NATIVE/` | React Native | True native app with native UI components |
| `MOBILE/` | Capacitor | WebView wrapper around the web app |

- **Both target Android/iOS** but serve different deployment strategies.
- **NATIVE** is preferred for performance-critical native features.
- **MOBILE** is faster to update because the web app remains the source of truth.
- **Do not merge** their codebases; they have separate `node_modules/`.

## Local routing
- `NATIVE/src/AGENTS.md` for shared RN app code
- `NATIVE/android/AGENTS.md` for Android shell files
- `NATIVE/ios/AGENTS.md` for iOS shell files
- `NATIVE/android/README.md` for Android native maintenance notes
- `NATIVE/ios/README.md` for iOS native maintenance notes

## Operational Rules (Native Specific)

1.  **No Secrets in Bundle**: NEVER hardcode API keys, secrets, or administrative credentials in the JS bundle or platform manifests/plists.
2.  **Shared First**: Reuse `shared/` transport/security contracts instead of reimplementing host, CSRF, WS, or locale rules per screen.
3.  **Runtime Config**: Use `src/services/runtimeConfig.ts` for canonical host, deep-link prefixes, and push environment.
4.  **Bot-Proof**: Respect and forward identity headers and bot-challenge/legal reaccept handling through the service layer.
5.  **Operator Material**: Treat tracked Firebase/signing files as placeholders or operator material until replaced by release credentials.
6.  **Platform Demarcation**: Android shell work belongs in `NATIVE/android/`; iOS shell work belongs in `NATIVE/ios/`; shared product code belongs in `NATIVE/src/`.

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
- **App + deep-link wiring**: `src/App.tsx`, `src/navigation/`
- **Data hooks**: `src/hooks/`
- **API + WS services**: `src/services/` (especially `api.ts`, `csrf.ts`, `runtimeConfig.ts`, `websocket.ts`, `pushNotifications.ts`)
- **Android shell**: `android/`
- **iOS shell**: `ios/`

## Required checks before finalizing
- Tests: `npm test`
- Lint: `npm run lint`
- Android build when platform files change: `npm run build:android`
- iOS pod/build only on macOS + Xcode: `npm run pod:install && npm run build:ios`
