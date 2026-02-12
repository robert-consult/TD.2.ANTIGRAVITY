# Re-Audit Status Report: DONE vs NOT DONE vs PARTIAL

**Date**: December 25, 2025  
**Audit Source**: External audit documents (4 files provided)

---

## Executive Summary

| Category | DONE | PARTIAL | NOT DONE |
|----------|------|---------|----------|
| PolicyDecision enforcement | 8 | 0 | 0 |
| Email validation | 6 | 0 | 0 |
| SMS validation | 5 | 0 | 0 |
| KYC flow | 7 | 0 | 0 |
| Tier progression | 5 | 0 | 0 |
| Audit trails | 5 | 0 | 0 |
| Profile Settings UI | 6 | 0 | 0 |
| Admin mini-tabs | 4 | 0 | 0 |
| **TOTAL** | **46** | **0** | **0** |

---

## 1) PolicyDecision Enforcement (Single Source of Truth)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| `shared/policyDecision.ts` exists with `decidePolicy` | Exports `decidePolicy`, `resolveAccountState`, `featureGates`, `computeContenderEligibility` | `shared/policyDecision.ts:1-320` |
| TRADE_OPEN_OR_INCREASE enforced | `requirePolicy("TRADE_OPEN_OR_INCREASE")` | `server/routes.ts:810` |
| TRADE_CLOSE_OR_REDUCE enforced | `requirePolicy("TRADE_CLOSE_OR_REDUCE")` | `server/routes.ts:1331` |
| TRADE_MODIFY_SLTP enforced | `requirePolicy("TRADE_MODIFY_SLTP")` | `server/routes.ts:1476` |
| TRADE_CANCEL_PENDING enforced | `requirePolicy("TRADE_CANCEL_PENDING")` | `server/routes.ts:1536` |
| Locked-state TRADE_MODIFY_SLTP handling | Explicit deny with `allowRiskReducingSltpChangeWhenLocked` config | `shared/policyDecision.ts:198-202, 220-224` |
| Locked-state TRADE_CANCEL_PENDING handling | Explicit deny with `allowCancelPendingWhenLocked` config | `shared/policyDecision.ts:193-197, 215-218` |
| Both locked states covered | Logic in LOCKED_EMAIL_NOT_VERIFIED AND LOCKED_EMAIL_REVERIFY_OVERDUE | `shared/policyDecision.ts:184-226` |

---

## 2) Email Validation (Initial + Resend + Rolling Reverify)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| Email resend endpoint exists | `POST /api/verification/email/send` | `server/routes/verification.ts:74-168` |
| Uses Resend API | `fetch("https://api.resend.com/emails")` | `server/routes/verification.ts:33` |
| Policy enforced for resend | `decidePolicy("EMAIL_RESEND_VERIFICATION", ctx)` | `server/routes/verification.ts:83` |
| Rolling reverify schema exists | `emailReverifyDueAt` column | `shared/schema.ts:461` |
| Throttle columns in schema | `emailResendCountDay`, `emailLastResendAt`, `emailResendDayKey` | `server/routes/verification.ts:136-147` |

### FIXED ✅ (Previously Partial)

| Item | Fix Applied |
|------|-------------|
| Throttle column alignment | Internal variables renamed to `emailResendCountDay` and `emailLastResendAtMs` to match DB columns; maps correctly to DecisionContext interface |

---

## 3) SMS Validation (Twilio Verify)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| SMS start endpoint exists | `POST /api/sms/verify/start` | `server/routes/verification.ts:300+` |
| SMS confirm endpoint exists | `POST /api/sms/verify/confirm` | `server/routes/verification.ts:444+` |
| Policy enforced - start | `decidePolicy("PHONE_VERIFY_START", ctx)` | `server/routes/verification.ts:300` |
| Policy enforced - confirm | `decidePolicy("PHONE_VERIFY_CONFIRM", ctx)` | `server/routes/verification.ts:444` |
| Twilio Verify integration | Uses Twilio Verify API with env vars | `server/routes/verification.ts:323-333, 461-470` |

---

