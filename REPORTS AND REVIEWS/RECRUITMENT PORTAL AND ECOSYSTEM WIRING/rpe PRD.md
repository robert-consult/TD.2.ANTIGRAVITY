# PRD: TradeQuip Scout & Partner Portal System
**Version**: 1.0  
**Date**: 2026-02-08  
**Status**: Approved for Implementation

---

## Implementation Status (2026-02-09)

### Delivered in Repository
- Admin `SCOUT` top-level tab (before `System Config`) with Discovery/CRM/Config/Challenges/Partners surfaces.
- New recruitment schema + migration (`scout_metrics_snapshot`, `scout_watchlists`, `recruiting_pipeline`, `partners`, `partner_allocations`, `partner_inquiries`, `trader_profiles`, `challenges`, `challenge_enrollments`) and `system_config` toggles.
- New admin APIs:
  - `GET /api/admin/scout/candidates`
  - `GET /api/admin/scout/candidates/:userId`
  - `GET|POST|DELETE /api/admin/scout/watchlist`
  - `GET /api/admin/scout/pipeline`
  - `GET|PUT /api/admin/scout/pipeline/:userId`
  - `GET|PUT /api/admin/scout/config`
  - `GET|POST /api/admin/challenges`
  - `GET|PUT|DELETE /api/admin/challenges/:id`
  - `GET|POST /api/admin/partners`
  - `PUT|DELETE /api/admin/partners/:id`
- New partner APIs (API key + IP whitelist + master toggle enforced):
  - `GET /api/partner/data-room`
  - `GET /api/partner/tear-sheet/:hashId`
  - `GET|POST|PUT /api/partner/allocations`
  - `GET|POST /api/partner/inquiries`
- New trader APIs:
  - `GET /api/trader/leaderboard-mode`
  - `GET|PUT /api/trader/profile`
  - `GET /api/trader/challenges`
  - `POST /api/trader/challenges/:id/enroll`
  - `POST /api/trader/challenges/:id/withdraw`
  - `GET /api/trader/challenges/:id/status`
- Scheduler passes added and wired under worker role:
  - scout metrics (`calcScoutMetrics`)
  - challenge evaluation
  - partner allocation sync
- Hardening completed:
  - `PARTNER_READY` now requires KYC approved + eligible tier + legal compliant state.
  - Partner tear-sheet responses are anonymized and do not return profile free-text fields.
  - Cron passes are bounded by max-row/max-user caps for predictable runtime.

### Notes / Current Scope
- Community features are delivered as a controlled baseline (`Community` tab with spectator board + briefing), with advanced streaming/feed expansion intentionally iterative.
- MAE/MFE ingestion is schema-complete and consumed by metrics when present; precision quality depends on upstream intraday excursion capture fidelity.

---

## 1. Overview

### 1.1 Purpose
Transform TradeQuip from a trading simulation platform into a **Talent Alpha Discovery Engine** for hedge funds and proprietary trading firms. This system enables:
- **Admins**: Identify, vet, and manage trading talent.
- **Partners**: View anonymized trader performance and simulate capital allocation.
- **Traders**: Showcase skills and compete in assessment challenges.

### 1.2 Core Mandates
| Mandate | Description |
|---------|-------------|
| **Strict Anonymity** | Partners NEVER see PII (name, email, phone). Only `User-XXXX` (hashed ID). |
| **Admin Sovereignty** | All Partner↔Trader communication flows through Admin. |
| **Configurable Features** | Every feature toggleable via `system_config`. |

---

## 2. User Personas

| Persona | Description | Access Level |
|---------|-------------|--------------|
| **Admin/Scout** | Internal recruiter discovering and managing talent. | Full PII + all metrics |
| **Partner** | External hedge fund/prop firm evaluating candidates. | Anonymized metrics only |
| **Trader** | User building track record and seeking allocation. | Own profile only |

---

## 3. Feature Specifications

### 3.1 Admin Dashboard: "SCOUT" Tab
**Location**: New top-level tab in Admin Dashboard, positioned **before** "SYSTEM CONFIG".

#### 3.1.1 Sub-Tab: Discovery Engine
**Purpose**: Surface risk-adjusted alpha using institutional metrics.

