---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/i18n/I18nProvider.tsx
  - client/src/i18n/store.ts
  - server/i18n/service.ts
  - server/i18n/worker.ts
  - server/routes/adminI18n.ts
last_verified: 2026-03-27
status: maintained
---

# Internationalization

The current i18n implementation is not `i18next`.

Current architecture:

- server-side bundle/config delivery through `server/i18n/`
- client-side locale and bundle management through a custom `I18nProvider`
- client bundle persistence through the local i18n store
- admin translation control through `server/routes/adminI18n.ts`

Implementation notes:

- use `useTranslation()` from the current client i18n layer
- treat bundle config and bundle payloads as API-backed runtime data
- preserve locale persistence behavior for anonymous and authenticated users
- verify RTL and locale normalization behavior when touching provider logic
