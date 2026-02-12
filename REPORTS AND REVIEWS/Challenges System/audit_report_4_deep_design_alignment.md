# Challenges System Audit Report 4 (Deep Design Alignment)

**Date:** 2026-02-12  
**Scope:** `REPORTS AND REVIEWS/Challenges System/challenges_system_design.md` vs current implementation in `TD.2.ANTIGRAVITY`  
**Method:** Design clause traceability, code-line evidence, runtime validation (`check`, `build`, targeted `e2e`, dependency audit)

---

## 1) Executive Summary

**Overall status:** 🟡 **Substantially implemented with critical security/governance gaps still open**

Major progress since Audit 1/2/3:
- Core V4 schema is now present (multi-phase, events hash-chain, rewards, certificates, progression, leaderboard snapshot).
- Admin and trader challenge API surfaces are broadly implemented and mounted.
- Evaluation engine is phase-aware with reward issuance, warnings, failure precedence, and leaderboard refresh.
- Admin/trader UIs now expose the V4 tabbed surfaces and most workflows.
- Typecheck/build and targeted challenge E2E flow pass.

Remaining blocking gaps to claim full design conformance:
- **Security controls mismatch**: no explicit CSRF mechanism, no CSP header, no WS origin validation, no WS per-user connection cap/rate limiter.
- **Admin scheduler settings mismatch**: `challengeEvalIntervalMin`/`challengeEvalMaxRows` are persisted but not used by cron scheduler.
- **Enrollment caps not enforced in active trader enroll route**: `maxEnrollments`/`maxActiveEnrollments` enforcement exists in service helper but not the route path used by production.
- **UI/UX partials**: missing equity curve views and incomplete phase field editor coverage vs full design card spec.
- **Dependency risk**: `npm audit` reports one high-severity advisory in `axios <=1.13.4`.

---

## 2) Validation Commands Executed

1. `npm run check` ✅
- Result: pass (`tsc` successful).

2. `npm run build` ✅ (with warnings)
- Result: pass.
- Warnings: CSS selector warnings (`.@container-*`) and large JS chunk warnings (pre-existing build concerns).

3. `npm run e2e -- --grep "Recruitment ecosystem"` ✅
- Result: `1 passed` (challenge create/list/enroll/status flow).

4. `npm audit --omit=dev --audit-level=high` ❌
- Result: 1 high vulnerability (`axios` advisory GHSA-43fc-jf86-j433).

---

## 3) Prior Audit Closure (1/2/3)

| Prior audit claim | Current status | Evidence |
|---|---|---|
| Schema missing V4 tables | ✅ Closed | `shared/schema.pg.ts:1121`, `shared/schema.pg.ts:1152`, `shared/schema.pg.ts:1179`, `shared/schema.pg.ts:1220`, `shared/schema.pg.ts:1330`, `shared/schema.pg.ts:1361` |
| Admin/trader imports broken due missing schema | ✅ Closed | `server/routes/adminScout.ts:42`, `server/routes/traderTalent.ts:378`, `npm run check` pass |
| Engine still legacy | ✅ Closed | `server/recruitment/engines.ts:4`, `server/recruitment/challengesV4/challengeEvaluation.ts:1122` |
| Frontend still legacy | ✅ Closed | `client/src/components/admin/ScoutChallengesPanel.tsx:738`, `client/src/components/trader/ChallengesCompetePanel.tsx:188` |

---

## 4) Section-by-Section Design Alignment Matrix

## 4.1 Section 4: Challenge Template Design (Admin)

**Status:** 🟡 Partial

Implemented:
- Identity/capital/enrollment/reward/scheduling fields are represented in schema and admin validation:
  - `shared/schema.pg.ts:1016-1064`
  - `server/routes/adminScout.ts:156-247`
- Template CRUD + duplicate/archive/delete implemented:
  - `server/routes/adminScout.ts:1930`, `server/routes/adminScout.ts:1956`, `server/routes/adminScout.ts:2217`, `server/routes/adminScout.ts:2268`, `server/routes/adminScout.ts:3767`

Partial gaps:
- Admin phase editor UI does not expose full phase field set (e.g., `maxTotalLossPct`, `minTradingDays`, `maxSingleDayProfitPct`, weekend/news toggles, restricted symbols, concurrent positions, max lot) in editable controls:
  - UI currently shows subset at `client/src/components/admin/ScoutChallengesPanel.tsx:877-882`
  - Backend supports full set at `server/routes/adminScout.ts:227-242`
- Design allows phase `durationDays=0` (unlimited); API/schema require min 1:
  - `server/routes/adminScout.ts:376`

