# Production Requirements (Living Ledger)

This file is the canonical ledger for production-only or production-critical requirements discovered during implementation, audits, and bug fixing.

## Update Protocol (Mandatory)
- When any new production requirement is discovered, append it here in the same change.
- Keep entries concrete and testable (no vague statements).
- Never place real secrets or credentials in this file.
- Include where enforcement lives (code path, manifest, runbook, or command).
- Include validation steps so operators can verify compliance.

## Entry Template
```
ID:
Date (UTC):
Scope:
Requirement:
Enforcement:
Validation:
Failure Mode if Missing:
```

## Current Production Requirements

### PRD-ENV-001
- ID: `PRD-ENV-001`
- Date (UTC): `2026-02-09`
- Scope: `Runtime encryption`
- Requirement: `ENCRYPTION_KEY` must be set in production as exactly 64 hex characters (32 bytes).
- Enforcement: `server/index.ts` startup validation and `server/services/crypto.ts` runtime guard.
- Validation:
  - `openssl rand -hex 32` to generate key.
  - Confirm env is set in runtime/secret source.
  - Start app with `NODE_ENV=production`; startup must show `ENCRYPTION_KEY: configured`.
- Failure Mode if Missing: startup aborts in production and encrypted mailbox/inquiry payloads cannot be safely handled.

### PRD-ENV-002
- ID: `PRD-ENV-002`
- Date (UTC): `2026-02-09`
- Scope: `Legal acceptance integrity`
- Requirement: `LEGAL_TERMS_HMAC_SECRET` must be configured and strong (minimum 32 characters).
- Enforcement: `server/index.ts` critical environment validation.
- Validation: start app and verify startup validation reports legal secret as configured.
- Failure Mode if Missing: legal compliance token signing cannot be trusted.

### PRD-ENV-003
- ID: `PRD-ENV-003`
- Date (UTC): `2026-02-09`
- Scope: `Session security`
- Requirement: `SESSION_SECRET` must be configured; minimum 32 characters is required for production-grade strength.
- Enforcement: `server/index.ts` startup validation.
- Validation: startup validation reports `SESSION_SECRET: configured`; rotate with strong random value.
- Failure Mode if Missing: session cookies cannot be securely signed.

### PRD-ENV-004
- ID: `PRD-ENV-004`
- Date (UTC): `2026-02-09`
- Scope: `Verification security hardening`
- Requirement: `EMAIL_VERIFY_TOKEN_SECRET` must be configured in production and should be at least 32 characters.
- Enforcement: `server/index.ts` production validation path.
- Validation: in production boot, verify no missing warning/fatal for email verification token secret.
- Failure Mode if Missing: verification token hashing is not properly keyed for production hardening.

### PRD-K8S-001
- ID: `PRD-K8S-001`
- Date (UTC): `2026-02-09`
- Scope: `Kubernetes secret management`
- Requirement: `tradehub-secrets` must include a real `ENCRYPTION_KEY` value before deploy; placeholders are not valid.
- Enforcement: `k8s/02-secrets.yaml` contract + production startup fail-fast.
- Validation:
  - `kubectl apply --dry-run=client -f k8s/`
  - ensure deployed secret contains valid 64-hex key.
- Failure Mode if Missing: pods fail startup in production due to critical env validation.

### PRD-SEC-001
- ID: `PRD-SEC-001`
- Date (UTC): `2026-02-09`
- Scope: `Partner portal transport security`
- Requirement: All `/api/partner/*` traffic must use HTTPS in production (loopback-only exception for local dev/e2e).
- Enforcement: `server/middleware/requirePartner.ts` transport guard (`PARTNER_HTTPS_REQUIRED` on insecure production transport).
- Validation:
  - Run app with `NODE_ENV=production`.
  - Call `/api/partner/data-room` over `http://` from non-loopback host and verify `426`.
  - Call over HTTPS and verify success path.
- Failure Mode if Missing: partner API keys and inquiry payload metadata can traverse insecure transport.

### PRD-SEC-002
- ID: `PRD-SEC-002`
- Date (UTC): `2026-02-09`
- Scope: `Partner inquiry end-to-end encryption`
- Requirement: Partner inquiry submissions must include valid E2EE envelope payloads and all routed recipient admins must have mailbox public keys.
- Enforcement: `server/routes/partnerPortal.ts` inquiry create validation + `server/services/messaging.ts` E2EE envelope verification + routing key checks in `server/partner/inquiryRouting.ts`.
- Validation:
  - `GET /api/partner/inquiries/recipients` returns `missingKeyCount = 0`.
  - `POST /api/partner/inquiries` without `e2eeEnvelope` fails with `INQUIRY_E2EE_REQUIRED`.
  - Valid envelope submission succeeds and creates mailbox thread linkage.
- Failure Mode if Missing: inquiry confidentiality and recipient-targeted encryption guarantees are broken.

### PRD-ADM-001
- ID: `PRD-ADM-001`
- Date (UTC): `2026-02-09`
- Scope: `Admin lockout prevention`
- Requirement: `scoutTabEnabled` must be managed from `/admin` System Config Controls (not only from Scout UI) so admins can always recover Scout visibility after disabling it.
- Enforcement: `client/src/pages/AdminDashboard.tsx` (System Config → Controls card and top-tab visibility binding) and `server/routes/admin.ts` (`/api/admin/system-config` get/put includes `scoutTabEnabled`).
- Validation:
  - Disable `Enable Scout tab` in System Config Controls and save.
  - Verify Scout top-level tab disappears while System Config remains accessible.
  - Re-enable `Enable Scout tab` in System Config Controls and save; verify Scout tab returns without DB/manual intervention.
- Failure Mode if Missing: disabling Scout can remove the only in-app recovery path, causing admin self-lockout from Scout features.
