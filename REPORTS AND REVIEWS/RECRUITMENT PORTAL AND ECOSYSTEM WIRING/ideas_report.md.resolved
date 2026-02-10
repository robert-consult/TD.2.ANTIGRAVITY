# Enhancing TradeQuip for Trader Recruiting & Scouting

## Implementation Status (2026-02-09)

### Execution Outcome
- Core recruitment ecosystem modules in Section 5.2 are implemented and wired into `server/routes.ts`, `server/index.ts`, and the admin/trader UI surfaces.
- Endpoints, migrations, middleware, and cron engines were reconciled against the PRD contract, including missing route additions (`candidate detail`, `pipeline list`, `partner deactivate`).
- Security hardening applied:
  - `PARTNER_READY` eligibility now validates legal-compliance state in addition to tier and KYC.
  - Partner tear-sheet payloads keep strict anonymity boundaries (no profile free-text exposure).
  - Partner auth remains API-key hash + IP whitelist + config kill-switch.
- Runtime hardening applied:
  - Background recruitment jobs now run with bounded pass sizes (`maxRows`/`maxUsers`) to avoid unbounded work.

### Validation Snapshot
- Type/build/db and recruitment E2E coverage executed against implemented routes and UI wiring.
- Added E2E assertions for:
  - admin candidate detail endpoint,
  - admin pipeline list endpoint,
  - partner deactivation path + key invalidation.

### Current Iteration Notes
- Community features are shipped as baseline controls/surfaces and remain intentionally extensible for richer spectator streams.
- MAE/MFE calculations are live when excursion inputs exist; fidelity continues to depend on upstream intraday capture completeness.

## Executive Summary
This report details the granular specifics for the **Scout System**, **Partner Portal**, and **Trader Dashboard**. It integrates:
1.  Researched quant formulas (Sharpe, Sortino, Calmar, MAE, MFE).
2.  Existing codebase features (`runTraderScoutSearch`, `userTier` system, `VerificationCards`).
3.  Strict configurability and Admin-first design.

---

## 🔒 Core Mandates
1.  **Strict Anonymity**: Partners see ONLY `User-7X9B2` (Encrypted ID).
2.  **Admin Sovereignty**: All communications flow through Admin.
3.  **Global Feature Toggles**: All new features controllable via `system_config`.

---

## 1. Admin Dashboard (New "SCOUT" Main Tab)
*Placement: Top-level tab, positioned **before** "SYSTEM CONFIG".*

### A. Sub-Tab: Discovery Engine ("Alpha Hunter")
*Goal: Surface risk-adjusted alpha, not lucky streaks.*

#### 1. The "Quant Matrix" (Advanced Filtering)
> *This engine calculates and surfaces institutional-grade metrics.*

| Metric | Formula | Implementation | Target |
|--------|---------|----------------|--------|
| **Sharpe Ratio** | `(Average Return - Risk-Free Rate) / Std Dev of Returns` | Nightly job, store in `scout_metrics_snapshot` | > 2.0 |
| **Sortino Ratio** | `(Average Return - Target) / Downside Deviation` | Only penalizes `returns < 0` | > 3.0 |
| **Calmar Ratio** | `CAGR / Maximum Drawdown` | Uses existing `maxDrawdown` from `runTraderScoutSearch` | > 1.5 |
| **Profit Factor** | `Gross Profit / Gross Loss` | ✅ **Already exists** in `runTraderScoutSearch` | > 2.0 |
| **Win Rate** | `Winning Trades / Total Trades` | ✅ **Already exists** | > 55% |
| **Equity Curve R²** | `Coefficient of Determination` on cumulative P&L vs time | Measures smoothness | > 0.90 |
| **MAX Drawdown** | `Peak-to-Trough / Peak` | ✅ **Already exists** | < 10% |

**Codebase Connection:**
*   `server/routes/admin.ts` → `runTraderScoutSearch` already calculates: `winRate`, `netProfit`, `grossProfit`, `grossLoss`, `profitFactor`, `maxDrawdown`, `avgHoldSec`, `slUsage`, `tpUsage`.
*   **Gap**: Sharpe, Sortino, Calmar, R² are **NOT** currently calculated. Requires a new nightly job.

#### 2. Trade-Level Metrics (MAE/MFE)