## 4.2 Section 5: Multi-Phase System

**Status:** 🟢 Implemented

Evidence:
- Phase-aware evaluation with advance/complete/fail:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1170-1372`
- Auto-advance controlled by system toggle:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1354`
- Enrollment phase cursor and phase start tracking:
  - `shared/schema.pg.ts:1101`, `shared/schema.pg.ts:1107`

## 4.3 Section 6: Capital Base Isolation

**Status:** 🟢 Implemented

Evidence:
- Snapshot/virtual capital captured at enrollment:
  - `server/routes/traderTalent.ts:754-759`, `server/routes/traderTalent.ts:848-850`
- Evaluation uses stored `capitalBaseUsed`:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1179-1187`
- All trades in window are evaluated (no challenge-specific trade tagging filter):
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1052-1057`

## 4.4 Section 7: Admin Dashboard Redesign

**Status:** 🟡 Partial

Implemented:
- 4 sub-tabs present (Templates, Enrollments, Analytics, Settings):
  - `client/src/components/admin/ScoutChallengesPanel.tsx:739-742`
- Enrollment detail includes timeline, gauges/progress, trade log, admin actions:
  - `client/src/components/admin/ScoutChallengesPanel.tsx:1076-1372`
- Settings cards + badge/certificate/progression CRUD exposed:
  - `client/src/components/admin/ScoutChallengesPanel.tsx:1598-1923`

Partial gaps:
- Design calls out Equity Curve in enrollment detail; not present in admin UI:
  - no equity curve rendering in `client/src/components/admin/ScoutChallengesPanel.tsx`

## 4.5 Section 8: Trader Experience

**Status:** 🟡 Partial

Implemented:
- Browse/My/Leaderboard/Rewards tabs:
  - `client/src/components/trader/ChallengesCompetePanel.tsx:188-191`
- Enrollment detail/events/trades and rewards/certificate links:
  - `client/src/components/trader/ChallengesCompetePanel.tsx:305-326`, `client/src/components/trader/ChallengesCompetePanel.tsx:367-384`

Partial gaps:
- Design requires full gauge set + equity curve in My Challenges; UI currently has PnL + daily-loss gauges, no equity curve:
  - `client/src/components/trader/ChallengesCompetePanel.tsx:279-285`
  - no equity curve rendering in `client/src/components/trader/ChallengesCompetePanel.tsx`

## 4.6 Section 9: Evaluation Engine Enhancements

**Status:** 🟢 Implemented (with one transactional caveat)

Implemented:
- Deterministic precedence: breach first, then pass/advance/complete, then warning:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1220-1439`
- Trailing drawdown and consistency rule implemented:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1192-1205`
- Rewards on completion (badges/boosts/certs/prize/progression) implemented:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:816-1028`

Caveat:
- State updates and event append are not consistently wrapped in one transaction per lifecycle transition path:
  - e.g., update then append in `server/recruitment/challengesV4/challengeEvaluation.ts:1231-1237`, `server/recruitment/challengesV4/challengeEvaluation.ts:1301-1307`

## 4.7 Section 10: Leaderboard & Rankings

**Status:** 🟡 Partial

Implemented:
- Global/per-challenge enable, anonymization, max visible, refresh interval behavior:
  - `shared/schema.pg.ts:1062-1064`, `shared/schema.pg.ts:770-772`
  - `server/recruitment/challengesV4/challengeEvaluation.ts:783-800`
  - `server/routes/traderTalent.ts:1025-1037`, `server/routes/traderTalent.ts:1055`

Partial gap:
- Design calls for configurable ranking metric (`PNL_PCT`/`COMPOSITE_SCORE`); no explicit config toggle found, ranking formula is fixed.
  - ranking formula in `server/recruitment/challengesV4/challengeEvaluation.ts:733-748`

## 4.8 Section 11: Rewards & Recognition

**Status:** 🟡 Partial

Implemented:
- Global + per-template hierarchy enforced for most reward types:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:816`, `server/recruitment/challengesV4/challengeEvaluation.ts:852`, `server/recruitment/challengesV4/challengeEvaluation.ts:877`, `server/recruitment/challengesV4/challengeEvaluation.ts:940`, `server/recruitment/challengesV4/challengeEvaluation.ts:993`
- Prize approval lifecycle with admin action and hash update:
  - `server/routes/adminScout.ts:3372-3407`

Partial gap:
- `customRewardJson` is persisted/configurable but no reward execution logic consumes it yet.
  - stored in `server/routes/adminScout.ts:2028`, `server/routes/adminScout.ts:3580`
  - no application path in evaluation engine