**UI Components**:
- **Filter Panel**: Multi-select filters for all metrics.
- **Results Table**: Paginated list with sortable columns.
- **Detail Modal**: Click row to see full trader profile.

**Metrics to Display**:
| Metric | Source | Formula/Logic |
|--------|--------|---------------|
| **Sharpe Ratio** | Calculated | `(Avg Daily Return - 0) / StdDev(Daily Returns) * sqrt(252)` |
| **Sortino Ratio** | Calculated | `(Avg Daily Return - 0) / StdDev(Negative Daily Returns) * sqrt(252)` |
| **Calmar Ratio** | Calculated | `CAGR / Max Drawdown` |
| **Profit Factor** | Existing | `grossProfit / grossLoss` from `runTraderScoutSearch` |
| **Win Rate** | Existing | `winningTrades / totalTrades` from `runTraderScoutSearch` |
| **Max Drawdown** | Existing | From `runTraderScoutSearch` |
| **Equity Curve R²** | Calculated | Linear regression R² on cumulative P&L |
| **Avg MAE** | Calculated | Average Maximum Adverse Excursion per trade |
| **Avg MFE** | Calculated | Average Maximum Favorable Excursion per trade |
| **Style Cluster** | Calculated | 'SNIPER', 'SCALPER', 'SWING', 'NEWS' |

**Filtering Capabilities**:
- Min/Max for each numeric metric.
- Style cluster selection.
- Date range (account age, last trade).
- Existing filters: `minTrades`, `minWinRate`, `maxDrawdown`, `minProfitFactor`.

**Actions**:
- "Add to Watchlist" button per row.
- "View Full Profile" button.

#### 3.1.2 Sub-Tab: Recruitment CRM
**Purpose**: Manage trader lifecycle from detection to Partner-ready.

**Pipeline Stages**:
1. `DETECTED` - Algo flagged.
2. `WATCHLIST` - Admin pinned.
3. `CONTACTED` - Mailbox message sent.
4. `VETTED_EMAIL` - Email verified.
5. `VETTED_SMS` - SMS verified.
6. `PERFORMER` - Auto-promoted (existing `userTier`).
7. `SELECTED_KYC` - Admin selected, KYC initiated.
8. `PARTNER_READY` - KYC approved, visible in Portal.

**UI Components**:
- **Kanban Board**: Drag-and-drop between stages.
- **Stage Cards**: Show user count per stage.
- **Detail Drawer**: View "Golden Record" (Performance + Verification + Notes).

**Integration Points**:
- Link to existing `UserActivityAdmin` component.
- Link to existing `VerificationCards` (Email, SMS, KYC).
- Pull `userTier` and `contenderTier` from `policyDecision.ts`.

#### 3.1.3 Sub-Tab: Config
**Purpose**: Feature toggles and system limits.

**Config Keys** (add to `system_config` table):
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `scout_tab_enabled` | boolean | true | Show/hide Scout tab |
| `partner_portal_enabled` | boolean | false | Master switch for Partner Portal |
| `trader_pro_profiles_enabled` | boolean | false | Allow traders to edit Bio/Strategy |
| `trader_compete_enabled` | boolean | false | Enable assessment challenges |
| `trader_community_enabled` | boolean | false | Enable spectator mode |
| `partner_allocations_enabled` | boolean | false | Enable virtual capital deployment |
| `leaderboard_mode` | text | 'PUBLIC' | 'PUBLIC', 'TOP_10', 'DISABLED' |
| `scout_min_sharpe_alert` | real | 2.0 | Alert threshold for new high-Sharpe traders |

---

### 3.2 Partner Portal
**Access**: Separate URL or debug link in Admin Home dropdown. Secured via API key + IP whitelist.

#### 3.2.1 Tab: Data Room
**Purpose**: Anonymized trader due diligence.

**UI Components**:
- **Candidate Grid**: List of `User-XXXX` cards with summary metrics.
- **Tear Sheet Modal**: Full performance breakdown.

**Tear Sheet Contents**:
- Header: `User-XXXX` | Style Cluster | Composite Score.
- Monthly Returns Heatmap (Jan-Dec).
- Equity Curve Chart.
- Drawdown Underwater Chart.
- Metrics Grid: Sharpe, Sortino, Calmar, Win Rate, Profit Factor, Max DD.
- Attribution: Profit by Symbol, Profit by Hour.