| Metric | Definition | Purpose |
|--------|------------|---------|
| **MAE (Max Adverse Excursion)** | Largest intraday loss from entry before close | "How much heat did the trader take?" High MAE = poor stop placement or holding losers. |
| **MFE (Max Favorable Excursion)** | Largest intraday gain from entry before close | "Did the trader exit too early?" If MFE >> Profit, they're leaving money on the table. |
| **MAE/MFE Ratio** | `Avg MAE / Avg MFE` | Target < 0.5. A ratio >1 means the trader consistently exits winners too early and rides losers. |

**Codebase Connection:**
*   **Gap**: MAE/MFE not currently tracked. Requires storing intraday high/low per trade in `trades` table or a new `trade_excursions` table.

#### 3. Behavioral Clustering ("Style Drift Detector")

| Cluster | Criteria | Detection Logic |
|---------|----------|-----------------|
| *Sniper* | High win rate (>70%), Low frequency (<3 trades/day), High Avg Win/Loss Ratio (>2) | High conviction, patient. |
| *Scalper* | Ultra-high frequency (>20/day), Mean-reverting, Avg hold < 5 mins | Requires low latency, low spread. |
| *Swing* | Multi-day hold (>24 hrs), Volatility tolerance | Can handle overnight risk. |
| *News Trader* | Executions correlate with vol spikes > 2 sigma on major symbols | Reactive, event-driven. |

**Drift Alert**: "User classified as 'Scalper' suddenly holding positions for 3 days." (Red Flag → Notify Admin).

#### 4. Watchlist Management ("The Shortlist")
*   **Tiers**: *A-List* (Allocatable), *B-List* (Monitoring), *Incubator* (High Potential / High Risk).
*   **Automated Monitors**: "Alert me if A-List candidate breaches 5% DD."
*   **DB Table**: `scout_watchlists` (admin_id, user_id, tier, notes, created_at).

---

### B. Sub-Tab: Recruitment CRM ("Talent Pipeline")
*Goal: Human lifecycle management from detection to contract.*

> [!IMPORTANT]
> **This tab MUST integrate with existing features:**
> *   `UserActivityAdmin.tsx` (Inactivity, Bot Detection).
> *   `VerificationCards.tsx` (Email, SMS, KYC, Payout Profile).
> *   `policyDecision.ts` (CANDIDATE → PERFORMER → SELECTED tiers).

#### Pipeline Stages (Unified Model)
| Stage | Description | Existing Feature Link |
|-------|-------------|-----------------------|
| *Detected* | Algo flagged (Sharpe > 2.0) | New (Scout Discovery) |
| *Watchlist* | Admin pinned for manual monitoring | New (Scout Watchlist) |
| *Contacted* | Admin sent internal "Mailbox" message | `mailboxThreads`, `mailboxMessages` |
| *Vetted (Email)* | Email verified | `UserTier=CANDIDATE`, `EmailVerificationCard` |
| *Vetted (SMS)* | SMS verified | `ContenderTier=VERIFIED_SMS`, `SmsVerificationCard` |
| *Performer* | Meets trading thresholds (auto-promoted) | `UserTier=PERFORMER`, `policyAutoPromotePerformer` |
| *Selected (KYC)* | Admin manually selects, KYC initiated | `UserTier=SELECTED`, `KycStatusCard` |
| *Partner Ready* | KYC Approved, Visible in Partner Portal | New flag: `is_partner_visible` |

#### The "Golden Record" Profile
A single view merging:
*   **Performance**: (From Scout Discovery: Sharpe, Sortino, Calmar, P/L).
*   **Verification**: (Email, SMS, KYC status from `VerificationCards`).
*   **Legal/KYC**: (Status from `kyc_profiles`).
*   **Notes**: (Admin-only internal notes).

---

### C. Sub-Tab: Config ("Kill Switches")
*Goal: Fine-grained control over the ecosystem.*

| Toggle | Description | Scope |
|--------|-------------|-------|
| `enable_partner_portal` | Master switch for the external site. | Global |
| `enable_scout_tab` | Show/hide Scout tab in Admin Dashboard. | Admin |
| `enable_pro_profiles` | Allow traders to fill out "Bio" and "Strategy" fields. | Trader |
| `enable_trader_compete` | Enable/Disable "Combine" challenges. | Trader (*OPTIONAL*) |
| `enable_partner_allocations` | Enable/Disable virtual capital deployment. | Partner (*OPTIONAL*) |
| `show_leaderboards_globally` | Public leaderboards vs. "Top 10 Only" vs. "Disabled". | Trader |

