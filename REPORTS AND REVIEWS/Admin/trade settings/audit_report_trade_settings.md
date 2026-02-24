# Deep Audit Report: Trade Settings Tab

## 1. Overview
This report provides a deep security and architectural audit of the "Trade Settings" tab in the Admin Dashboard, which governs the platform's global trading limits, market hours, and logic controls.

## 2. Component Analysis
- **Frontend**: `client/src/pages/AdminDashboard.tsx`
- **Backend API**: `GET /api/admin/global-settings`, `PUT /api/admin/global-settings` in `server/routes/admin.ts`
- **Database**: `global_settings` table in `shared/schema.pg.ts`

## 3. Vulnerabilities and Findings

### 3.1. Input Validation, Mass Assignment (BOPLA) & Prototype Pollution
**Status:** Defensively Handled, but diverges from standards.
- **Positive:** The `PUT` endpoint mitigates prototype pollution and mass assignment by explicitly destructuring and parsing each field using safe helper functions (`parseNum`, `parseBool`, `parseTime`). It creates a new object (`next`) rather than merging the raw JSON body, adhering to `SECURITY2026_Gpt5_2.md` and `06_AGENT_DEVELOPMENT_CHECKLIST.md` guidelines on preventing BOPLA.
- **Positive:** Strong numeric boundary verification via `ensureRange` and `ensureNumericInput` arrays before committing to the database.
- **Concern (Zod Bypassed):** The endpoint bypasses the standardized `insertGlobalSettingsSchema` (Zod) defined in `shared/schema.pg.ts`, relying entirely on manual, verbose extraction. As noted in `report_1_frontend_and_state.md` Section 9, custom coercions can fail on empty strings or nulls if not careful, though the custom parsers here seem defensive. Moving to Zod with `.strict()` is still the mandated approach.

### 3.2. End-to-End Encryption (E2EE) & Secure Transport
**Status:** Architecture-compliant, E2EE N/A.
- **Analysis:** Checklist `01_ARCHITECTURE_AND_TRANSPORT.md` mandates E2EE only for data the server theoretically should not read (e.g., private messaging). Because the Trading Engine *requires* plaintext access to these settings (`defaultLeverage`, `maxPositionSize`) to enforce validations, E2EE is mutually exclusive with its function.
- **Validation:** The system operates securely over standard transport encryption (TLS) and processes data securely in-memory. To prevent middlebox modification (Data Modification vulnerabilities), administrators can explore JWS (JSON Web Signatures) for payload signing, though TLS ensures strong transport integrity.

### 3.3. Race Conditions, Concurrency, and Crashes
**Status:** Vulnerable (High Severity)
- **Rate Limit Bypass:** The endpoint enforces a 500ms spam-delay rate limit using an in-memory `Map` (`globalSettingsUpdateMsByAdminId`). In a horizontally scaled Node.js architecture with multiple instances, this in-memory map doesn't share state, allowing parallel API calls sent to different load-balanced nodes to bypass the limiter.
- **Crash Vector (DB Insert):** At line 3100 of `server/routes/admin.ts`, the code attempts `await db.insert(globalSettings).values({ id: 1, ... })` EVEN IF `existing` is true. Because there is no `.onConflictDoUpdate()` clause appended to this insertion, saving global settings after the initial row exists will result in a fatal `Unique Constraint Violation` from PostgreSQL, causing a 500 Internal Server Error and rejecting the update.
- **Concurrency (TOCTOU) & Missing Locks:** The endpoint lacks optimistic concurrency control (e.g., requiring the client to pass an `updatedAt` version timestamp) or database-level row locks (e.g., `FOR UPDATE`), violating `06_AGENT_DEVELOPMENT_CHECKLIST.md` directives for atomic state transitions. If two admins click save concurrently, the last request overwrites the first without warning.

### 3.4. Audit Logging & Non-Repudiation
**Status:** Vulnerable (Critical Compliance Issue)
- **Missing Log for Core Changes:** While the endpoint logs the `GLOBAL_SETTINGS_PERFORMANCE_UPDATED` event using `appendIdentityAudit`, it *only* triggers if the performance metrics (polling, flush, prefetch delays) are changed. If an admin silently alters high-risk fields like `defaultLeverage`, `maxPositionSize`, or `dailyLossLimitPct`, the system skips the audit log entirely. This violates zero-trust, non-repudiation policies, and the core auditing requirements outlined in `SECURITY2026_Gpt5_2.md` Section 15.

### 3.5. System Architecture & Component "Dejunking"
**Status:** Technical Debt (Medium Severity)
- **Controller Spaghettification:** Following the guidance in `05_CODING_STANDARDS_AND_PRACTICES.md`, controllers should be modular. The `/api/admin/global-settings` PUT controller is nearly 400 lines of massive, inline procedural code handling type-checking, delta-comparisons, auditing, caching, and DB insertions natively. It violates the Single Responsibility Principle (SRP) and should be dejunked by extracting pure service functions for logic verification.
- **Server Drift Prevention:** Infrastructure drift is a violation of the security mandate. Any persistence of configuration data must explicitly route entirely through the database rather than altering `.env` or Node process globals directly. The architecture strictly enforces this rule correctly.

## 4. Remediation Plan / Action Items for Agent
1. **Fix DB Constraint Crash**: Refactor the global settings save operation to either use `db.update(globalSettings).set(...).where(eq(globalSettings.id, 1))` when `existing` is true, or attach an `.onConflictDoUpdate()` clause to the insert statement.
2. **Fix Audit Logging Gap**: Expand the delta-check (lines 3160-3188) to compare ALL risk parameters (not just performance caching parameters) and emit a dedicated `GLOBAL_SETTINGS_RISK_UPDATED` audit trace when capital limits, lots, or market hours are mutated. This fulfills `SECURITY2026_Gpt5_2.md` auditing requirements.
3. **Refactor Rate Limiter**: Move the `GLOBAL_SETTINGS_UPDATE_MIN_INTERVAL_MS` check to be backed by Redis (or PostgreSQL) instead of a transient Node.js `Map` to survive multi-node scaling scenarios.
4. **Implement Optimistic Concurrency**: Update the frontend payload and backend validation to include the known `updatedAt` timestamp, fulfilling the `06_AGENT_DEVELOPMENT_CHECKLIST.md` row-lock and transaction gates. Reject the save with a 409 Conflict if the timestamp does not match the server's current DB state.
5. **Schema Unification & Dejunking**: Replace the manual, inline parsing and 400-line controller logic with the `insertGlobalSettingsSchema.parse()` pipeline to ensure uniform validation that adheres to standard practices (`02_API_AND_ROUTES_SECURITY.md` and `05_CODING_STANDARDS_AND_PRACTICES.md`). Extract the delta comparisons and validation logic into pure functions.
