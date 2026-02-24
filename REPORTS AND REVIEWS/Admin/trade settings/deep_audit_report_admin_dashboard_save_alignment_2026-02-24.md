# Deep Audit Report: Admin Dashboard Save Behavior + Toast Alignment

Date: 2026-02-24
Repo: `TD.2.ANTIGRAVITY`
Auditor: Codex (GPT-5)
Primary file patched: `client/src/pages/AdminDashboard.tsx`
Reference docs used:
- `REPORTS AND REVIEWS/Admin/trade settings/audit_report_trade_settings.md`
- `REPORTS AND REVIEWS/Admin/trade settings/save button mutations admin dashboard_implementation_plan.md`
- `REPORTS AND REVIEWS/Admin/trade settings/deep_audit_report_codex_round2_2026-02-24.md`

## 1) Objective
Perform a deep audit of uncommitted Gemini-intended admin save-flow changes across the Admin Dashboard (not only Trade Settings), verify no malicious behavior, detect breakages/functionality loss risk, and surgically align save behavior + save toast specificity.

## 2) Audit Scope
Admin Dashboard save paths reviewed in:
- `SystemConfigTab` (Trading, Market Data, Signup Compliance, Signup Freeze/Waitlist, Jurisdiction, Controls)
- Trade Settings tab (Capital, Market Hours, Default Risk, Operational Risk/Lot)
- Existing save-capable tabs/components reviewed for regressions and security posture (I18n, Market Performance, Migration, KYC controls, user edit, symbols, etc.)

## 3) What Gemini Was Trying To Do (Intent Reconstruction)
From the referenced implementation plan and observed prior diffs, Gemini’s intent was:
1. Decouple Save buttons by card/section so one field change does not activate unrelated Save buttons.
2. Save only section-relevant payload fields (partial updates) instead of broad/global payloads.
3. Emit card-specific success toasts instead of a generic “Settings saved”.

This intent is valid and aligned with operational safety/usability, but prior refactor attempts introduced structural and logic regressions (already hard-reverted in previous round before this pass).

## 4) Security + Maliciousness Assessment
Result: **No malicious code indicators found**.

Checked and not found:
- Exfiltration endpoints or suspicious outbound traffic.
- Secret harvesting, token leakage, hidden telemetry additions.
- Dynamic code execution injection (`eval`/unsafe runtime code paths).
- Compliance gate bypasses intentionally introduced in save flows.

Risk profile was regression/incomplete refactor risk, not hostile code.

## 5) Functional/Vulnerability Findings (Pre-Patch State)

### High: Cross-card save coupling in System Config
- Multiple cards used one shared `configChanged` flag and one shared save handler.
- Side effect: changing one card could enable Save in other cards and submit unrelated config sections.

### High: Generic save mutation payload in System Config
- Broad save path submitted full config object for card-level Save buttons.
- Potential behavior risk: unintended writes to unrelated fields during a section save.

### Medium: Non-specific success toasts for System Config
- Generic “Settings saved” toast did not identify which card persisted changes.
- Operational auditability/UX ambiguity during admin workflows.

### Medium: Unsaved-change overwrite risk during partial-save scenarios
- Without section-aware dirty gating, remote query refresh could overwrite unsaved edits in other sections.

### Existing Trade Settings status
- Trade Settings had already been surgically decoupled in prior round.
- Needed final toast specificity alignment per section.

## 6) Surgical Patch Applied
All changes were constrained to:
- `client/src/pages/AdminDashboard.tsx`

### SystemConfigTab save behavior aligned
Implemented section-level dirty checks against server source (`config` vs `systemConfig`):
- `isTradingControlsChanged`
- `isMarketDataSettingsChanged`
- `isSignupComplianceChanged`
- `isSignupFreezeWaitlistChanged`
- `isJurisdictionControlsChanged`
- `isSessionAndAccessControlsChanged`
- aggregate guard: `hasSystemConfigUnsavedChanges`

### Sync guard hardening
- System config local state now resyncs from server only when no section has unsaved edits.
- Prevents unsaved local section edits from being overwritten by refresh/invalidation.

### Save handlers decoupled by section (partial payloads)
Added section-scoped save handlers that submit only related fields:
- `handleSaveTradingControls`
- `handleSaveMarketDataSettings`
- `handleSaveSignupCompliance`
- `handleSaveSignupFreezeWaitlist`
- `handleSaveJurisdictionControls`
- `handleSaveSessionAndAccessControls`

### Save toast specificity aligned
Each section now emits targeted success toasts:
- “Trading Controls Saved”
- “Market Data Settings Saved”
- “Signup Compliance Saved”
- “Signup Freeze & Waitlist Saved”
- “Jurisdiction Controls Saved”
- “Session & Access Controls Saved”

### Trade Settings toast specificity finalized
Updated section success toasts/descriptions:
- “Capital Settings Saved”
- “Market Hours Saved”
- “Risk Parameters Saved”
- “Operational Risk & Lot Settings Saved”

### What was intentionally preserved
- Existing API contracts (`PUT /api/admin/system-config`, `PUT /api/admin/global-settings` partial payload support).
- Existing auto-invite summary toasts on unfreeze flow.
- Existing I18n, Market Performance, Migration, KYC, user/symbol operational flows.
- No destructive refactor outside required surfaces.

## 7) Regression/Breakage Checks
Executed:
- `npm run check` -> PASS
- `npm run build` -> PASS

Observed:
- Non-blocking Vite chunk-size warnings remain pre-existing.
- No compile/runtime contract break introduced by the patch.

## 8) Enhancement Attempts Completed
Completed enhancements aligned to Gemini’s intended direction:
1. Card-level save decoupling across full System Config admin surface.
2. Section-scoped persistence payloads to minimize accidental cross-section writes.
3. Specific success toast messaging for each save context.

## 9) Residual Risk Notes
- Other admin submodules outside `AdminDashboard.tsx` may still use generic toast labels (“Saved”) by design; no functional regression found there in this pass.
- If desired, a follow-up normalization pass can standardize toast wording repo-wide without behavior changes.

## 10) Net Result
- Deep audit complete for requested admin save-behavior scope.
- No malicious changes found.
- Coupling and ambiguity issues addressed surgically.
- Functionality preserved; compile + build verified.

## 11) Production Requirements Ledger Impact
- No new production/runtime/deployment requirement discovered.
- No update to `.agents/PRODUCTION_REQUIREMENTS.md` required for this patch.