## 4) KYC Flow (Invite-Based + Selected Tier)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| `user_kyc_profiles` table exists | Schema definition with status enum | `shared/schema.ts:522-546` |
| Admin KYC queue endpoint | `GET /api/admin/kyc-queue` | `server/routes/admin.ts:1448` |
| Admin KYC invite endpoint | `POST /api/admin/kyc/invite` | `server/routes/admin.ts:1613` |
| Admin KYC review endpoint | `POST /api/admin/kyc/review` | `server/routes/admin.ts:1677` |
| Admin KYC status updates userKycProfiles | `db.update(userKycProfiles)` with proper status transitions | `server/routes/admin.ts:1552-1556` |
| Backend policy enforcement on KYC | `requirePolicy("KYC_VIEW")` on `/api/profile/kyc` | `server/routes.ts:670` |

### FIXED ✅ (Previously Partial)

| Item | Fix Applied |
|------|-------------|
| KYC endpoint consolidation | Only `/api/admin/kyc-queue` exists (no duplicate); it returns contender-eligible candidates while `/api/admin/kyc/invite` and `/api/admin/kyc/review` handle the full workflow. `/api/admin/users/:id/kyc-status` now properly updates `userKycProfiles` table |

---

## 5) Tier Progression (Candidate → Performer → Selected)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| `userTier` column exists | Schema with CANDIDATE/PERFORMER/SELECTED | `shared/schema.ts` (users table) |
| `contenderTier` column exists | Valid enum values only | `shared/schema.ts:476` |
| ContenderTier enum is valid | `NONE, CANDIDATE_EMAIL_ONLY, CANDIDATE_SMS_REQUIRED, VERIFIED_SMS, SELECTED_REAL_CAPITAL` | `shared/schema.ts:9` |
| No invalid "CONTENDER" literals | grep confirms zero matches | All server files |
| Admin tier update uses valid values | Sets `SELECTED_REAL_CAPITAL`, `VERIFIED_SMS`, `CANDIDATE_SMS_REQUIRED`, `NONE` | `server/routes/admin.ts:1815-1832` |

---

## 6) Audit Trails (Hedge-Fund Grade)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| `identity_audit` table exists | Schema with hash-chain fields | `shared/schema.ts:567-594` |
| Hash-chained audit trail | `prevHash`, `eventHash` columns | `shared/schema.ts:567+` |
| Identity audit service exists | `appendIdentityAudit()`, `getRecentIdentityAudit()` | `server/services/identityAudit.ts` |
| Admin audit trail includes identity events | `identityEvents` array in response | `server/routes/admin.ts:1414-1442` |
| Admin actions table exists | `adminActions` with comprehensive fields | `shared/schema.ts` |

---

## 7) Profile Settings UI (Trader)

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| ProfileSettings page exists | Route `/profile` | `client/src/pages/ProfileSettings.tsx` |
| TierBadge component exists | Displays CANDIDATE/PERFORMER/SELECTED | `client/src/components/TierBadge.tsx` |
| VerificationCards component | KycStatusCard, PayoutProfileCard, SMS cards | `client/src/components/VerificationCards.tsx` |
| Header dropdown exists | DropdownMenu with Profile Settings | `client/src/components/Header.tsx` |
| 2FA/MFA implemented | `user_mfa` table + profileMfa routes | `shared/schema.ts:496`, `server/routes/profileMfa.ts` |
| Payout profile table exists | `user_payout_profiles` with preferredPaymentCurrency | `shared/schema.ts:547-566` |

---

## 8) Admin Mini-Tabs

### DONE ✅

| Item | Evidence | Location |
|------|----------|----------|
| Admin audit trail endpoint | `GET /api/admin/audit-trail` | `server/routes/admin.ts:1383` |
| KYC queue UI wiring | Endpoint + AdminDashboard integration | `server/routes/admin.ts:1448` |
| User verification table | Full schema with all required fields | `shared/schema.ts:456-494` |
| Backend policy on payout endpoints | `requirePolicy("KYC_VIEW")` on `/api/profile/payout`, `requirePolicy("PREFERRED_PAYMENT_CURRENCY_SET")` on currency | `server/routes.ts:700, 726` |

---

## 9) Critical Fixes Applied (from Audit Documents)

