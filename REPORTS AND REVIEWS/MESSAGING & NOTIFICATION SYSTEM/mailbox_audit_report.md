# Internal Mailbox & Messaging System — Deep Implementation Audit

**Date:** 2026-02-07  
**Scope:** Implementation verification against PRD and Implementation Plan, thread isolation analysis, security assessment

---

## Executive Summary

The Internal Mailbox and Messaging System has been **substantially implemented** and exceeds the original PRD requirements in several areas (async fanout, configuration controls). However, critical security gaps exist around **message encryption at rest** and **end-to-end encryption (E2E)** which are industry best practices for messaging systems. Thread isolation is correctly enforced, and 1:1 reply chains are properly separated from broadcast messages.

---

## 1. PRD Compliance Assessment

### ✅ Fully Implemented

| PRD Requirement | Implementation Location | Status |
|-----------------|------------------------|--------|
| Thread-based messaging | `mailbox_threads`, `mailbox_messages` tables | ✅ Complete |
| Admin broadcast to all/tier/cohort | [mailbox.ts L194-300](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\routes\mailbox.ts#L194-300) | ✅ Complete |
| Manual user selection | `mode: "USER_IDS"` in compose schema | ✅ Complete |
| Reply toggle per message | `allow_reply` column, enforced in [messaging.ts L828](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\services\messaging.ts#L828) | ✅ Complete |
| Admin Communications tab | [AdminCommunications.tsx](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\client\src\pages\AdminCommunications.tsx) | ✅ Complete |
| Client Mailbox minitab | [MailboxMinitab.tsx](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\client\src\components\Mailbox\MailboxMinitab.tsx) | ✅ Complete |
| Notification bell in Header | [NotificationBell.tsx](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\client\src\components\NotificationBell.tsx) | ✅ Complete |
| Real-time WebSocket push | `publishLiveEvent()` in messaging.ts | ✅ Complete |
| Notification sound toggle | `notificationSoundDefaultEnabled` setting + client toggle | ✅ Complete |
| Trade notifications (TP/SL/MaxHold) | `isNotificationEnabledForEvent()` in messaging.ts L477-518 | ✅ Complete |
| Account freeze/unfreeze alerts | `notificationAccountFreezeEnabled` setting | ✅ Complete |
| KYC status notifications | `notificationKycUpdatesEnabled` setting | ✅ Complete |

### ✅ Exceeds Requirements

| Feature | Implementation | Notes |
|---------|----------------|-------|
| **Async fanout queue** | `broadcastFanoutQueue` in messaging.ts | Handles 200k+ recipients without API timeout |
| **Configurable thresholds** | `communication_settings` table | Admin can tune batch sizes, limits |
| **Large target confirmation** | `LARGE_TARGET_CONFIRMATION_REQUIRED` error | Prevents accidental mass sends |

### ⚠️ Partially Implemented / Gaps

| PRD Requirement | Current Status | Gap Description |
|-----------------|----------------|-----------------|
| **Welcome message on signup** | Config exists (`messagingAutoWelcomeEnabled`) | **No actual signup hook integration found** in `auth.ts` or routes |
| **Rich Text/Markdown body** | Plaintext only | Body is stored as `TEXT`, no Markdown rendering on frontend |
| **Message categories UI** | Backend supports `SYSTEM/SUPPORT/ANNOUNCEMENT` | Frontend shows category but no filtering/sorting by category |

---

## 2. Thread Isolation Analysis (1:1 vs Broadcast)

### ✅ CORRECT: Reply-Enabled Broadcasts Create Separate Threads

When an admin sends a **reply-enabled message to multiple recipients**, the system correctly creates **separate 1:1 threads** for each recipient:

```typescript
// mailbox.ts L248-277
if (allowReply && recipientUserIds.length > 1) {
  const results: Array<{ threadId: number; messageId: number; queued: boolean }> = [];
  for (const recipientUserId of recipientUserIds) {
    const created = await createMailboxThreadWithMessage({
      ...
      recipientUserIds: [recipientUserId],  // Single recipient per thread
      isBroadcast: false,
      messageType: "DIRECT",
    });
    results.push({ ... });
  }
  return res.status(201).json({ ... });
}
```

**Verification:** User A cannot see User B's reply chain. Each user only sees their own thread.

### ✅ CORRECT: Participant Access Enforcement

```typescript
// messaging.ts L655-665
async function assertThreadParticipant(threadId: number, userId: number): Promise<void> {
  const [participant] = await db
    .select({ threadId: mailboxParticipants.threadId })
    .from(mailboxParticipants)
    .where(and(eq(mailboxParticipants.threadId, threadId), eq(mailboxParticipants.userId, userId)))
    .limit(1);

  if (!participant) {
    throw new Error("THREAD_ACCESS_DENIED");  // ← Blocks unauthorized access
  }
}
```

### ✅ CORRECT: Reply Permissions

```typescript
// messaging.ts L828
if (!input.senderIsAdmin && !latestMessage.allowReply) throw new Error("REPLY_DISABLED");
```

---

## 3. Security Assessment

### 🔴 CRITICAL: No End-to-End Encryption

**Current State:**
- Message bodies are stored as **plaintext** in PostgreSQL
- No encryption layer between client and server beyond TLS
- No message-level encryption at rest

**Risk:** Database breach exposes all message content. Insider threat (DB admin) can read all communications.

### 🟡 MEDIUM: Transport Security

**Current State:**
- Server uses `createServer(app)` (HTTP) — expects TLS termination at reverse proxy/load balancer
- Session cookies likely use `secure: true` in production (not verified in this audit)
- External API calls use HTTPS (Resend, Twilio, 1Forge)

**Recommendation:** Ensure:
1. Nginx/Caddy/ALB terminates TLS with modern cipher suites (TLS 1.3)
2. HSTS headers configured
3. `cookie.secure = true` in production

### 🟢 GOOD: Existing Encryption Infrastructure

**Found:** [crypto.ts](file:///\\wsl.localhost\Ubuntu\home\bcodex\TD.2.ANTIGRAVITY\server\services\crypto.ts) provides AES-256-GCM encryption:
- Used for TOTP secrets (`totp_secret_enc` column)
- **NOT used for mailbox messages**

```typescript
export function encryptString(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // ...
}
```

---

## 4. Failure Points & Bugs

### Bug 1: Welcome Message Not Integrated

**Location:** PRD specifies automated welcome message on signup  
**Status:** `messagingAutoWelcomeEnabled` config exists but no call to `createMailboxThreadWithMessage` found in auth signup flow

**Fix Required:** Add hook in signup success path:
```typescript
if (settings.messagingAutoWelcomeEnabled) {
  await createMailboxThreadWithMessage({
    senderUserId: null, // System
    recipientUserIds: [newUser.id],
    subject: "Welcome to TradeQuip!",
    body: "...",
    category: "SYSTEM",
    allowReply: false,
  });
}
```

### Bug 2: Admin Reply Count Not Tracked

**Observation:** Admin inbox (`/admin/replies`) lists threads where admin is participant, but no explicit "user replied" flag or timestamp for triage prioritization.

### Potential Issue: Race Condition in Fanout

**Location:** `processBroadcastFanoutQueue()` uses in-memory queue  
**Risk:** Server restart during fanout loses pending jobs  
**Mitigation:** Current code logs metrics but doesn't persist queue state

---

## 5. Message Interception Risk Analysis

### Attack Vectors

| Vector | Current Protection | Risk Level |
|--------|-------------------|------------|
| **Man-in-the-middle (network)** | TLS at proxy layer (assumed) | 🟢 Low if properly configured |
| **Database breach** | None (plaintext storage) | 🔴 Critical |
| **Session hijacking** | Session tokens, `requireAuth` middleware | 🟡 Medium |
| **Admin impersonation** | `requireAdmin` middleware checks `isAdmin` | 🟢 Low |
| **SQL injection** | Drizzle ORM parameterized queries | 🟢 Low |

### WebSocket Security

```typescript
// LiveUpdatesProvider uses SSE or WebSocket
publishLiveEvent({ type: "mailbox:new", userId, payload: { threadId, messageId } });
```
- User ID filtering: `isMessageForCurrentUser()` in `use-mailbox.tsx` L93-97
- **Gap:** No proof-of-delivery or message signing

---

## 6. Recommended Security Plan

### Phase 1: Encryption at Rest (Immediate)

#### Implementation Steps:

1. **Encrypt message bodies using existing `crypto.ts`:**

```typescript
// In messaging.ts createMailboxThreadWithMessage
import { encryptString, decryptString } from "./crypto";

const encryptedBody = encryptString(body);
// Store encryptedBody in DB

// On retrieval:
const decryptedBody = decryptString(row.body);
```

2. **Database schema update:**
```sql
ALTER TABLE mailbox_messages ADD COLUMN body_encrypted TEXT;
ALTER TABLE mailbox_messages ADD COLUMN encryption_version INTEGER DEFAULT 1;
```

3. **Migration:** Batch-encrypt existing messages with background job

### Phase 2: End-to-End Encryption (Medium Term)

#### Architecture:

```
┌─────────────┐            ┌─────────────┐            ┌─────────────┐
│   Admin     │            │   Server    │            │   Trader    │
│  (Browser)  │            │  (Backend)  │            │  (Browser)  │
└──────┬──────┘            └──────┬──────┘            └──────┬──────┘
       │                          │                          │
       │ 1. Fetch recipient's     │                          │
       │    public key            │                          │
       │ ─────────────────────────>                          │
       │                          │                          │
       │ 2. Encrypt message with  │                          │
       │    recipient's public key│                          │
       │ (client-side)            │                          │
       │                          │                          │
       │ 3. Send encrypted blob   │                          │
       │ ─────────────────────────>                          │
       │                          │ 4. Store encrypted       │
       │                          │    (cannot read)         │
       │                          │                          │
       │                          │ 5. Push notification     │
       │                          │ ──────────────────────────>
       │                          │                          │
       │                          │                          │ 6. Fetch encrypted
       │                          │ <──────────────────────────
       │                          │                          │
       │                          │                          │ 7. Decrypt with
       │                          │                          │    private key
```

#### Key Management:

1. **Key generation on signup:**
   - Generate ECDH P-256 keypair in browser
   - Store public key in DB (`users.mailbox_public_key`)
   - Store private key in IndexedDB/LocalStorage (encrypted with password-derived key)

2. **Key recovery:**
   - Optional: Escrow encrypted private key server-side (encrypted with master key)
   - User can regenerate keypair (loses old message access)

3. **Multi-device:**
   - Sync encrypted private key across devices via secure channel

### Phase 3: Audit Trail Hardening

1. **Immutable message log:**
```sql
CREATE TABLE mailbox_message_audit (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'CREATED', 'READ', 'DELETED'
  actor_id INTEGER,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  hash TEXT NOT NULL -- SHA-256 of message content + timestamp
);
```

2. **Tamper detection:** Store hash chains for integrity verification

---

## 7. Summary Table

| Category | Status | Priority |
|----------|--------|----------|
| PRD Functional Requirements | ✅ 90% Complete | — |
| Thread Isolation | ✅ Correct | — |
| Reply Chain Privacy | ✅ Correct | — |
| Transport Security | 🟡 Assumed TLS | Medium |
| Encryption at Rest | 🔴 Not Implemented | **Critical** |
| End-to-End Encryption | 🔴 Not Implemented | High |
| Welcome Message Hook | ⚠️ Missing | Low |
| Audit Trail | 🟡 Basic | Medium |

---

## 8. Recommended Immediate Actions

1. **Verify TLS configuration** in production (Nginx/Caddy certs, cipher suites)
2. **Encrypt message bodies at rest** using existing `crypto.ts`
3. **Add welcome message hook** to signup flow
4. **Implement database-level access controls** (row-level security or separate read-only user for reporting)
5. **Review session cookie security** (`secure`, `httpOnly`, `sameSite`)

---

*Report generated by automated audit system. No code was modified during this investigation.*
