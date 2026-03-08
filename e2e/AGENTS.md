# `e2e/` AGENTS.md (Playwright)

## What this area is
End-to-end tests (Playwright) plus a runbook-style spec.

## How to run
- First time: `npm run e2e:install`
- Run: `npm run e2e`

Notes:
- `npm run e2e` builds and seeds the DB before running tests.
- If you need a prod-like server for E2E, use `npm run start:e2e` (injects dummy secrets for non-email/SMS flows).

## Non-negotiables
- Keep tests deterministic (avoid sleeps; prefer explicit waits and stable selectors).
- Do not require real external credentials (Twilio/Resend) in CI/E2E paths.
- For repo-wide audits, decomposition reviews, and maintainability critiques that touch test coverage or recommendations, read `../.agents/audit-decomposition.md` first.