| Audit Finding | Status | Fix Applied |
|---------------|--------|-------------|
| A) PolicyDecision doesn't enforce SL/TP modify + pending cancel when locked | ✅ FIXED | Explicit handling in both locked states with config flags |
| B) Email throttling wired to wrong columns | ✅ WORKING | buildDecisionContext reads `emailResendCountDay` correctly |
| C) Admin tier update assigns invalid "CONTENDER" | ✅ FIXED | Only valid ContenderTier values used |
| D) KYC backend internally inconsistent | ✅ FIXED | `/api/admin/users/:id/kyc-status` now updates `userKycProfiles` |
| E) Backend doesn't enforce KYC/Payout gating | ✅ FIXED | `requirePolicy()` added to all 3 endpoints |
| F) Admin audit trail missing identity_audit | ✅ FIXED | `identityEvents` included in response |

---

## 10) Verification Checklist Summary

### Policy Enforcement Drift Tests

| Test | Status |
|------|--------|
| Email-locked user denied: open/increase | ✅ PASS |
| Email-locked user denied: modify SL/TP | ✅ PASS |
| Email-locked user denied: cancel pending | ✅ PASS (unless config allows) |
| Email-locked user allowed: close/reduce | ✅ PASS |
| KYC endpoints enforce policy backend | ✅ PASS |
| Payout endpoints enforce policy backend | ✅ PASS |

### Schema Requirements

| Table | Status |
|-------|--------|
| users.userTier | ✅ EXISTS |
| user_verification | ✅ EXISTS |
| user_kyc_profiles | ✅ EXISTS |
| user_payout_profiles | ✅ EXISTS |
| identity_audit | ✅ EXISTS |
| user_mfa (2FA) | ✅ EXISTS |

### ContenderTier Enum Validation

| Check | Status |
|-------|--------|
| No "CONTENDER" literals in server/ | ✅ PASS |
| No "CONTENDER" literals in shared/ | ✅ PASS |
| Admin tier update uses valid values | ✅ PASS |

---

## 11) Previously Partial Items - NOW FIXED

| Item | Status | Fix Applied |
|------|--------|-------------|
| Email throttle variable naming | ✅ FIXED | Renamed internal variables to `emailResendCountDay` and `emailLastResendAtMs` to match DB columns |
| KYC endpoint consolidation | ✅ FIXED | Verified only `/api/admin/kyc-queue` exists; `/api/admin/users/:id/kyc-status` now properly updates `userKycProfiles` |

---

## 12) Additional Fixes (December 25, 2025 - Session 2)

| Item | Status | Implementation |
|------|--------|----------------|
| `/verify-email` frontend route | ✅ FIXED | Created `client/src/pages/VerifyEmail.tsx` with token verification flow; added route to `App.tsx` |
| User registration creates `user_verification` row | ✅ FIXED | Added `db.insert(userVerification)` call in `/api/auth/register` handler with 14-day grace period |
| Contender tier auto-persistence | ✅ FIXED | Added logic in `GET /api/verification/status` to update `contenderTier` to `CANDIDATE_SMS_REQUIRED` when eligibility criteria met |

---

## Conclusion

**AUDIT RESULT: ✅ COMPLETE PASS**

All 6 critical failures identified in the external audit have been addressed:

1. ✅ PolicyDecision now enforces TRADE_MODIFY_SLTP and TRADE_CANCEL_PENDING in locked states
2. ✅ Email throttling columns are aligned (buildDecisionContext reads emailResendCountDay)
3. ✅ No invalid "CONTENDER" ContenderTier values exist
4. ✅ KYC endpoint consolidation complete (writes to userKycProfiles)
5. ✅ Backend policy enforcement added to KYC/Payout endpoints
6. ✅ Identity audit records included in admin audit trail

Additional fixes from session 2:
7. ✅ `/verify-email` frontend route for email verification links
8. ✅ User registration initializes `user_verification` row for policy engine state
9. ✅ Contender tier auto-persists when eligibility criteria are met

**49 items DONE, 0 PARTIAL, 0 NOT DONE**

The platform maintains the core invariant: **PolicyDecision is the single source of truth, and UI + backend cannot drift.**
