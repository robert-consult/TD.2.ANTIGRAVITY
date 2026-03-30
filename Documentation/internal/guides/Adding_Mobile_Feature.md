---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - CAPACITOR.md
  - MOBILE/README.md
  - MOBILE/src/mobile/AGENTS.md
  - NATIVE/README.md
  - NATIVE/src/AGENTS.md
  - shared/
last_verified: 2026-03-30
status: maintained
---

# Adding A Mobile Feature

## Decide The Surface First

- use the wrapper path when the feature is still the authenticated web app and only needs mobile shell integration
- use the native path when the feature needs native navigation, native UI ownership, or native device APIs not satisfied by the wrapper

## Wrapper Workflow

1. implement the user-facing behavior in `client/`
2. add wrapper-only bridge code in `MOBILE/src/mobile/` only when native shell interaction is required
3. keep Android/iOS shell edits in `MOBILE/android/` or `MOBILE/ios/`
4. sync and validate with `cd MOBILE && npm run sync`

## Native Workflow

1. implement the feature in `NATIVE/src/`
2. reuse shared contracts and transport helpers instead of copying server semantics
3. keep platform-specific code in `NATIVE/android/` or `NATIVE/ios/`
4. validate with `cd NATIVE && npm test`, `cd NATIVE && npm run lint`, and platform build/run commands as needed

## Non-Negotiables

- do not create a parallel feature implementation inside `MOBILE/` when `client/` is the source of truth
- do not invent new protocol shapes if `shared/` already owns them
- preserve session, CSRF, and `/ws` alignment with the main backend contracts

## Repo-Grounded Example

```ts
// Excerpt from client/src/components/MobileWrapperBridge.tsx.
// Wrapper: keep user-facing behavior in client/ and use the bridge only for shell work.
return initPushNotificationListeners({
  onNotificationTapped: (notification) => {
    const target = resolveNotificationTarget(notification);
    if (target) {
      navigateToAppPath(target);
    }
  },
});
```

```ts
// Excerpt from NATIVE/src/services/pushNotifications.ts.
// Native: keep transport and device integration in NATIVE/src/services.
const token = await pushNotificationService.getToken();
if (token) {
  await pushNotificationService.syncTokenWithServer(token);
}
```

The wrapper example is grounded in `client/src/components/MobileWrapperBridge.tsx` plus `MOBILE/src/mobile/utils/`, while the native example is grounded in `NATIVE/src/services/pushNotifications.ts`.