#### 3.2.2 Tab: Allocations (Optional)
**Requires**: `partner_allocations_enabled = true`.

**Functionality**:
- Create virtual managed account (vSMA) with X capital.
- System mirrors candidate's % returns.
- Partner sets "Shadow Stops" (e.g., cut if -3%).

**UI Components**:
- Allocation Form: Select `User-XXXX`, enter capital.
- Active Allocations Table: vSMA performance tracking.

#### 3.2.3 Tab: Communications
**Purpose**: RFI (Request for Information) proxy.

**Workflow**:
1. Partner submits question via form.
2. Admin receives in Mailbox (new `message_type: PARTNER_RFI`).
3. Admin reviews, optionally edits, forwards to Trader.
4. Trader replies to Admin.
5. Admin sanitizes, forwards to Partner.

**UI Components**:
- Inquiry Form (Subject, Body, related `User-XXXX`).
- Inquiry History Table.

---

### 3.3 Trader Dashboard Enhancements
**Location**: Extend existing "Leaderboard" tab with sub-tabs.

#### 3.3.1 Sub-Tab: Leaderboard
**Existing**: `LeaderboardScreen.tsx`.
**Enhancement**: Add "My Rank" indicator.

#### 3.3.2 Sub-Tab: My Resume (Pro Profile)
**Requires**: `trader_pro_profiles_enabled = true`.

**UI Components**:
- **Bio Textarea**: "About Me".
- **Strategy Textarea**: "My Edge".
- **Pinned Trade**: Select from closed trades, display annotated chart.
- **Verified Badges**: Auto-display earned badges.

**Badges**:
- "Profitable 90 Days"
- "Max DD < 5%"
- "Zero Risk Breaches"
- "Funded" (if `userTier = SELECTED`)

#### 3.3.3 Sub-Tab: Compete (Optional)
**Requires**: `trader_compete_enabled = true`.

**Functionality**:
- View active "Combine" challenges.
- Enroll in challenge.
- Track progress vs targets/rules.

**Challenge Structure**:
- Profit Target: e.g., +10%.
- Max Daily Loss: e.g., -3%.
- Duration: e.g., 14 days.
- Min Trading Days: e.g., 5.

#### 3.3.4 Sub-Tab: Community (Optional)
**Requires**: `trader_community_enabled = true`.
- Spectator streams.
- Daily briefing feed.

---

## 4. Data Model

### 4.1 New Tables

```sql
-- Nightly calculated metrics for each trader
CREATE TABLE scout_metrics_snapshot (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  calmar_ratio REAL,
  equity_curve_r2 REAL,
  avg_mae REAL,
  avg_mfe REAL,
  style_cluster TEXT, -- 'SNIPER', 'SCALPER', 'SWING', 'NEWS'
  composite_score REAL, -- Weighted combo for sorting
  calculated_at INTEGER NOT NULL DEFAULT (extract(epoch from now()))
);

-- Admin watchlists
CREATE TABLE scout_watchlists (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'B_LIST', -- 'A_LIST', 'B_LIST', 'INCUBATOR'
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (extract(epoch from now())),
  UNIQUE(admin_id, user_id)
);

-- Recruitment pipeline stage tracking
CREATE TABLE recruiting_pipeline (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'DETECTED',
  assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_contacted_at INTEGER,
  notes TEXT,
  is_partner_visible BOOLEAN NOT NULL DEFAULT false,
  updated_at INTEGER NOT NULL DEFAULT (extract(epoch from now()))
);

-- Partner organizations
CREATE TABLE partners (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL, -- SHA-256 for storage
  ip_whitelist TEXT, -- CSV of allowed IPs
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL DEFAULT (extract(epoch from now())),
  updated_at INTEGER NOT NULL DEFAULT (extract(epoch from now()))
);

-- Partner virtual allocations
CREATE TABLE partner_allocations (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_hash_id TEXT NOT NULL, -- Anonymized user reference
  capital_usd REAL NOT NULL,
  shadow_stop_pct REAL, -- e.g., 0.03 for 3%
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'STOPPED', 'CLOSED'
  current_pnl_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (extract(epoch from now())),
  updated_at INTEGER NOT NULL DEFAULT (extract(epoch from now()))
);

-- Trader pro profiles
CREATE TABLE trader_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  strategy TEXT,
  pinned_trade_ids TEXT, -- JSON array of trade IDs
  updated_at INTEGER NOT NULL DEFAULT (extract(epoch from now()))
);

-- Assessment challenges
CREATE TABLE challenges (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  profit_target_pct REAL NOT NULL, -- e.g., 0.10 for 10%
  max_daily_loss_pct REAL NOT NULL, -- e.g., 0.03 for 3%
  max_total_loss_pct REAL,
  min_trading_days INTEGER,
  duration_days INTEGER NOT NULL,
  start_at INTEGER,
  end_at INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (extract(epoch from now()))
);

-- Challenge enrollments
CREATE TABLE challenge_enrollments (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'PASSED', 'FAILED', 'WITHDRAWN'
  enrolled_at INTEGER NOT NULL DEFAULT (extract(epoch from now())),
  completed_at INTEGER,
  current_pnl_pct REAL NOT NULL DEFAULT 0,
  max_daily_loss_hit REAL,
  trading_days INTEGER NOT NULL DEFAULT 0,
  UNIQUE(challenge_id, user_id)
);
```