---

## 2. Partner Portal (Restricted External View)
*Access: Initially, debug link in Admin Home dropdown (next to Admin Dashboard). Eventually a separate URL.*

> [!NOTE]
> **Partner Portal is OPTIONAL and configurable via `enable_partner_portal` toggle.**

### A. Tab: Data Room (Blind Analytics)
*Goal: Institutional Due Diligence (No PII).*

#### The "Tear Sheet" (Standard HF Format)
*   **Anonymized Header**: `User-7X9B2` | *Scalper* | *Score: 94/100*.
*   **Monthly Returns Heatmap**: Table of Jan-Dec returns, colored by performance.
*   **Attribution Analysis**:
    *   *Long/Short Exposure*: Net exposure over time.
    *   *Asset Class Breakdown*: "Profit came 80% from XAUUSD." (Uses `assetMix` from `runTraderScoutSearch`).
    *   *Hour of Day*: "Losses cluster around 14:00 (News events)."
*   **Drawdown Profile**: Underwater chart showing depth and duration.

### B. Tab: Allocations (Paper Trading) - *OPTIONAL*
> `enable_partner_allocations` must be TRUE.

*   **Virtual Managed Account (vSMA)**: Partner allocates virtual capital.
*   **Simulation Engine**: Tracks candidate's future % returns applied to vSMA.
*   **Shadow Risk**: Partner sets *Shadow Stops*. "If vSMA drops 3%, cut allocation."

### C. Tab: Communications (Proxy)
*   **RFI (Request for Information)**: Partner submits query.
*   **Workflow**: Partner → Admin (Sanitize) → Trader → Admin (Sanitize) → Partner.
*   **Integration**: Uses existing `mailboxThreads`, `mailboxMessages` with a new `message_type: PARTNER_RFI`.

---

## 3. Trader Dashboard (New "Talent" Features)
*Placement: Leaderboard Tab extended with sub-tabs.*

### A. Sub-Tab: Leaderboard (Public)
*   ✅ **Already exists** (`LeaderboardScreen.tsx`).
*   **Enhancement**: Add "My Rank" indicator.

### B. Sub-Tab: My Resume ("Pro Profile")
*   **The "Edge" Statement**: Text field for strategy thesis.
*   **Verified Milestones**: "Profitable 6 Months", "Max DD < 5%", "Funded".
*   **Pinned "Game Tape"**: Interactive chart of their best executed trade (uses Journal integration).

### C. Sub-Tab: Compete (Assessment) - *OPTIONAL*
> `enable_trader_compete` must be TRUE.

*   **Combine Challenges**: Admin creates challenges with rules (Profit Target, Max DD).
*   **Rules Engine**: Live view of "Distance to Target" and "Distance to Violation".

### D. Sub-Tab: Community - *OPTIONAL*
> `enable_trader_community` must be TRUE.

*   **Spectator Feed**: Live streams of active "Pro" traders (if opted-in).

---

## 4. Technical Architecture

### A. New Database Tables
```sql
-- Scout metrics snapshot (nightly job output)
CREATE TABLE scout_metrics_snapshot (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  sharpe_ratio REAL,
  sortino_ratio REAL,
  calmar_ratio REAL,
  equity_curve_r2 REAL,
  avg_mae REAL,
  avg_mfe REAL,
  style_cluster TEXT, -- 'SNIPER', 'SCALPER', 'SWING', 'NEWS'
  calculated_at INTEGER NOT NULL
);

-- Scout watchlists (admin pinning)
CREATE TABLE scout_watchlists (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  tier TEXT NOT NULL DEFAULT 'B_LIST', -- 'A_LIST', 'B_LIST', 'INCUBATOR'
  notes TEXT,
  created_at INTEGER NOT NULL
);

-- Recruiting pipeline (stage tracking)
CREATE TABLE recruiting_pipeline (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'DETECTED',
  assigned_admin_id INTEGER REFERENCES users(id),
  last_contacted_at INTEGER,
  notes TEXT,
  updated_at INTEGER NOT NULL
);

-- Partner access tokens
CREATE TABLE partners (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  ip_whitelist TEXT, -- CSV of allowed IPs
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL
);
```

