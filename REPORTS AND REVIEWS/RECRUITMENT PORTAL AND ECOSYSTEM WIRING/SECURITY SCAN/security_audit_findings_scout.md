# Partner Portal and Scout System Vulnerability Audit

## Executive Summary
This document summarizes the findings from a detailed security audit of the `partnerPortal.ts`, `adminScout.ts`, `scoutService.ts`, `scoutMetrics.ts`, and `PartnerPortal.tsx` files, mapped against the established security checklists (Master Policy, Architecture & Transport, APIs & Routes, Database & State, Vulnerabilities & Exploits, Coding Standards, and Agent Development) and the `bug_vulnerability_catalog.md`.

## Methodology
The review focused on identifying deviations from mandated patterns, specifically looking for:
-   **Authentication & Authorization Flaws** (BOLA/BOPLA)
-   **Injection Vectors** (SQLi, NoSQLi, Command Injection, XSS)
-   **Data Validation Gaps** (Zod schema completeness, client-side validation)
-   **Business Logic Flaws** (Race conditions, improper state transitions)
-   **Cryptography Issues** (Key management, encryption at rest/transit)
-   **Auditing and Logging Deficiencies**

## Findings by File

### 1. `server/routes/partnerPortal.ts`

**Overall Posture:** Generally good. Uses Zod for input validation, implements rate limiting (`partnerPortalRateLimit`), and uses a middleware (`requirePartnerAuth`) for access control.

**Identified Issues:**

*   **Vulnerability:** Weak Output Shaping / Potential Data Leakage (Reference: `02_API_AND_ROUTES_SECURITY.md` - Output Data Shaping).
    *   **Description:** In several routes (e.g., `GET /`, `GET /onboarding`, `PUT /onboarding/legal`), the entire `partner` object or results from database updates are returned directly to the client without explicit shaping. While `requirePartnerAuth` might attach a sanitized version to `req.partner`, returning raw database results can inadvertently leak internal IDs or future fields.
    *   **Location:** Scattered throughout. Example: `return res.json({ ok: true, partner: updated });`
    *   **Fix:** Implement explicit DTOs (Data Transfer Objects) or strict `select` clauses in Drizzle to ensure only intended fields (e.g., `id`, `name`, `onboardingStep`) are returned.

*   **Deviation:** Lack of explicit transaction for multi-step operations (Reference: `03_DATABASE_AND_STATE_SECURITY.md` - Transaction Integrity).
    *   **Description:** The `/onboarding/legal` route performs an update to the `partners` table and immediately follows it with an `appendRecruitmentAudit` call. If the audit append fails, the partner state is updated, but the audit trail is incomplete.
    *   **Location:** `partnerPortalRouter.put("/onboarding/legal", ...)`
    *   **Fix:** Wrap the state update and the audit log insertion in a Drizzle database transaction.

### 2. `server/routes/adminScout.ts`

**Overall Posture:** This file is massive and handles critical administrative functions. It utilizes Zod extensively and includes robust auditing for most actions.

**Identified Issues:**

*   **Vulnerability:** BOLA (Broken Object Level Authorization) Risk on ID-based lookups (Reference: `02_API_AND_ROUTES_SECURITY.md` - BOLA/BOPLA Prevention).
    *   **Description:** Many routes rely solely on `req.params.id` for updating or deleting resources (e.g., `DELETE /challenges/:id`, `PUT /prizes/:id/approve`). While protected by `requireAdmin`, if granular admin roles are ever implemented (e.g., 'View Only Admin' vs 'Super Admin'), these routes lack checks to ensure the *specific* admin is authorized to perform the action on that *specific* resource.
    *   **Location:** Widespread.
    *   **Fix:** Implement granular attribute-based access control (ABAC) checks within the route handlers, verifying the admin's permissions against the target resource's attributes before action.

*   **Deviation:** Inconsistent Transaction Usage for Complex State Changes (Reference: `bug_vulnerability_catalog.md` - Race Conditions).
    *   **Description:** In `adminPartnersRouter.post("/invite", ...)`, an invite is created, an email is sent, and an audit log is appended. If the email sending fails (which is an asynchronous network operation), the partner and invite records are already created. While idempotency is implemented, the database state might become inconsistent with the actual real-world state (email not sent).
    *   **Location:** `adminPartnersRouter.post("/invite", ...)`
    *   **Fix:** Coordinate the database insertion and email sending more tightly. The database inserts should happen first, followed by the email. If the email fails, the system must handle the failure gracefully (e.g., mark the invite email status as 'FAILED' in the DB, allowing for retries, rather than relying solely on idempotency to prevent duplicates).