### 4.2 Schema Updates to Existing Tables

**`system_config`**: Add columns listed in Section 3.1.3.

**`mailbox_messages`**: Add `message_type` value `'PARTNER_RFI'`.

**`trades`** (Optional MAE/MFE tracking):
```sql
ALTER TABLE trades ADD COLUMN intraday_high REAL;
ALTER TABLE trades ADD COLUMN intraday_low REAL;
ALTER TABLE trades ADD COLUMN mae REAL; -- Calculated on close
ALTER TABLE trades ADD COLUMN mfe REAL; -- Calculated on close
```

---

## 5. API Endpoints

### 5.1 Admin APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/scout/candidates` | GET | List candidates with full metrics + PII |
| `/api/admin/scout/candidates/:userId` | GET | Single candidate detail |
| `/api/admin/scout/watchlist` | GET | List admin's watchlist |
| `/api/admin/scout/watchlist` | POST | Add to watchlist |
| `/api/admin/scout/watchlist/:id` | DELETE | Remove from watchlist |
| `/api/admin/scout/pipeline` | GET | List all pipeline stages |
| `/api/admin/scout/pipeline/:userId` | GET | Get user's pipeline stage |
| `/api/admin/scout/pipeline/:userId` | PUT | Update user's pipeline stage |
| `/api/admin/scout/config` | GET | Get scout config values |
| `/api/admin/scout/config` | PUT | Update scout config values |
| `/api/admin/partners` | GET | List partners |
| `/api/admin/partners` | POST | Create partner |
| `/api/admin/partners/:id` | PUT | Update partner |
| `/api/admin/partners/:id` | DELETE | Deactivate partner |
| `/api/admin/challenges` | GET/POST | Manage challenges |
| `/api/admin/challenges/:id` | GET/PUT/DELETE | Single challenge |

### 5.2 Partner APIs

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/partner/data-room` | GET | API Key | List anonymized candidates |
| `/api/partner/tear-sheet/:hashId` | GET | API Key | Full tear sheet for one candidate |
| `/api/partner/allocations` | GET | API Key | List partner's allocations |
| `/api/partner/allocations` | POST | API Key | Create allocation |
| `/api/partner/allocations/:id` | PUT | API Key | Update (e.g., close) allocation |
| `/api/partner/inquiries` | GET | API Key | List partner's inquiries |
| `/api/partner/inquiries` | POST | API Key | Submit new inquiry |

### 5.3 Trader APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/trader/profile` | GET | Get own pro profile |
| `/api/trader/profile` | PUT | Update bio/strategy/pinned trades |
| `/api/trader/challenges` | GET | List active challenges |
| `/api/trader/challenges/:id/enroll` | POST | Enroll in challenge |
| `/api/trader/challenges/:id/withdraw` | POST | Withdraw from challenge |
| `/api/trader/challenges/:id/status` | GET | Get challenge progress |

---

## 6. Background Jobs

### 6.1 `calcScoutMetrics` (Nightly)
**Schedule**: 02:00 UTC daily.

