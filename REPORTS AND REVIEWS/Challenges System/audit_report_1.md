# Challenges System Audit Report 1

**Date:** 2026-02-11
**Objective:** Deep audit of the current system implementation against the "Enhanced Design & Functionality Specification" (V4).
**Scope:** Repository state (`TD.2.ANTIGRAVITY`) vs. Design Document (`challenges_system_design.md.resolved`).

## 1. Executive Summary

**Status:** 🔴 **CRITICAL GAPS / BROKEN STATE**

The current repository state is **inconsistent and incomplete**. While server-side route handlers (`adminScout.ts`, `traderTalent.ts`) contain code attempting to reference the new V4 Challenges system (multi-phase, badges, certificates), the **database schema definitions are missing**.

-   **Schema:** `shared/schema.pg.ts` does **NOT** contain `challenge_phases`, `challenge_badges`, `challenge_certificates`, or updated `challenges` tables.
-   **Server:** `adminScout.ts` and `traderTalent.ts` import these missing tables, meaning the **server code currently cannot compile or run**.
-   **Frontend:** `ScoutWorkbench.tsx` reflects the **Legacy V1** design (simple table), missing the new "Templates", "Enrollments", "Analytics", and "Settings" tabs defined in the V4 design.
-   **Engine:** `engines.ts` contains `evaluateChallengeEnrollmentsPassLegacy`, confirming the new multi-phase evaluation engine is **not implemented**.

The system is currently in a "half-patched" state where some business logic files have been updated to reference V4 concepts, but the foundational data structures (Schema) and User Interfaces (Frontend) have not been applied.

---

## 2. Detailed Gap Analysis

### 2.1 Database Schema (`shared/schema.pg.ts`)

| Feature | Design Spec | Current Repo State | Status |
| :--- | :--- | :--- | :--- |
| **Phases** | New `challenge_phases` table (1-3 phases, targets, loss limits) | **MISSING** | 🔴 |
| **Enrollment Events** | New `challenge_enrollment_events` (hash-chained audit trail) | **MISSING** | 🔴 |
| **Badges** | New `challenge_badges` & `challenge_badge_awards` tables | **MISSING** | 🔴 |
| **Certificates** | New `challenge_certificates` & templates | **MISSING** | 🔴 |
| **Rewards** | New `challenge_prize_awards`, `challenge_progression_tiers` | **MISSING** | 🔴 |
| **Leaderboard** | New `challenge_leaderboard_snapshot` | **MISSING** | 🔴 |
| **Challenges Table** | Enhanced with 30+ new columns (styles, rewards, toggles) | **Legacy Version Only** (basic columns) | 🔴 |

### 2.2 Server-Side Logic (`server/`)

| Component | File | State | Status |
| :--- | :--- | :--- | :--- |
| **Admin API** | `routes/adminScout.ts` | **BROKEN**. Contains imports for missing schema tables (`challengePhases`, etc.). Code assumes V4 schema exists. | 🔴 |
| **Trader API** | `routes/traderTalent.ts` | **BROKEN**. Contains imports for missing schema tables. | 🔴 |
| **Evaluation Engine** | `recruitment/engines.ts` | **Legacy**. Contains `evaluateChallengeEnrollmentsPassLegacy`. No support for Phase 1 -> Phase 2 advancement. | 🟠 |
| **Notifications** | `services/messaging.ts` | **Partial**. `NotificationType` includes `CHALLENGE`. `CommunicationSettings` includes `notificationChallengeEnabled`. | 🟡 |
| **Cron Job** | `cron/evaluateChallenges.ts` | **Stub**. Calls legacy engine. | 🟠 |

### 2.3 Frontend UI (`client/src/`)

| feature | Design Spec | Current Repo State | Status |
| :--- | :--- | :--- | :--- |
| **Admin Dashboard** | Tabbed interface: Templates, Enrollments, Analytics, Settings | **MISSING**. `ScoutWorkbench.tsx` is a single flat table. | 🔴 |
| **Challenge Creation** | 6-Card Configuration Wizard (Phases, Rewards, Rules) | **MISSING**. Simple modal only. | 🔴 |
| **Trader Dashboard** | "My Challenges" with Phase Progress & PnL Gauges | **Legacy**. Simple list view. | 🔴 |
| **Leaderboard** | Competitive ranking with anonymization | **Legacy**. Basic table. | 🔴 |

---

## 3. Critical Issues & Recommendations

### Issue A: Broken Build (Server)
The server code in `adminScout.ts` and `traderTalent.ts` is trying to import non-existent schema definitions.
*   **Impact:** Server likely crashes on startup or fails to compile.
*   **Fix:** The V4 Schema Patch must be applied immediately to `shared/schema.pg.ts`.

### Issue B: Missing Evaluation Logic
Even if the schema is fixed, `engines.ts` logic is still the "Legacy" version. The complex logic for verifying "Max Daily Loss", "Trailing Drawdown", and "Phase Advancement" is missing.
*   **Fix:** `evaluateChallenges.ts` (CSD15/17 logic) needs to be fully implemented to replace the legacy engine.

### Issue C: Frontend/Backend Mismatch
The backend attempts to serve V4 data (once fixed), but the frontend (`ScoutWorkbench.tsx`) has no UI to display Phases, Badges, or Certificates.
*   **Fix:** The Admin Dashboard needs a complete rewrite to match the "Challenges Minitab" design (CSD18/19).

---

## 4. Conclusion

The "Audit" reveals that the **Challenges V4 System is effectively unimplemented** in the current `TD.2.ANTIGRAVITY` repository, aside from some "phantom" code in route handlers that anticipates a schema that does not exist. The system requires a full application of the V4 Patches (Schema first, then Engine, then UI) to become functional and match the Design Document.
