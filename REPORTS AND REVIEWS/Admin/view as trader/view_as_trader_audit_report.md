# Deep Audit Report: View As Trader Implementation

This document serves as a comprehensive system diagnosis and vulnerability report for the `View As Trader` (Admin Impersonation) architecture, cross-checked against the core platform security checklists. It is formatted to be consumed by a subsequent implementation agent.

## 1. Executive Summary
The "View As Trader" implementation effectively maintains a systemic separation of "Actor" vs "Effective User" (storing `realAdminId` on the session objects). It successfully integrates UI banners and `impersonationGuard` to strictly whitelist read-operations while disabling standard writes, mitigating severe manipulation risks.

However, the audit reveals multiple boundary flaws specifically around **Type Validation**, **WebSocket State Desynchronization**, and **Rate Limiting**, which present moderate-to-high risks in a financial technology context.

---

## 2. Identified Vulnerabilities & Exploits

### VULN-01: Weak Input Validation on Impersonation Start (OWASP API1/API3)
- **Location:** `server/routes/admin.ts` (`POST /api/admin/view-as/start`)
- **Severity:** Medium
- **Description:** 
  The endpoint uses vanilla JS parsing: `targetUserId = parseInt(req.body.userId)`. Per `02_API_AND_ROUTES_SECURITY.md`, loose coercion bypasses strict primitive checks. While `isNaN` partially protects against strings, malicious JSON arrays (e.g., `userId: [1]`) or prototype overrides could invoke unexpected behavior in the subsequent `storage.getUserById`.
- **Target Fix:** Wrap the request validation in a strict Zod schema.
  ```ts
  const StartSchema = z.object({ userId: z.number().int().positive() });
  const { userId } = StartSchema.parse(req.body);
  ```

### VULN-02: WebSocket TTL Desynchronization / State Exhaustion (OWASP ASI08)
- **Location:** `server/routes/wsCore.ts` AND `server/middleware/auth.ts`
- **Severity:** High
- **Description:** 
  In the HTTP layer (`middleware/auth.ts`), `impersonationGuard` evaluates `IMPERSONATION_TTL_MS (15 minutes)` and drops or restores sessions that exceed this threshold. However, WebSockets (`wsCore.ts`) hydrate the initial state (`client.isImpersonating = Boolean(sess?.isImpersonating)`) but lack a live chronological evaluation ticker. If an admin initiates "View As", the WS connection can stream trader-specific live data indefinitely as long as ping/pong succeeds, bypassing the 15-minute operational limit.
- **Target Fix:** 
  Implement a chronological TTL verifier inside the `wsCore.ts` broadcast or heartbeat loop. If `Date.now() - client.session.impersonationStartedAt > IMPERSONATION_TTL_MS`, forcibly drop the WS connection (`client.ws.close(1008, "Impersonation TTL Expired")`).

### VULN-03: Missing Rate Limits on Target Traversal (OWASP API4)
- **Location:** `server/routes/admin.ts`
- **Severity:** Low-Medium
- **Description:** 
  While protected by `requireAdmin`, a compromised admin token could automatically script thousands of incremental `userId` requests to `/api/admin/view-as/start`, utilizing the JSON `{ message: "Now viewing as x@email.com" }` output to scrape all emails silently. 
- **Target Fix:** 
  Attach an aggressive, specialized Express-rate-limit specifically to the `/api/admin/view-as/start` endpoint (e.g., max 10 requests per 5 minutes per `adminId`).

### VULN-04: Lack of Actor Traceability on Streaming Events
- **Location:** `server/routes/wsCore.ts`
- **Severity:** Informational
- **Description:** 
  While HTTP `VIEW_AS_START` and `VIEW_AS_STOP` logs track the administrative actor, persistent connections lack an immutable trail showing an admin joined a specified private WS channel/stream. 
- **Target Fix:** 
  During `authWS` handshake, if `client.isImpersonating` is true, invoke an audit event establishing the WS connect under the `realAdminId` actor scope.

---

## 3. Compliance and Hardening Recommendations

This section benchmarks the current implementation against `00_SECURITY_MASTER_POLICY.md` and `04_VULNERABILITIES_AND_EXPLOITS.md`.

- [x] **Separation of Concerns:** `actorUserId` vs `effectiveUserId` is correctly preserved in `req.session.realAdminId`.
- [x] **Action Gating:** `impersonationGuard` natively disables `POST/PUT/PATCH/DELETE` out of the box. Admins cannot maliciously modify trader stakes while impersonating.
- [ ] **Data Defenses:** Missing `zod` input schemas for the request boundaries.
- [ ] **State Boundaries:** Required synchronization of the HTTP TTL into the real-time websocket layer.

## 4. Execution Guidance for Resolution Agent
To the agent implementing these fixes:
1. Locate `server/routes/admin.ts: /api/admin/view-as/start`. Modify it to use Zod for parsing `userId`.
2. Locate the same endpoint and apply a `rateLimit` middleware.
3. Locate `server/routes/wsCore.ts`. Add a TTL validation check inside the socket `ping` listener or the main message dispatch loop that evaluates the 15-minute gap and forcefully disconnects stale impersonation sockets.