**Logic**:
1. Query users with `trades > 20` in past 90 days.
2. For each user:
   a. Fetch all closed trades.
   b. Calculate daily returns.
   c. Compute Sharpe, Sortino, Calmar.
   d. Compute Equity Curve R².
   e. If MAE/MFE columns exist, compute averages.
   f. Classify style cluster.
   g. Upsert into `scout_metrics_snapshot`.

### 6.2 `evaluateChallenges` (Hourly)
**Schedule**: Every hour.

**Logic**:
1. For each `ACTIVE` enrollment:
   a. Calculate current P&L % since enrollment.
   b. Check max daily loss breaches.
   c. Count trading days.
   d. Update enrollment record.
   e. If target met AND duration complete → `PASSED`.
   f. If any rule breached → `FAILED`.

### 6.3 `syncPartnerAllocations` (Hourly)
**Schedule**: Every hour.

**Logic**:
1. For each `ACTIVE` allocation:
   a. Get user's % return since allocation creation.
   b. Apply to virtual capital.
   c. Check shadow stop.
   d. Update `current_pnl_usd`.
   e. If shadow stop hit → `STOPPED`.

---

## 7. Security & Access Control

### 7.1 Admin Access
- Existing `requireAdmin` middleware.
- Full PII access.

### 7.2 Partner Access
- New `requirePartner` middleware.
- Validates API key (hashed comparison).
- Validates source IP against whitelist.
- Returns 403 if `partner_portal_enabled = false`.

### 7.3 Trader Access
- Existing `requireAuth` middleware.
- Can only view/edit own profile.
- Feature access gated by config toggles.

### 7.4 Anonymization
**Function**: `anonymizeUserId(userId: number): string`
- Returns `User-${hashFirst8(sha256(userId + salt))}`.
- Salt stored in environment variable.

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Add new tables to `shared/schema.pg.ts`.
- [ ] Add config toggles to `system_config`.
- [ ] Create `calcScoutMetrics` job skeleton.
- [ ] Create anonymization utility.

### Phase 2: Admin Scout Tab (Week 3-4)
- [ ] Discovery Engine sub-tab UI.
- [ ] Recruitment CRM sub-tab UI.
- [ ] Config sub-tab UI.
- [ ] API endpoints for admin scout.

### Phase 3: Partner Portal (Week 5-6)
- [ ] Partner table + API key management.
- [ ] `requirePartner` middleware.
- [ ] Data Room UI.
- [ ] Tear Sheet UI.
- [ ] Communications proxy.

### Phase 4: Trader Enhancements (Week 7-8)
- [ ] Pro Profile sub-tab.
- [ ] Leaderboard "My Rank".
- [ ] Challenges (if enabled).

### Phase 5: Optional Features (Week 9+)
- [ ] Partner Allocations.
- [ ] MAE/MFE tracking.
- [ ] Community/Spectator mode.

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Traders with Sharpe > 2.0 surfaced | 100+ |
| Pipeline conversion (Detected → Partner Ready) | 5% |
| Partner inquiries per month | 10+ |
| Challenge completion rate | 20% |

---

## 10. Open Questions

1. **Risk-free rate for Sharpe**: Use 0% or actual T-bill rate?
2. **MAE/MFE granularity**: Track intraday or per-quote tick?
3. **Partner onboarding**: Manual by Admin or self-service?

---

## 11. Deep-Context Module Wiring (Authoritative)

### 11.1 Existing Modules to Reuse (Already in Repo)

