---
audience: generated
exposure: internal
owner: documentation-program
canonical_sources:
  - server/routes.ts
  - server/routes/
last_verified: 2026-03-27
status: generated
generated_from:
  - scripts/docs/generators/rest/index.ts
---

# REST API Catalog

> Generated from the current route tree. Do not edit by hand.

Generated on 2026-03-27 from `server/routes.ts` and `server/routes/**`.

Total route declarations discovered: **197**.

## Surface Counts

| Surface | Count |
| --- | ---: |
| admin | 86 |
| auth | 18 |
| legal | 6 |
| market-data | 3 |
| other | 3 |
| platform | 1 |
| profile | 30 |
| public-or-mixed | 34 |
| trader | 11 |
| verification | 5 |

## Route Catalog

| Method | Path | Surface | Source |
| --- | --- | --- | --- |
| DELETE | /api/admin/daily-fx-closes/:id | admin | `server/routes/admin.ts` |
| DELETE | /api/admin/symbols/:id | admin | `server/routes/admin.ts` |
| DELETE | /api/auth/devices | auth | `server/routes/auth/devices.ts` |
| DELETE | /api/auth/devices | auth | `server/routes/authCore.ts` |
| DELETE | /api/auth/devices/:id | auth | `server/routes/auth/devices.ts` |
| DELETE | /api/auth/devices/:id | auth | `server/routes/authCore.ts` |
| DELETE | /api/journal/:id | public-or-mixed | `server/routes/trader/journal.ts` |
| DELETE | /api/profile/sessions | profile | `server/routes/profile/sessions.ts` |
| DELETE | /api/profile/sessions | profile | `server/routes/profileCore.ts` |
| DELETE | /api/profile/sessions/:sessionId | profile | `server/routes/profile/sessions.ts` |
| DELETE | /api/profile/sessions/:sessionId | profile | `server/routes/profileCore.ts` |
| GET | /api/account/summary | trader | `server/routes/profile/account.ts` |
| GET | /api/account/summary | trader | `server/routes/profileCore.ts` |
| GET | /api/account/summary | trader | `server/routes/trader/account.ts` |
| GET | /api/admin/daily-fx-closes | admin | `server/routes/admin.ts` |
| GET | /api/admin/daily-fx-closes/dates | admin | `server/routes/admin.ts` |
| GET | /api/admin/global-settings | admin | `server/routes/admin.ts` |
| GET | /api/admin/grift/alerts | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/audit-log | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/audit-log/verify | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/cases | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/cases/:id | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/config | admin | `server/routes/grift-admin/ops.ts` |
| GET | /api/admin/grift/config/effective | admin | `server/routes/grift-admin/ops.ts` |
| GET | /api/admin/grift/enforcement/log | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/export/flagged-users | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/export/observations | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/export/signals | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/flagged-users | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/identity-links | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/identity-links/users | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/ip2asn/status | admin | `server/routes/grift-admin/ops.ts` |
| GET | /api/admin/grift/maintenance/db-stats | admin | `server/routes/grift-admin/ops.ts` |
| GET | /api/admin/grift/networks | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/overview | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/pairs | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/signals | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/summary | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/tier-counts | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/users/:userId/enforcement | admin | `server/routes/grift.ts` |
| GET | /api/admin/grift/users/:userId/identity-links | admin | `server/routes/grift.ts` |
| GET | /api/admin/identity-audit | admin | `server/routes/admin.ts` |
| GET | /api/admin/identity-audit/categories | admin | `server/routes/admin.ts` |
| GET | /api/admin/identity-audit/user/:userId | admin | `server/routes/admin.ts` |
| GET | /api/admin/identity-audit/verify-chain | admin | `server/routes/admin.ts` |
| GET | /api/admin/legal-docs | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/legal-docs/:id | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/legal-docs/acceptances/:id/validate | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/legal-docs/acceptances/list | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/legal-docs/coverage/stats | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/legal-docs/system-config/enforcement | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/legal-docs/targets/list | admin | `server/routes/adminLegal.ts` |
| GET | /api/admin/runtime-config/effective/auto-close | admin | `server/routes/admin.ts` |
| GET | /api/admin/runtime-config/effective/quote-transport | admin | `server/routes/admin.ts` |
| GET | /api/admin/signup-waitlist | admin | `server/routes/admin.ts` |
| GET | /api/admin/signup-waitlist/export | admin | `server/routes/admin.ts` |
| GET | /api/admin/symbols | admin | `server/routes/admin.ts` |
| GET | /api/admin/system-config | admin | `server/routes/admin.ts` |
| GET | /api/admin/users | admin | `server/routes/admin.ts` |
| GET | /api/admin/users/:userId/grift-profile | admin | `server/routes/grift.ts` |
| GET | /api/admin/users/:userId/linked-accounts | admin | `server/routes/grift.ts` |
| GET | /api/admin/users/:userId/login-activity | admin | `server/routes/adminSecurity.ts` |
| GET | /api/admin/users/:userId/login-activity.csv | admin | `server/routes/adminSecurity.ts` |
| GET | /api/admin/users/:userId/sessions | admin | `server/routes/adminSecurity.ts` |
| GET | /api/admin/users/:userId/sessions.csv | admin | `server/routes/adminSecurity.ts` |
| GET | /api/auth/current-user | auth | `server/routes/auth/currentUser.ts` |
| GET | /api/auth/current-user | auth | `server/routes/authCore.ts` |
| GET | /api/auth/devices | auth | `server/routes/auth/devices.ts` |
| GET | /api/auth/devices | auth | `server/routes/authCore.ts` |
| GET | /api/auth/signup-config | auth | `server/routes/public/signupConfig.ts` |
| GET | /api/auth/signup-config | auth | `server/routes/publicCore.ts` |
| GET | /api/auth/waitlist-policy | auth | `server/routes/public/signupConfig.ts` |
| GET | /api/auth/waitlist-policy | auth | `server/routes/publicCore.ts` |
| GET | /api/config/symbols | public-or-mixed | `server/routes/profileCore.ts` |
| GET | /api/config/symbols | public-or-mixed | `server/routes/public/symbols.ts` |
| GET | /api/csrf | public-or-mixed | `server/routes.ts` |
| GET | /api/diagnostics/price-feed | public-or-mixed | `server/routes/public/diagnostics.ts` |
| GET | /api/diagnostics/price-feed | public-or-mixed | `server/routes/publicCore.ts` |
| GET | /api/global-settings | public-or-mixed | `server/routes/public/globalSettings.ts` |
| GET | /api/global-settings | public-or-mixed | `server/routes/publicCore.ts` |
| GET | /api/instruments | market-data | `server/routes/instruments.ts` |
| GET | /api/journal | public-or-mixed | `server/routes/trader/journal.ts` |
| GET | /api/leaderboard | public-or-mixed | `server/routes/trader/leaderboard.ts` |
| GET | /api/legal/doc1/availability | legal | `server/routes/legal.ts` |
| GET | /api/legal/doc1/check | legal | `server/routes/legal.ts` |
| GET | /api/legal/doc1/reaccept | legal | `server/routes/legal.ts` |
| GET | /api/legal/doc1/resolve | legal | `server/routes/legal.ts` |
| GET | /api/legal/public-config | legal | `server/routes/legal.ts` |
| GET | /api/market/quotes | market-data | `server/routes/market.ts` |
| GET | /api/market/symbols | market-data | `server/routes/market.ts` |
| GET | /api/me/sessions | public-or-mixed | `server/routes/meSessions.ts` |
| GET | /api/meta/countries | public-or-mixed | `server/routes/meta.ts` |
| GET | /api/meta/countries/search | public-or-mixed | `server/routes/meta.ts` |
| GET | /api/meta/languages | public-or-mixed | `server/routes/meta.ts` |
| GET | /api/meta/languages/search | public-or-mixed | `server/routes/meta.ts` |
| GET | /api/meta/timezones | public-or-mixed | `server/routes/meta.ts` |
| GET | /api/meta/timezones/search | public-or-mixed | `server/routes/meta.ts` |
| GET | /api/policy/snapshot | public-or-mixed | `server/routes/profile/policySnapshot.ts` |
| GET | /api/policy/snapshot | public-or-mixed | `server/routes/profileCore.ts` |
| GET | /api/policy/snapshot | public-or-mixed | `server/routes/trader/policy.ts` |
| GET | /api/profile/kyc | profile | `server/routes/profile/kyc.ts` |
| GET | /api/profile/kyc | profile | `server/routes/profileCore.ts` |
| GET | /api/profile/login-history | profile | `server/routes/profile/loginHistory.ts` |
| GET | /api/profile/login-history | profile | `server/routes/profileCore.ts` |
| GET | /api/profile/me | profile | `server/routes/profile/me.ts` |
| GET | /api/profile/me | profile | `server/routes/profileCore.ts` |
| GET | /api/profile/payout | profile | `server/routes/profile/payout.ts` |
| GET | /api/profile/payout | profile | `server/routes/profileCore.ts` |
| GET | /api/profile/preferences | profile | `server/routes/profile/preferences.ts` |
| GET | /api/profile/preferences | profile | `server/routes/profileCore.ts` |
| GET | /api/profile/sessions | profile | `server/routes/profile/sessions.ts` |
| GET | /api/profile/sessions | profile | `server/routes/profileCore.ts` |
| GET | /api/quotes/:symbol | public-or-mixed | `server/routes/public/quotes.ts` |
| GET | /api/quotes/:symbol | public-or-mixed | `server/routes/quotesCore.ts` |
| GET | /api/quotes/latest | public-or-mixed | `server/routes/public/quotes.ts` |
| GET | /api/quotes/latest | public-or-mixed | `server/routes/quotesCore.ts` |
| GET | /api/status | public-or-mixed | `server/routes/public/status.ts` |
| GET | /api/status | public-or-mixed | `server/routes/publicCore.ts` |
| GET | /api/trades | trader | `server/routes/trader/trades.ts` |
| GET | /api/trades/history | trader | `server/routes/trader/trades.ts` |
| GET | /api/trades/open | trader | `server/routes/trader/trades.ts` |
| GET | /api/trades/pending | trader | `server/routes/trader/trades.ts` |
| GET | /api/verification/status | verification | `server/routes/verification.ts` |
| GET | /challenges/certificate/:id | other | `server/routes/trader-talent/certificates.ts` |
| GET | /challenges/certificate/:id/download | other | `server/routes/trader-talent/certificates.ts` |
| GET | /challenges/certificates/:id | other | `server/routes/trader-talent/certificates.ts` |
| GET | /metrics | platform | `server/routes/wsCore.ts` |
| PATCH | /api/admin/legal-docs/:id | admin | `server/routes/adminLegal.ts` |
| PATCH | /api/admin/legal-docs/system-config/enforcement | admin | `server/routes/adminLegal.ts` |
| PATCH | /api/trades/:id/cancel | trader | `server/routes/trader/tradeCancel.ts` |
| PATCH | /api/trades/:id/targets | trader | `server/routes/trader/tradeTargets.ts` |
| POST | /api/admin/daily-fx-closes/snapshot | admin | `server/routes/admin.ts` |
| POST | /api/admin/grift/alerts/:id/resolve | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/cases | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/cases/:id/notes | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/cases/:id/signals | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/ip2asn/enrich | admin | `server/routes/grift-admin/ops.ts` |
| POST | /api/admin/grift/ip2asn/reimport | admin | `server/routes/grift-admin/ops.ts` |
| POST | /api/admin/grift/maintenance/checkpoint | admin | `server/routes/grift-admin/ops.ts` |
| POST | /api/admin/grift/maintenance/vacuum | admin | `server/routes/grift-admin/ops.ts` |
| POST | /api/admin/grift/recompute/:userId | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/signals/:id/close | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/signals/:id/ignore | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/signals/:id/review | admin | `server/routes/grift.ts` |
| POST | /api/admin/grift/users/:userId/enforcement | admin | `server/routes/grift.ts` |
| POST | /api/admin/legal-docs | admin | `server/routes/adminLegal.ts` |
| POST | /api/admin/legal-docs/:id/activate | admin | `server/routes/adminLegal.ts` |
| POST | /api/admin/signup-waitlist/invite | admin | `server/routes/admin.ts` |
| POST | /api/admin/symbols | admin | `server/routes/admin.ts` |
| POST | /api/admin/users/:id/balance | admin | `server/routes/admin.ts` |
| POST | /api/admin/users/:id/settings | admin | `server/routes/admin.ts` |
| POST | /api/admin/users/:userId/evaluate-risk | admin | `server/routes/grift.ts` |
| POST | /api/admin/users/:userId/grift/disable | admin | `server/routes/grift.ts` |
| POST | /api/admin/users/:userId/grift/enable | admin | `server/routes/grift.ts` |
| POST | /api/admin/users/:userId/grift/freeze | admin | `server/routes/grift.ts` |
| POST | /api/admin/users/:userId/grift/unfreeze | admin | `server/routes/grift.ts` |
| POST | /api/admin/users/:userId/sessions/:sessionId/revoke | admin | `server/routes/adminSecurity.ts` |
| POST | /api/auth/login | auth | `server/routes/auth/login.ts` |
| POST | /api/auth/login | auth | `server/routes/authCore.ts` |
| POST | /api/auth/logout | auth | `server/routes/auth/logout.ts` |
| POST | /api/auth/logout | auth | `server/routes/authCore.ts` |
| POST | /api/auth/register | auth | `server/routes/auth/register.ts` |
| POST | /api/auth/register | auth | `server/routes/authCore.ts` |
| POST | /api/journal | public-or-mixed | `server/routes/trader/journal.ts` |
| POST | /api/legal/doc1/accept | legal | `server/routes/legal.ts` |
| POST | /api/me/logout | public-or-mixed | `server/routes/meSessions.ts` |
| POST | /api/me/sessions/:sessionId/revoke | public-or-mixed | `server/routes/meSessions.ts` |
| POST | /api/me/sessions/logout-others | public-or-mixed | `server/routes/meSessions.ts` |
| POST | /api/profile/account/deactivate | profile | `server/routes/profile/deactivate.ts` |
| POST | /api/profile/account/deactivate | profile | `server/routes/profileCore.ts` |
| POST | /api/profile/account/delete | profile | `server/routes/profile/deleteAccount.ts` |
| POST | /api/profile/account/delete | profile | `server/routes/profileCore.ts` |
| POST | /api/profile/change-password | profile | `server/routes/profile/changePassword.ts` |
| POST | /api/profile/change-password | profile | `server/routes/profileCore.ts` |
| POST | /api/profile/kyc/submit | profile | `server/routes/profile/kyc.ts` |
| POST | /api/profile/kyc/submit | profile | `server/routes/profileCore.ts` |
| POST | /api/profile/update | profile | `server/routes/profile/update.ts` |
| POST | /api/profile/update | profile | `server/routes/profileCore.ts` |
| POST | /api/promote-to-admin | public-or-mixed | `server/routes/admin.ts` |
| POST | /api/trades | trader | `server/routes/trader/tradeOpen.ts` |
| POST | /api/trades/:id/close | trader | `server/routes/trader/tradeClose.ts` |
| POST | /api/verification/email/send | verification | `server/routes/verification.ts` |
| POST | /api/verification/email/verify | verification | `server/routes/verification.ts` |
| POST | /api/verification/sms/confirm | verification | `server/routes/verification.ts` |
| POST | /api/verification/sms/start | verification | `server/routes/verification.ts` |
| POST | /api/waitlist | public-or-mixed | `server/routes/public/waitlist.ts` |
| POST | /api/waitlist | public-or-mixed | `server/routes/publicCore.ts` |
| PUT | /api/admin/global-settings | admin | `server/routes/admin.ts` |
| PUT | /api/admin/grift/cases/:id | admin | `server/routes/grift.ts` |
| PUT | /api/admin/grift/config | admin | `server/routes/grift-admin/ops.ts` |
| PUT | /api/admin/symbols/:id | admin | `server/routes/admin.ts` |
| PUT | /api/admin/system-config | admin | `server/routes/admin.ts` |
| PUT | /api/journal/:id | public-or-mixed | `server/routes/trader/journal.ts` |
| PUT | /api/profile/payout/currency | profile | `server/routes/profile/payout.ts` |
| PUT | /api/profile/payout/currency | profile | `server/routes/profileCore.ts` |
| PUT | /api/profile/preferences | profile | `server/routes/profile/preferences.ts` |
| PUT | /api/profile/preferences | profile | `server/routes/profileCore.ts` |
