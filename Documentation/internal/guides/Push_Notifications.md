---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/routes/pushDevices.ts
  - MOBILE/src/mobile/utils/push-notifications.ts
  - NATIVE/src/services/pushNotifications.ts
  - shared/identity/headers.ts
  - .agents/PRODUCTION_REQUIREMENTS.md
last_verified: 2026-03-29
status: maintained
---

# Push Notifications

## Server Contract

- push-device APIs live under `/api/push`
- registration and revocation are session-authenticated
- device registration captures app variant, platform, environment, identity headers, locale/timezone, and audit context

## Wrapper Path

- wrapper push helpers live in `MOBILE/src/mobile/utils/push-notifications.ts`
- the wrapper stores its active token locally so logout/session flows can revoke it safely
- wrapper registration posts `appVariant: "wrapper"` and uses the same-origin CSRF-aware fetch path

## Native Path

- native push handling lives in `NATIVE/src/services/pushNotifications.ts`
- the native app syncs Firebase tokens to the backend as `appVariant: "native"`
- notification-open handling is wired from the native app shell, not from the server docs layer

## Guardrails

- release push credentials are operator-managed
- registration payload fields must stay aligned with `server/routes/pushDevices.ts`
- account logout/revocation flows must revoke the active token when possible