| Capability | Existing Module(s) | Status |
|------------|--------------------|--------|
| Trader scouting search/query/export | `server/routes/admin.ts` (`/api/admin/trader-scouting/*`), `shared/admin/traderSearch.ts` | Implemented |
| Trader scouting UI + drilldown | `client/src/components/admin/TraderSearchTab.tsx`, `client/src/pages/AdminData.tsx` | Implemented |
| Trader scouting integrity tests | `e2e/trader-search.spec.ts`, `scripts/traderSearchIntegrity.ts` | Implemented |
| Tier and contender policy engine | `shared/policyDecision.ts`, `server/policy/buildDecisionContext.ts`, `server/policy/performerPromotion.ts` | Implemented |
| Verification/KYC cards and flow | `client/src/components/VerificationCards.tsx`, `server/routes/verification.ts` | Implemented |
| Admin communications and mailbox routing | `client/src/pages/AdminCommunications.tsx`, `server/routes/mailbox.ts`, `server/services/messaging.ts` | Implemented |
| Config persistence and admin controls | `shared/schema.pg.ts` (`system_config`), `server/routes/adminSystemConfig.ts` | Implemented |
| Audit and tamper-evident chains | `server/lib/auditWriter.ts`, `server/services/identityAudit.ts`, `shared/schema.pg.ts` audit tables | Implemented |
| Legal/jurisdiction controls | `server/legal/*`, `server/policy/jurisdictionControl.ts`, `server/middleware/jurisdictionSessionGuard.ts` | Implemented |
| Quote/WS performance-critical boundary | `server/services/quoteHub.ts`, `server/feeds/quoteFeed.ts`, `server/routes.ts` (`/ws`) | Implemented |

### 11.2 Net-New Modules Required for Recruitment Ecosystem

| Module | Proposed Path | Purpose |
|--------|---------------|---------|
| Scout metric calculator | `server/scout/calcScoutMetrics.ts` | Nightly Sharpe/Sortino/Calmar/R2/MAE/MFE computation and upsert |
| Scout style classifier | `server/scout/styleClassifier.ts` | Deterministic trader style clustering + drift signal |
| Scout repository/service | `server/scout/scoutService.ts` | Candidate read model assembly for admin and partner surfaces |
| Recruitment pipeline service | `server/recruitment/pipelineService.ts` | Stage transitions, ownership, notes, partner visibility gates |
| Recruitment admin routes | `server/routes/adminScout.ts` | `/api/admin/scout/*` endpoints (watchlist, pipeline, config) |
| Partner auth middleware | `server/middleware/requirePartner.ts` | API key auth (hash compare), IP whitelist, kill-switch enforcement |
| Partner portal routes | `server/routes/partnerPortal.ts` | Data room, tear sheet, allocations, inquiries endpoints |
| Partner anonymization utility | `server/partner/anonymizeUser.ts` | Stable anonymized IDs with salt/pepper and rotation strategy |
| Partner allocation simulator | `server/partner/allocationEngine.ts` | vSMA lifecycle and shadow-stop logic |
| Partner inquiry bridge | `server/partner/inquiryBridge.ts` | Admin-mediated RFI pipeline using mailbox `messageType=PARTNER_RFI` |
| Trader pro profile routes | `server/routes/traderTalent.ts` | Resume/profile/challenge endpoints for traders |
| Challenge evaluator job | `server/cron/evaluateChallenges.ts` | Scheduled challenge rule evaluation |

### 11.3 UI Module Wiring Targets

| Area | Existing Entry | New/Updated UI Module |
|------|----------------|-----------------------|
| Admin top-level navigation | `client/src/pages/AdminDashboard.tsx` | Add `SCOUT` tab before `SYSTEM CONFIG` (feature-flagged) |
| Existing scout baseline | `client/src/pages/AdminData.tsx` + `TraderSearchTab.tsx` | Promote and split into `Discovery`, `CRM`, `Config` sub-tabs |
| Partner portal shell | none | `client/src/pages/PartnerPortal.tsx` with `Data Room`, `Allocations`, `Comms` |
| Trader talent area | `client/src/pages/LeaderboardScreen.tsx` | Add talent sub-tabs: `Leaderboard`, `My Resume`, `Compete`, `Community` |

---

## 12. Security, Compliance, and Performance Hardening Requirements

### 12.1 Security Controls (Non-Negotiable)

1. Partner API keys must be stored hashed only (`api_key_hash`), never plaintext.
2. All partner responses must be anonymized and must not leak `email`, `username`, phone, IP, or direct IDs.
3. Every stage transition (`recruiting_pipeline`) and partner read action must emit audit events with correlation IDs.
4. Existing policy and jurisdiction gates must remain server-side and enforced before partner visibility.
5. RFI flow must remain Admin-mediated; direct Partner-to-Trader path is forbidden.

### 12.2 Performance/Bandwidth Constraints

