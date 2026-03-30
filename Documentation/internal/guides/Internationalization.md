---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/i18n/I18nProvider.tsx
  - client/src/i18n/store.ts
  - client/src/i18n/localeStorage.ts
  - server/i18n/service.ts
  - server/i18n/worker.ts
  - server/routes/adminI18n.ts
last_verified: 2026-03-30
status: maintained
---

# Internationalization

The current i18n implementation is not `i18next`.

## Current Architecture

- server-side bundle/config delivery through `server/i18n/`
- client-side locale and bundle management through a custom `I18nProvider`
- client bundle persistence through the local i18n store
- admin translation control through `server/routes/adminI18n.ts`

## Implementation Notes

- use `useTranslation()` from the current client i18n layer
- treat bundle config and bundle payloads as API-backed runtime data
- preserve locale persistence behavior for anonymous and authenticated users
- verify RTL and locale normalization behavior when touching provider logic
- account-scoped locale overrides are part of the implementation through `client/src/i18n/localeStorage.ts`

## Repo-Grounded Example

```tsx
import { useTranslation } from "@/i18n";

export function AccountHeading({ name }: { name: string }) {
  const { t, tFmt } = useTranslation();

  return (
    <>
      <h1>{t("account.title", "Account")}</h1>
      <p>{tFmt("account.welcome", "Welcome back, {name}", { name })}</p>
    </>
  );
}
```

```ts
// Excerpt from client/src/i18n/I18nProvider.tsx.
// The provider then resolves runtime data from the server-owned i18n API.
const res = await fetch(resolveApiUrl(`/api/i18n/bundle?locale=${encodeURIComponent(locale)}`), { headers });
```

That is the current contract: components use the repo’s custom `useTranslation()` hook, while `I18nProvider` hydrates config and bundle state from `/api/i18n/config` and `/api/i18n/bundle`.

## Verification

- `npm run check`
- if bundle generation or admin i18n behavior changed, run `npm run build`