## 4.9 Section 12: Notifications & Mailing

**Status:** 🟢 Implemented

Evidence:
- `CHALLENGE` notification type and communication gating:
  - `server/services/messaging.ts:18`, `server/services/messaging.ts:1177-1179`
- Challenge events generate notifications and optional mailbox sends:
  - `server/recruitment/challengesV4/challengeEvaluation.ts:1259-1276`, `server/recruitment/challengesV4/challengeEvaluation.ts:1321-1338`, `server/recruitment/challengesV4/challengeEvaluation.ts:973-989`
- Admin manual notify from enrollment panel route implemented:
  - `server/routes/adminScout.ts:2574-2649`

## 4.10 Section 13: Security Hardening

**Status:** 🔴 Partial with critical open controls

Implemented controls:
- Parameterized DB access via Drizzle/sql tags in challenge paths.
- Strong endpoint input validation with Zod on major mutation routes.
- TLS-required API guard + HSTS/security headers:
  - `server/index.ts:250-260`, `server/index.ts:240-245`
- Session-bound WebSocket auth and heartbeat ping/pong:
  - `server/routes.ts:5474-5519`, `server/routes.ts:5435-5436`
- Hash-chained challenge events:
  - `server/recruitment/challengesV4/challengeEvents.ts:27-74`
- Notification E2EE path via messaging settings:
  - `server/services/messaging.ts:1211-1215`
- Admin-note encryption at rest:
  - `server/routes/adminScout.ts:96-113`, `server/routes/adminScout.ts:616`

Critical gaps vs section 13 design:
- No explicit CSRF protection mechanism found on challenge mutation endpoints.
  - repo search returned none for CSRF hooks/token checks
- No Content-Security-Policy header configured.
  - no CSP/helmet configuration found
- No explicit WS origin validation for upgrade requests.
- No WS per-user connection-limit enforcement.
- No WS per-connection/per-user message rate limiting.
- Cookie default is `SameSite=lax` (design requires strict by default):
  - `server/routes.ts:216`

Additional security/compliance gaps:
- Trader APIs expose hash-chain internals (`eventHash`, `prevHash`) contrary to output filtering intent:
  - `server/routes/traderTalent.ts:1147-1148`
- Trader enrollment detail returns raw enrollment object (includes admin note field path), violating strict least-exposure intent:
  - `server/routes/traderTalent.ts:1110`

## 4.11 Section 14: Analytics & Reporting

**Status:** 🟢 Implemented (UI presented as cards/lists rather than charts)

Evidence:
- Summary/funnel/pass-fail/breach/top/popularity/reward endpoints exist:
  - `server/routes/adminScout.ts:2871`, `server/routes/adminScout.ts:2923`, `server/routes/adminScout.ts:2946`, `server/routes/adminScout.ts:2968`, `server/routes/adminScout.ts:2987`, `server/routes/adminScout.ts:3015`, `server/routes/adminScout.ts:3037`
- Admin analytics tab consumes these datasets:
  - `client/src/components/admin/ScoutChallengesPanel.tsx:1377-1595`

## 4.12 Section 15: Schema Additions

**Status:** 🟢 Implemented

Evidence:
- `challenge_phases`: `shared/schema.pg.ts:1121`
- `challenge_enrollment_events`: `shared/schema.pg.ts:1152`
- rewards/certificate/progression/leaderboard tables: `shared/schema.pg.ts:1179`, `shared/schema.pg.ts:1220`, `shared/schema.pg.ts:1251`, `shared/schema.pg.ts:1274`, `shared/schema.pg.ts:1291`, `shared/schema.pg.ts:1330`, `shared/schema.pg.ts:1361`
- enhanced `challenges`, `challenge_enrollments`, `system_config`, `communication_settings`:
  - `shared/schema.pg.ts:1001-1064`, `shared/schema.pg.ts:1086-1110`, `shared/schema.pg.ts:739-772`, `shared/schema.pg.ts:530`
- migrations present:
  - `db/migrations/0025_challenges_v4_multiphase_rewards.sql`
  - `db/migrations/0026_challenges_eval_config.sql`
  - `db/migrations/0027_challenge_default_category_tier.sql`

## 4.13 Section 16: API Surface

**Status:** 🟢 Mostly implemented

Evidence:
- Admin surface: `server/routes/adminScout.ts:1930-3779`
- Trader surface + public cert verify: `server/routes/traderTalent.ts:378-1565`
- Mounted routes:
  - `server/routes.ts:4952`, `server/routes.ts:4956`, `server/routes.ts:4957`