### B. Nightly Calculation Job (`calcScoutMetrics`)
1.  Fetch all users with `trades > 20` in past 90 days.
2.  Calculate daily returns from `trades` table.
3.  Compute Sharpe, Sortino, Calmar, R².
4.  Classify behavioral cluster.
5.  Upsert into `scout_metrics_snapshot`.

### C. API Endpoints
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/scout/candidates` | GET | Admin | Heavy payload with PII + full metrics. |
| `/api/admin/scout/watchlist` | GET/POST/DELETE | Admin | Manage watchlist. |
| `/api/admin/scout/pipeline/:userId` | GET/PUT | Admin | View/update pipeline stage. |
| `/api/partner/data-room` | GET | Partner API Key | List of anonymized candidates. |
| `/api/partner/tear-sheet/:hashId` | GET | Partner API Key | Full tear sheet for one candidate. |
| `/api/partner/inquiry` | POST | Partner API Key | Submit RFI to Admin. |

---

## 5. Deep-Context Ecosystem Wiring (What Exists vs What Must Be Added)

### 5.1 Existing Production-Grade Building Blocks

| Area | Existing Module(s) | Reuse Strategy |
|------|--------------------|----------------|
| Trader scouting baseline | `server/routes/admin.ts` (`/api/admin/trader-scouting/*`), `shared/admin/traderSearch.ts`, `client/src/components/admin/TraderSearchTab.tsx` | Extend, do not replace |
| Data tab container | `client/src/pages/AdminData.tsx` | Migrate `Trader Search` into dedicated `SCOUT` tab |
| Tier policy and promotions | `shared/policyDecision.ts`, `server/policy/buildDecisionContext.ts`, `server/policy/performerPromotion.ts` | Source of truth for stage eligibility |
| Verification/KYC surfaces | `client/src/components/VerificationCards.tsx`, `server/routes/verification.ts` | Feed CRM golden record |
| Mailbox + communications | `server/routes/mailbox.ts`, `server/services/messaging.ts`, `client/src/pages/AdminCommunications.tsx` | Use `messageType=PARTNER_RFI` for proxy loop |
| Config and toggle persistence | `shared/schema.pg.ts` (`system_config`), `server/routes/adminSystemConfig.ts` | Add new toggles with existing config pattern |
| Audit and tamper evidence | `server/lib/auditWriter.ts`, `server/services/identityAudit.ts`, hash-chain tables in `shared/schema.pg.ts` | Mandatory for partner + pipeline actions |
| Compliance/legal/jurisdiction | `server/legal/*`, `server/policy/jurisdictionControl.ts`, `server/middleware/jurisdictionSessionGuard.ts` | Must remain enforced server-side |
| Existing validation harness | `e2e/trader-search.spec.ts`, `scripts/traderSearchIntegrity.ts` | Keep as regression baseline |

### 5.2 Net-New Modules (Recruitment Ecosystem)

| Module | Proposed Path | Role |
|--------|---------------|------|
| Scout metrics scheduler | `server/scout/calcScoutMetrics.ts` | Computes Sharpe/Sortino/Calmar/R2/MAE/MFE snapshots |
| Style drift detector | `server/scout/styleClassifier.ts` | Cluster assignment + drift alerting |
| Recruitment pipeline service | `server/recruitment/pipelineService.ts` | Stage transitions, assignment, partner visibility |
| Scout admin routes | `server/routes/adminScout.ts` | `/api/admin/scout/*` endpoints |
| Partner auth middleware | `server/middleware/requirePartner.ts` | API key hash verify + IP whitelist + master toggle |
| Partner portal routes | `server/routes/partnerPortal.ts` | Data room, tear sheet, allocation, inquiries |
| Partner anonymization utility | `server/partner/anonymizeUser.ts` | Stable `User-XXXX` derivation |
| Partner allocation engine | `server/partner/allocationEngine.ts` | vSMA and shadow-stop evaluation |
| Inquiry bridge | `server/partner/inquiryBridge.ts` | Admin-mediated Partner RFI workflow |
| Trader talent routes | `server/routes/traderTalent.ts` | Pro profile + challenge routes |
| Challenge evaluator cron | `server/cron/evaluateChallenges.ts` | Hourly challenge status engine |
| Allocation sync cron | `server/cron/syncPartnerAllocations.ts` | Hourly allocation PnL updates |

---

## 6. Hardening Constraints (Hedge-Fund Grade)

### 6.1 Security and Compliance
1. Partner key storage must be hash-only (`api_key_hash`) with one-time secret display.
2. No partner endpoint can return raw `email`, `username`, phone, IP, session, or direct `userId`.
3. `PARTNER_READY` must require KYC-approved + policy-eligible + legal-compliant state.
4. Every partner/admin action must emit attributable audit entries with correlation IDs.
5. Partner-to-trader communication must stay admin-mediated via mailbox bridge only.

### 6.2 Performance and Bandwidth
1. All quant metrics are precomputed snapshots; no on-demand expensive recompute in request path.
2. Partner responses must be paginated and bounded.
3. No additional heavy work in `/ws` fanout loops or quote ingestion hot paths.
4. Cron jobs must be idempotent, chunked, and backpressure-safe.

---

## 7. 5-Cycle Execution Protocol (Plan, Execute, Test, Fix, Revisit, Retest)

### Cycle 1 - Baseline Lock
- Plan: freeze current-state module map and naming conventions.
- Execute: align PRD and ideas docs to real module entrypoints.
- Test: validate references and endpoint consistency.
- Fix: remove speculative assumptions and incorrect module names.
- Revisit/Retest: confirm docs are synchronized and executable as blueprint.

### Cycle 2 - Data + API Foundation
- Plan: schema contracts, index strategy, and admin scout route scaffolding.
- Execute: implement data model + `/api/admin/scout/*` foundations.
- Test: `npm run check`, schema audit, API smoke tests.
- Fix: resolve type drift, migration issues, and contract mismatches.
- Revisit/Retest: verify persistence + response correctness.

### Cycle 3 - Partner Portal + RFI Bridge
- Plan: strict auth boundaries and anonymized data room contract.
- Execute: partner middleware/routes + mailbox-mediated inquiry bridge.
- Test: authz negatives, PII leak checks, RFI end-to-end tests.
- Fix: tighten filtering, sanitize responses, harden message typing.
- Revisit/Retest: validate partner UX works without identity leakage.

### Cycle 4 - Trader Talent + Engines
- Plan: pro profile/challenge features and scheduler design.
- Execute: trader talent routes + challenge/allocation jobs.
- Test: rule-engine deterministic tests and time-window edge cases.
- Fix: remove race conditions and stale-snapshot defects.
- Revisit/Retest: verify deterministic lifecycle transitions.

### Cycle 5 - Full-System Hardening
- Plan: complete E2E and load/compliance verification matrix.
- Execute: run all required checks and close defects.
- Test:
  - `npm run check`
  - `npm run build`
  - `npm run e2e`
  - `npm run loadtest:publish-quotes`
  - `npm run loadtest:ws-fanout`
  - `npm run audit:activity`
- Fix: patch and rerun until all critical regressions are cleared.
- Revisit/Retest: release only when all gates are green.

---

## 8. End-to-End Validation Matrix

| Workflow | Validation |
|----------|------------|
| Admin discovery and drilldown | Existing trader-search E2E + new scout-tab UI tests |
| Recruitment pipeline movement | API tests asserting stage transitions and audit writes |
| Partner access/data-room | Authz and anonymization contract tests |
| Partner inquiry proxy | Mailbox thread + reply forwarding integration tests |
| Trader pro profile/challenges | API/UI tests for profile edits and challenge lifecycle |
| Scheduler correctness | Deterministic cron tests for metrics/challenges/allocations |
| Performance safety | Existing load tests for WS/quote paths |
| Compliance safety | Jurisdiction + policy + legal acceptance regression checks |

---

## 9. Final Integration Criteria

The ecosystem is considered fully integrated only when:

1. Section 5.2 modules are implemented and wired.
2. Feature toggles are controllable in admin config and respected end-to-end.
3. Partner surfaces are PII-clean under test.
4. RFI flow is admin-mediated and auditable.
5. Cycle 5 validation is green with no unresolved critical defects.