1. No per-request heavy metric recompute in hot paths; all advanced metrics come from snapshots.
2. Partner payloads must be compact and paginated; avoid high-cardinality unbounded responses.
3. No new synchronous blocking work in `/ws` handlers or quote ingestion paths.
4. Allocation/challenge jobs must run bounded batches with backpressure-safe loops.

### 12.3 Compliance Wiring

1. KYC-approved and policy-eligible states must gate `PARTNER_READY`.
2. Legal acceptance integrity remains under existing hash/HMAC chains in `server/legal/*`.
3. Existing admin audit trails (`auditWriter`, `identityAudit`) are mandatory for all new admin/partner actions.

---

## 13. 5-Cycle Hedge-Fund Precision Delivery Protocol

Each cycle includes: `Plan -> Execute -> Test -> Fix -> Revisit PRD/Ideas -> Retest`.

### Cycle 1: Baseline and Gap Lock
- Plan: map implemented vs missing modules against deep-context sources.
- Execute: document authoritative module wiring and rename ambiguous toggles to canonical keys.
- Test: validate all referenced module paths exist and endpoints align to current code.
- Fix: remove non-existent assumptions; mark gaps explicitly.
- Retest exit: baseline map is internally consistent.

### Cycle 2: Core Data and API Foundations
- Plan: implement schema + route scaffolding for scout pipeline/partner gateway.
- Execute: create tables, indexes, service contracts, and admin route skeletons.
- Test: `npm run check`, route smoke tests, migration/audit checks.
- Fix: resolve type/schema mismatches and idempotency issues.
- Retest exit: admin scout APIs compile and persist safely.

### Cycle 3: Partner Portal + Anonymization + RFI Bridge
- Plan: enforce partner authz boundaries and anonymized data contracts.
- Execute: add partner middleware/routes, tear-sheet builder, inquiry bridge via mailbox.
- Test: negative auth tests, PII leakage tests, RFI round-trip tests.
- Fix: tighten filters, sanitize responses, harden message typing.
- Retest exit: partner flows function without PII leakage.

### Cycle 4: Trader Talent Surfaces + Jobs
- Plan: deliver trader pro profile/challenges and scheduled evaluators.
- Execute: add trader profile/challenge APIs and cron jobs for metrics/challenges/allocations.
- Test: challenge rule tests, job idempotency tests, time-window edge-case tests.
- Fix: resolve race conditions, stale snapshots, and job contention.
- Retest exit: talent lifecycle is deterministic end-to-end.

### Cycle 5: Full E2E Hardening and Release Gate
- Plan: verify all workflows across Admin, Trader, Partner, and cron boundaries.
- Execute: run full verification matrix and load/security sanity checks.
- Test:
  - `npm run check`
  - `npm run build`
  - `npm run e2e`
  - `npm run loadtest:publish-quotes`
  - `npm run loadtest:ws-fanout`
  - `npm run audit:activity`
- Fix: patch any regression and rerun failed suites.
- Retest exit: all critical paths pass and release DoD is met.

---

## 14. End-to-End Verification Matrix (Required)

| Flow | Required Checks |
|------|-----------------|
| Admin discovery and drilldown | Existing `e2e/trader-search.spec.ts` + new scout-specific tests |
| Pipeline stage transitions | API contract tests + audit row assertion per transition |
| Partner access and anonymization | Partner authz tests + schema snapshot tests ensuring no PII fields |
| RFI proxy loop | Integration test over mailbox thread creation, reply, and admin forwarding |
| Trader profile/challenges | API + UI tests for edit, enroll, rule evaluation, and status progression |
| Job correctness | Deterministic fixture tests for `calcScoutMetrics`, `evaluateChallenges`, `syncPartnerAllocations` |
| Performance guardrails | WS/quote load tests and payload size checks |
| Compliance gates | Jurisdiction + policy + legal acceptance regression checks |

---

## 15. Release Definition for Recruitment Ecosystem

The recruitment portal ecosystem is release-ready only when all are true:

1. All net-new modules in Section 11.2 are implemented and wired.
2. All feature toggles in Section 3.1.3 are persisted and controllable through admin.
3. Partner portal cannot access raw user identity data under any endpoint.
4. `PARTNER_READY` visibility is blocked unless policy + KYC + legal constraints are satisfied.
5. Cycle 5 test matrix completes with no unresolved critical defects.