Notable divergence from design “security” annotations:
- CSRF requirement in API matrix is not implemented.

## 4.14 Section 17: Integration Map

**Status:** 🟢 Implemented

Evidence:
- Messaging/live bus integration: `server/services/messaging.ts:1184+`
- Partner portal reward/challenge summary integration:
  - `server/routes/partnerPortal.ts:822-938`
- Risk/trade guardrail integration (active challenge only):
  - `server/recruitment/challengesV4/challengeService.ts:371-417`
  - `server/risk.ts:263-302`

## 4.15 Section 18: Data Flows

**Status:** 🟡 Partial

Implemented:
- Enrollment and evaluation lifecycle including event append + notifications are present.

Gap:
- Design requires transactionally coupled state transition + event append + post-commit notify discipline; current code executes these in sequence without a single per-transition transaction boundary in all paths.

## 4.16 Section 19: Repo-Grounded Addendum

**Status:** 🟡 Partial

Implemented:
- Existing route tree extension and scheduler reuse achieved.
- Challenge notification type integration achieved.
- Mailbox communication settings integration achieved.

Gaps:
- Baseline recommendation to expand E2E beyond enroll/status still open (only baseline scenario covered).
- Admin eval controls in DB not wired to scheduler runtime behavior.

---

## 5) Critical Findings (Ranked)

## Critical

1. **Missing explicit CSRF protection on challenge mutation endpoints**  
   Impact: cross-site state-changing request exposure for authenticated sessions.

2. **Missing WS origin validation, connection caps, and WS message rate limits**  
   Impact: higher MITM/session abuse surface and DoS vectors on `/ws`.

3. **Admin scheduler controls (`challengeEvalIntervalMin`, `challengeEvalMaxRows`) do not drive cron runtime**  
   Impact: governance drift; UI/settings imply control that production scheduler ignores.

4. **Dependency high vulnerability (`axios`)**  
   Impact: known high-severity advisory in production dependency graph.

## High

5. **Enrollment cap fields (`maxEnrollments`, `maxActiveEnrollments`) not enforced in trader enroll route used by API**  
   Impact: policy bypass for challenge capacity controls.

6. **Output-filtering mismatch for trader API (`eventHash`/`prevHash` exposed)**  
   Impact: leaks internal audit-chain internals to end users.

## Medium

7. **Phase card UX doesn’t expose all phase-level controls from design**  
   Impact: full admin configurability not realized in UI despite backend support.

8. **Equity curve absent from admin/trader enrollment detail views**  
   Impact: incomplete design parity for performance visualization.

9. **No configurable leaderboard ranking metric switch**  
   Impact: design calls for `PNL_PCT`/`COMPOSITE_SCORE` control; currently fixed formula.

10. **`customRewardJson` is config-only, not executable behavior**  
    Impact: extensibility placeholder exists but runtime reward pipeline ignores it.

11. **Certificate verification code generation uses deterministic chain hash, not explicit HMAC contract in design text**  
    Impact: design mismatch on cryptographic primitive specification.

---

## 6) Non-Interference Guardrail Check (Challenges vs Normal Trading)

**Result:** ✅ Guardrail intent is implemented.

Evidence:
- Challenge trade constraints are only applied when user has active challenge enrollment(s):
  - `server/recruitment/challengesV4/challengeService.ts:385-387`
- Risk middleware applies challenge checks conditionally (`if (challengeConstraints)`):
  - `server/risk.ts:263-302`

Users not in active challenges continue through standard trading limits only.

---

## 7) Recommended Next Fix Sequence

1. Implement CSRF protections for all challenge mutation routes and enforce token validation server-side.
2. Add WS origin allowlist checks, per-user connection caps, and message-rate limiting.
3. Wire scheduler to `system_config` challenge eval interval/max-rows settings (or remove these settings if env-only by policy).
4. Enforce `maxEnrollments` and `maxActiveEnrollments` in the active trader enroll route.
5. Resolve `axios` advisory with tested dependency update.
6. Complete UI parity: full phase-field editor + equity curve modules.
7. Tighten trader API output filtering for internal hash/admin-note fields.

---

## 8) Final Verdict

The challenges system is no longer in the “phantom/broken” state from audits 1–3; it is now functionally present end-to-end with successful compile/build and baseline challenge E2E pass. However, **it is not yet fully aligned item-by-item with the design’s security and governance requirements**, and should not be marked “fully complete” until the critical gaps above are closed.

---

**Production Requirements Ledger note:** This audit introduced no new runtime requirement beyond already documented security/governance expectations in the design; no ledger append required for this audit-only pass.