*   **Deviation:** Insufficient Input Validation on Configuration Updates.
    *   **Description:** The `PUT /settings` route takes a massive payload to update `systemConfig`. While Zod is likely used implicitly, the sheer size of the configuration update should necessitate strict, explicit validation of every field to prevent unexpected system behavior.
    *   **Location:** `adminScout.ts` -> `/settings` route.
    *   **Fix:** Ensure the Zod schema for system configuration updates is exhaustive and uses `.strict()` to reject any unmapped properties.

### 3. `server/scout/scoutService.ts` & `server/scout/calcScoutMetrics.ts`

**Overall Posture:** Handles complex SQL queries and metric calculations.

**Identified Issues:**

*   **Vulnerability:** Potential SQL Injection Vector in Raw Queries (Reference: `03_DATABASE_AND_STATE_SECURITY.md` - Injection Prevention).
    *   **Description:** The queries in `scoutService.ts` heavily utilize `dbClient.query(sqlText, [...args])` rather than Drizzle's query builder. While parameters are parameterized (using `$1`, `$2`, etc.), constructing complex SQL strings manually increases the risk of subtle injection flaws, especially if dynamic sorting or filtering is later added without rigorous parameterization.
    *   **Location:** `listAdminScoutCandidates`, `listPartnerDataRoomCandidates`.
    *   **Fix:** Transition these complex queries to Drizzle's query builder, or use Drizzle's `sql\`\`` template literal tag, which provides built-in parameterization and type safety, reducing the risk of accidental string concatenation vulnerabilities.

*   **Deviation:** Lack of Query Timeout Controls (Reference: `04_VULNERABILITIES_AND_EXPLOITS.md` - DoS Resilience).
    *   **Description:** The `runCalcScoutMetricsPass` calculates metrics over a potentially massive dataset. There are no explicit timeouts configured for these complex aggregation queries. A malicious user or a sudden spike in data could cause these queries to tie up database connections indefinitely, leading to a Denial of Service.
    *   **Location:** `server/scout/calcScoutMetrics.ts` -> `runCalcScoutMetricsPass`.
    *   **Fix:** Implement database-level statement timeouts for these analytical queries to ensure they fail safely if they consume excessive resources.

### 4. `server/cron/scoutMetrics.ts`

**Overall Posture:** Manages the execution of the metrics calculation.

**Identified Issues:**

*   **Deviation:** Unhandled Promise Rejection Potential in `setInterval`.
    *   **Description:** The `setInterval` calls `runScoutMetricsPassNow()` but uses `void` to suppress the unhandled promise warning. While the inner function has a `try/catch` block, any catastrophic failure within the cron orchestration itself might go unnoticed or cause instability.
    *   **Location:** `setInterval` call.
    *   **Fix:** Ensure robust application-level error monitoring is in place to catch any synchronous exceptions thrown from within the cron setup or interval callback.

### 5. `client/src/pages/PartnerPortal.tsx`

**Overall Posture:** Secure usage of React paradigms. It heavily leverages `zod` for parsing and validating all API responses before they are allowed into state, providing a strong defense against unexpected or malicious backend data. It correctly handles complex state drafts and E2EE encryption for communications (`useMailboxE2eeBootstrap`, `encryptTextForMailboxRecipients`). React automatically escapes values rendered in JSX, mitigating most basic XSS vectors. State updates appear defensive and immutable.

**Identified Issues:** None observed that violate the provided security checklists. The frontend architecture in this file appears robust.

## Conclusion and Next Steps

The audited files demonstrate a strong foundation in security practices, utilizing Zod for validation, implementing robust auditing, and employing parameterized queries. However, specific areas require attention to fully align with the stringent security policies outlined in the checklists.

The most critical remediation efforts should focus on:
1.  **Strict Output Shaping (Backend):** Preventing accidental data leakage by explicitly defining return payloads in route handlers (`partnerPortal.ts`, `adminScout.ts`).
2.  **Transaction Integrity (Backend):** Ensuring multi-step state changes and corresponding audit logs are wrapped in atomic database transactions (`partnerPortal.ts`, `adminScout.ts`).
3.  **BOLA Prevention (Backend):** Implementing granular attribute-based access controls for administrative actions, anticipating future role expansion (`adminScout.ts`).
4.  **Refactoring Raw SQL (Backend):** Migrating complex analytical queries to use Drizzle's `sql\`\`` tag or query builder for enhanced safety against injection (`scoutService.ts`).

The frontend implementation (`PartnerPortal.tsx`) is solid and defensively handles data, demonstrating a good grasp of secure React development practices.
