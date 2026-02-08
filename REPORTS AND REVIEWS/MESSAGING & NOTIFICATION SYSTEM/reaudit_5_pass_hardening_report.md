# Messaging & Notification Re-Audit - 5 Pass Hardening Report

Date: 2026-02-08
Repo: TD.2.ANTIGRAVITY / TradeQuip
Scope: `mailbox_reaudit_report.md` + `mailbox_reaudit_report.md.resolved`

## References reviewed each pass
1. `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/PRD.md`
2. `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/algorithm.md`
3. `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/implementation_plan.md`
4. `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/mailbox_reaudit_report.md`
5. `REPORTS AND REVIEWS/MESSAGING & NOTIFICATION SYSTEM/mailbox_reaudit_report.md.resolved`

## Pass 1 - Gap Revalidation vs PRD/Algorithm/Plan
Focus:
- Verify re-audit "remaining minor gaps" against live implementation.

Findings:
- E2EE client-side compose/reply integration exists.
- Markdown rendering exists in mailbox/admin threads.
- Category filtering UI exists for user mailbox and admin inbox/sent.

Evidence:
- `client/src/lib/e2ee.ts`
- `client/src/components/Mailbox/MessageBody.tsx`
- `client/src/components/Mailbox/MailboxMinitab.tsx`
- `client/src/pages/AdminCommunications.tsx`

Result:
- Re-audit functional gaps are already implemented; next passes focused on hardening against abuse and bypass attempts.

## Pass 2 - Crypto and Envelope Validation Hardening
Focus:
- Tighten cryptographic input validation and envelope integrity checks.

Changes:
- Enforced RSA key type and modulus length bounds for mailbox public keys.
- Normalized sender/public-key fingerprints to strict SHA-256 hex format.
- Hardened E2EE envelope parser:
  - strict version/key/data algorithm checks,
  - base64 structural checks for iv/tag/ciphertext/encryptedKey,
  - exact recipient-set matching,
  - rejection of non-numeric/extra recipient keys.

Files:
- `server/services/messaging.ts`

## Pass 3 - Abuse Controls + Auditability Hardening
Focus:
- Block brute force/spam paths and increase forensic visibility.

Changes:
- Added per-user E2EE key-update throttling responses with `Retry-After` and deny audits.
- Added per-user mailbox reply throttling responses with `Retry-After` and deny audits.
- Added explicit identity audit events for:
  - key update success/deny,
  - reply success/deny,
  - invalid payload denies.
- Added sender fingerprint binding checks for compose/reply E2EE payloads:
  - require fingerprint when envelope is provided,
  - reject mismatch/unregistered fingerprints.

Files:
- `server/routes/mailbox.ts`

## Pass 4 - UI Contract and Responsiveness Recheck
Focus:
- Revalidate requested UX structure and small-screen behavior.

Verified:
- Account page now uses mini-tabs with `Account` and `Mailbox` at the same hierarchy.
- Admin `Communications` now has two top mini-tabs: `Messaging` and `Notifications`.
- Messaging and notification settings are exposed to admin configuration and propagated via live events (`communications:config-updated`).
- Notification popup panel bounds are viewport-clamped and recomputed on resize/orientation/scroll.

Files:
- `client/src/pages/AccountScreen.tsx`
- `client/src/pages/AdminCommunications.tsx`
- `client/src/hooks/use-mailbox.tsx`
- `client/src/hooks/use-notifications.tsx`
- `client/src/components/NotificationBell.tsx`

Runtime viewport verification:
- Playwright headless check with authenticated session:
  - `notifications-panel-viewport-check PASS 320x568`
  - `notifications-panel-viewport-check PASS 240x480`
  - `notifications-panel-viewport-check PASS 200x360`

## Pass 5 - Retest + Regression Sweep
Focus:
- Execute full validation matrix and targeted runtime abuse checks.

Automated checks:
- `npm run check` -> PASS
- `npm run build` -> PASS
- `npm run db:audit` -> PASS
- `npm run audit:activity` -> PASS
- `SMOKE_BASE_URL=http://localhost:5000 ADMIN_EMAIL=allinfini.ai@gmail.com ADMIN_PASSWORD=allinfini2026 npm run smoke:admin` -> PASS
- `npm run e2e` -> PASS (12/12)

Targeted runtime hardening checks:
- Invalid E2EE envelope with extra recipient key -> rejected with `E2EE_ENVELOPE_*` (PASS)
- E2EE key update flood -> `429 MAILBOX_E2EE_KEY_RATE_LIMIT` (PASS)
- Mailbox reply flood -> `429 MAILBOX_REPLY_RATE_LIMIT` (PASS)

## Security/attack hardening summary
Implemented defenses now cover:
- malformed E2EE envelope injection,
- recipient-set tampering attempts,
- sender-fingerprint spoofing attempts,
- key-update endpoint abuse,
- thread-reply spam abuse,
- deny/success audit traceability for mailbox security actions.

## Residual risk
- Reply/key-update rate limits are in-process memory maps; limits reset on process restart.
- For strict multi-node enforcement, move these limits to durable centralized storage (Valkey/Postgres-backed limiter).
