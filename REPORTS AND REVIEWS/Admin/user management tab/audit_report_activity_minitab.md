# Deep Audit Report: Activity Minitab & User Management

**Date:** 2026-02-23
**Scope:** `client/src/components/admin/UserActivityAdmin.tsx`, `server/routes/adminActivity.ts`, `server/services/accountLifecycle.ts`
**Reference Guides Used:** `00_SECURITY_MASTER_POLICY.md`, `01_ARCHITECTURE_AND_TRANSPORT.md`, `02_API_AND_ROUTES_SECURITY.md`, `03_DATABASE_AND_STATE_SECURITY.md`, `04_VULNERABILITIES_AND_EXPLOITS.md`, `05_CODING_STANDARDS_AND_PRACTICES.md`, `bug_vulnerability_catalog.md`.

---

## Executive Summary

The User Management Activity Minitab provides powerful administrative controls over user lifecycles, bot detection, and inactivity sweeps. The deep audit revealed several **High-Severity** architectural and implementation flaws, specifically referencing guidelines around NoSQL/Array input validation, Rate Limiting (DoS), and Transactional Race Conditions (TOCTOU).

While the frontend implementation tightly follows React lifecycle standards and properly renders the state, the backend lacks the strict boundary validation and locking mechanisms mandated by the Master Security Policy.

---

## Detailed Findings

### 1. API, Routing, & Hook Security (`02_API_AND_ROUTES_SECURITY.md`)

#### 🔴 High: Unbounded Array Iteration (API4 - DoS Protection)
- **Vulnerability:** Endpoints handling bulk actions (`POST /queue`, `POST /soft-delete`, `POST /hard-delete`, `POST /exempt`) map over arbitrarily large `req.body.userIds` arrays without asserting a `max_length`.
- **Impact:** A malicious actor (or compromised admin token) could execute a DoS payload containing $100,000+$ distinct integers, forcing the API instance into synchronous `O(N)` blocks of sequential DB lookups and network requests (`revokeAllSessionsForUser`), exhausting connection pools and event-loop time.
- **Guideline Violation:** *“Enforce pagination limits (hard server-side MAX_LIMIT=200) to prevent clients from requesting infinite rows.”*
- **Recommendation:** Implement strict `max_length` constraints (e.g. 500) natively on `userIds` arrays.

#### 🟡 Medium: Missing Strict Input Validation Boundaries (API1)
- **Vulnerability:** `adminActivityRouter.ts` handles coercion manually (`const userIds = (req.body?.userIds ?? []) as number[];`) instead of using strict Schema Validation (Zod). 
- **Impact:** Increases risk of mass assignment and prototype pollution if the array proxy is malicious. 
- **Guideline Violation:** *“Validate ALL inputs at the boundary using strict schemas (e.g., Zod, Joi).”*
- **Recommendation:** Refactor payloads utilizing `z.object({ userIds: z.array(z.number()).min(1).max(500) })`.

---

## 2. Database & State Security (`03_DATABASE_AND_STATE_SECURITY.md` & `04_VULNERABILITIES_AND_EXPLOITS.md`)

#### 🔴 Critical: Race Conditions & TOCTOU in Lifecycle Handlers
- **Vulnerability:** In `accountLifecycle.ts`, batch update handlers (like `hardDeleteUsers`, `softDeleteUsers`, and `enqueueForDeletion`) query the user's status sequentially *outside* of protective transaction boundaries, proceeding to destructively modify state.
  ```typescript
  // Time-of-Check (No Lock)
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.isDeleted) continue;
  
  // Time-of-Use (Separate Query/Transaction)
  await db.transaction(async (tx) => { ... });
  ```
- **Impact:** Parallel invocations can trigger duplicate execution. If a user is converted to an Admin exactly between the check and execution, the `hardDeleteUsers` logic will wipe the internal admin.
- **Guideline Violation:** *“Race Conditions (Time-of-Check to Time-of-Use - TOCTOU): Implement DB-layer Row Locking (`SELECT ... FOR UPDATE`), use Redis Distributed Locks ... or enforce atomic DB operations.”*
- **Recommendation:** Wrap the entire atomic user verification and deletion workflow within the `db.transaction(tx)`, utilizing `.for('update')` (Row Locks).

#### 🔴 High: Full-Scan Amplification on `runInactivitySweep`
- **Vulnerability:** `runInactivitySweep` constructs extremely costly CTE aggregations:
  ```sql
  WITH sess AS (SELECT user_id, MAX(last_active_at) ... FROM user_sessions GROUP BY user_id),
  ...
  ```
- **Impact:** This query sequentially aggregation-scans three massive ledger tables (`user_sessions`, `user_login_history`, `trades`) without bounding them to recent logs or chunking them. The execution costs scale linearly with platform growth, locking up read-replicas or the primary PG node entirely.
- **Guideline Violation:** *“Apply aggressive, specialized rate limiting to expensive endpoints: Heavy database exports or analytical dashboard queries.”* (02_API_AND_ROUTES_SECURITY.md).
- **Recommendation:** Re-architect the `lastActiveAt` calculation structurally. Maintain a deterministic metadata `last_seen_at` cache inside the `users` (or profile) schema to prevent re-aggregation of 100M+ session/trade rows every sweep.

---

## 3. Vulnerabilities & Defense-in-Depth (`04_VULNERABILITIES_AND_EXPLOITS.md`)

#### 🟡 Medium: Silent Transaction Failures (Data Integrity Drift)
- **Vulnerability:** `hardDeleteUsers` utilizes an error-suppressing helper within its transaction:
  ```typescript
  const safeDelete = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch { /* tolerate missing tables/columns across schema versions */ }
  };
  ```
- **Impact:** If an integrity constraint triggers a failure (e.g. failing to wipe `userAdminNotes`), it wraps the error silently. This compromises standard compliance policies regarding PII removal (GDPR/CCPA "Right to be Forgotten" guarantees).
- **Guideline Violation:** *“Cascading Failures / Data Drift... Failsafe should be explicit.”*
- **Recommendation:** Remove silent `catch`. The transaction should cleanly abort and trigger a failed task event if all dependent PII tables cannot be removed.

---

## 4. Frontend Resilience (`bug_vulnerability_catalog.md`)

#### 🔵 Low: UI Freezing during Sweeps
- **Observation:** `UserActivityAdmin.tsx` relies on TanStack queries properly (`runSweep.mutate`), but doesn't implement polling boundaries if the backend `sweep` operation breaches 10-second request limits because of full table scans (BT-07 / Aggressive Timeout).
- **Guideline Check:** Properly hooks into `disabled={runSweep.isPending}` protecting against double-submit spam on the Admin interface.

---

## Final Recommendation & Path Forward
1. **Critical Refactor:** Migrate the `POST` endpoints inside `adminActivity.ts` to utilize parsed Zod body definitions with strict limits on `userIds` array depth.
2. **Database Resilience:** Refactor the aggregation CTE in `listAdminActivity` and `runInactivitySweep` to use optimized indexes or a decoupled `last_active_cache` column to relieve DB pressure.
3. **Atomic Constraints:** Add DB-layer row locking for `hardDeleteUsers` flows and eliminate `safeDelete` silent `try/catch` suppression to guarantee data integrity across migrations.
