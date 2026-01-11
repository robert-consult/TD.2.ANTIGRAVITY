# Codex Implementation and Verification Guide - Country Sync + Timezone Controls

## Objective
Ensure Country/Region is set once at signup (jurisdiction selection) and reflected across Profile Settings and Regional Preferences, while enforcing:
1) Country is immutable after signup (read-only in preferences).
2) Timezone list is filtered to country; if the current timezone is not in the list, auto-select a valid one.
3) Admin controls timezone editability via Admin Dashboard > System Config > Controls > Regional Preferences.
4) Language remains editable at all times.

## Scope / Files Touched
### Frontend
- client/src/pages/ProfileSettings.tsx
- client/src/pages/AdminDashboard.tsx

### Backend
- server/routes.ts
- server/routes/admin.ts
- server/db/ensureSchema.ts
- server/storage.ts
- shared/schema.ts

## Expected Runtime Behavior
### Signup -> Country/Jurisdiction
- User selects a country during signup.
- Persist the ISO2 value in users.country_iso2 and users.country (compat).

### Profile Settings -> Phone
- Phone input is enabled automatically when country ISO2 exists.
- If country is missing, UI instructs the user to contact support.

### Profile Settings -> Regional Preferences
- Country/Region is prefilled and disabled once set.
- Timezone list is filtered to the selected country.
- If stored timezone is not valid for the country, auto-select a valid timezone.
- Timezone editable only when allowUserTimezoneEdit is true.
- Language always editable.

### Admin Dashboard -> System Config -> Controls
- New Controls tab appears after Signup Compliance.
- Regional Preferences card contains allowUserTimezoneEdit toggle.

## Verification Checklist
### 1) Build / typecheck
- npm run check
- npm run build

### 2) API contract
- GET /api/profile/preferences returns timezone, language, country, countryLocked, timezoneEditable.
- PUT /api/profile/preferences:
  - language updates always accepted
  - timezone updates ignored when timezoneEditable is false
  - country updates rejected if already set (409)
  - first-time country update allowed only if no country is set and ISO2 is valid

### 3) UI checks
- Profile Settings shows country from signup and disables selector.
- Timezone options filtered to country; auto-corrects if mismatch.
- When admin disables timezone editing, timezone select is disabled and language remains enabled.
- Phone formatting enabled when country exists.

### 4) Admin dashboard
- Toggle persists via /api/admin/system-config and affects Profile Settings after refresh.

## Notes
- Do not commit sqlite db files; rely on ensureSchema migrations.
- Keep diffs minimal and avoid unrelated refactors.
