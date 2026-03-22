# Wave 4 Completion Record

Verified against the live tree on 2026-03-21.

## Wave objective

Eliminate cross-surface drift so the trading app runtime host, deep-link model, and session-facing paths are resolved coherently across:

- web client
- Capacitor wrapper
- React Native app
- server-generated outbound links
- website CTA links

## What changed

### 1. Canonical cross-surface owner added

New shared owners:

- `shared/appSurfaceConfig.ts`
- `shared/appLinks.ts`

These now own:

- canonical production and staging app base URLs
- native/wrapper dev defaults
- deep-link scheme constants
- login and verify-email page builders
- session endpoint constants used by mobile shells
- wrapper/native/web route parsing and route building

### 2. Server-generated links now use one owner

New server owner:

- `server/services/appLinks.ts`

Consumers moved to it:

- `server/routes/verification.ts`
- `server/cron/verificationReminders.ts`
- `server/routes/auth/register.ts`
- `server/routes/authCore.ts`
- `server/routes/profile/update.ts`
- `server/routes/profileCore.ts`
- `server/routes/admin.ts`

Key fix:

- verification emails no longer drift between `/verify-email?token=...` and `/api/verification/email/verify?token=...`
- waitlist invites now resolve through the canonical signup URL builder

### 3. Web and wrapper drift removed

Updated:

- `client/src/lib/appUrl.ts`
- `client/src/lib/wsUrl.ts`
- `client/src/lib/dashboardUrlState.ts`
- `client/src/lib/appNavigation.ts`
- `client/src/components/MobileWrapperBridge.tsx`
- `MOBILE/capacitor.config.ts`
- `MOBILE/src/mobile/utils/deep-linking.ts`
- `MOBILE/src/mobile/utils/session-manager.ts`

Key fix:

- wrapper/web no longer carry separate hard-coded host and scheme parsing logic
- session polling path constants are shared instead of string-literal drift
- Capacitor runtime origin precedence is explicit: `CAPACITOR_SERVER_URL` -> `APP_URL` -> production fallback only in production

### 4. Native runtime host and deep-link drift removed

Updated:

- `NATIVE/src/services/runtimeConfig.ts`

Key fix:

- native API base URL, websocket URL, deep-link prefixes, accepted canonical URLs, and session poll interval now resolve from the same shared model
- native still rejects unsupported web-only routes such as `/admin`, but that boundary is now explicit and tested instead of accidental

### 5. Website stays isolated but aligned

Updated:

- `WEBSITE/client/src/lib/app-config.ts`

Key fix:

- website CTA URLs are now derived from one local base-url owner with optional `VITE_TRADING_APP_URL` override
- website remained isolated from `@shared/` imports to preserve module independence
- parity with the canonical production host is enforced by root-level tests

### 6. Operator-visible precedence updated

Updated:

- `.env.example`

New explicit envs documented:

- `VITE_APP_URL`
- `VITE_API_URL`
- `VITE_WS_URL`
- `CAPACITOR_SERVER_URL`

## Tests added or expanded

Root/Vitest:

- `server/services/appSurfaceConfig.test.ts`
- `MOBILE/src/mobile/utils/deep-linking.test.ts`
- `MOBILE/src/mobile/utils/session-manager.test.ts`

Native/Jest:

- `NATIVE/__tests__/runtimeConfig.test.ts`

The new coverage verifies:

- server/wrapper/native base-url precedence
- canonical login and verification link generation
- surface-specific deep-link allow-lists
- website parity with canonical production CTA links
- shell manifest/entitlement host parity
- shared mobile session poll interval

## Validation run

Passed:

- `npm run check`
- `npm run build`
- `npx vitest run server/services/appSurfaceConfig.test.ts MOBILE/src/mobile/utils/deep-linking.test.ts MOBILE/src/mobile/utils/session-manager.test.ts client/src/lib/dashboardUrlState.test.ts`
- `cd NATIVE && npm test -- --runInBand __tests__/runtimeConfig.test.ts __tests__/websocket.test.ts __tests__/csrf.test.ts`

## Outcome

Wave 4 is complete for runtime host, deep-link, and session-path alignment.

Remaining work belongs to Wave 5:

- deploy-owned config visibility
- documentation reconciliation across older reports and runbooks
