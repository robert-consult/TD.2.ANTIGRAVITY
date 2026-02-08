# Implementation Plan: Internal Mailbox & Messaging System

# Goal Description
Implement a robust internal messaging and notification system inspired by MetaTrader 5. This system enables admins to communicate with traders (broadcasts, direct messages) and provides real-time notifications for trade actions and account updates.

## User Review Required
> [!IMPORTANT]
> **Database Migration:** This plan requires adding 4 new tables (`mailbox_threads`, `mailbox_messages`, `mailbox_participants`, `notifications`). Ensure database backups are performed before applying schema changes.

> [!NOTE]
> **Performance:** Broadcasts to "All Users" should be implemented with a background job queue (e.g., BullMQ or similar if available, or a simple `setInterval` batch processor) to prevent API timeouts.

## Proposed Changes

### Database Schema (PostgreSQL)

#### [NEW] `current_schema.pg.sql` (Additions)
Define the following new tables:
1.  **`mailbox_threads`**:
    -   `id` (Serial/UUID, PK)
    -   `subject` (Text, optional - can be derived from first message)
    -   `created_at` (Timestamp)
    -   `updated_at` (Timestamp)
    -   `is_broadcast` (Boolean, default FALSE)
    -   `category` (Enum: 'SYSTEM', 'SUPPORT', 'ANNOUNCEMENT')

2.  **`mailbox_messages`**:
    -   `id` (Serial, PK)
    -   `thread_id` (FK -> `mailbox_threads.id`)
    -   `sender_id` (FK -> `users.id`, NULL for System)
    -   `body` (Text)
    -   `created_at` (Timestamp)
    -   `allow_reply` (Boolean, default FALSE)

3.  **`mailbox_participants`**:
    -   `thread_id` (FK -> `mailbox_threads.id`)
    -   `user_id` (FK -> `users.id`)
    -   `last_read_message_id` (FK -> `mailbox_messages.id`, NULL)
    -   `is_archived` (Boolean, default FALSE)
    -   `is_pinned` (Boolean, default FALSE)
    -   *Composite PK:* (`thread_id`, `user_id`)

4.  **`notifications`**:
    -   `id` (Serial, PK)
    -   `user_id` (FK -> `users.id`)
    -   `type` (Enum: 'TRADE', 'SYSTEM', 'ACCOUNT', 'SECURITY')
    -   `severity` (Enum: 'INFO', 'SUCCESS', 'WARNING', 'CRITICAL')
    -   `title` (Text)
    -   `message` (Text)
    -   `is_read` (Boolean, default FALSE)
    -   `created_at` (Timestamp)
    -   `link` (Text, optional - e.g., link to a trade or setting)

### Backend (Node.js/Express)

#### [MODIFY] `server/routes.ts`
-   Register new router: `app.use("/api/mailbox", mailboxRouter)`
-   Register new router: `app.use("/api/notifications", notificationsRouter)`

#### [NEW] `server/routes/mailbox.ts`
-   **GET `/`**: Fetch threads for current user (paginated).
    -   *Logic:* Join `mailbox_participants` -> `mailbox_threads` -> `mailbox_messages` (latest).
-   **GET `/:threadId`**: Fetch messages for a specific thread.
    -   *Logic:* Verify participation. Return messages ASC by `created_at`.
-   **POST `/`**: (Admin Only) Create a new thread/message.
    -   *Body:* `{ recipients: number[] | 'ALL' | FilterObject, subject, body, allowReply }`
    -   *Logic:* Create Thread -> Create Message -> Insert Participants (batch).
-   **POST `/:threadId/reply`**: Reply to a thread.
    -   *Logic:* Check `mailbox_messages.allow_reply` of the **latest** message (or thread setting).

#### [NEW] `server/routes/notifications.ts`
-   **GET `/`**: Fetch unread notifications + recent read ones.
-   **POST `/mark-read`**: Mark specific IDs or "All" as read.

#### [MODIFY] `server/services/tradeService.ts` (or similar trade execution logic)
-   Inject `NotificationService.send()` hooks into `onTradeClose`, `onOrderFill`, `onStopLossHit`, `onTakeProfitHit`, `onMaxHoldClose`.
-   **Logic Update:** Ensure manual close actions do *not* trigger notifications. Only specific system reasons (TP, SL, MAX_HOLD, LIQUIDATION, PENDING_FILL).

#### [MODIFY] `server/routes/auth.ts` (Signup)
-   Inject `MailboxService.sendWelcomeMessage(userId)` upon successful signup.

### Frontend (React/TSX)

#### [NEW] `client/src/assets/audio/notification.mp3`
-   Add a small, clean notification sound file.

#### [MODIFY] `client/src/components/Header.tsx`
-   Add **Notification Bell Icon**.
-   Implement `useQuery` polling or WebSocket subscription for unread count.
-   On click: Show Popover with list of recent notifications + "View All" link.
-   **Sound Logic:** Add `useAudio` hook or simple `ActiveNotification` listener to play sound on new alerts.

#### [MODIFY] `client/src/components/Navigation.tsx`
-   Confirm "Account" tab exists (it does).

#### [NEW] `client/src/components/Mailbox/MailboxMinitab.tsx`
-   **Layout:**
    -   **Left Sidebar:** List of threads (Subject, Sender, Date, Unread Dot).
    -   **Main Area:** Message conversation view (Bubble style or Email style).
    -   **Composer (Reply):** Text area (only visible if `allow_reply` is true).
-   **Integration:** Place this inside `Account.tsx` as a sub-tab or section.

#### [NEW] `client/src/pages/AdminCommunications.tsx`
-   **Tabs:** "Inbox", "Sent", "Compose", "Configuration".
-   **Compose Interface:**
    -   Recipient Selector: Multi-select dropdown + "Select All" + "Filter by Tier" + **"Manual Selection" (Checkbox list)**.
    -   "Reply Enabled" Toggle Switch.
    -   Rich Text Editor (optional) or Markdown support.

#### [MODIFY] `client/src/pages/AdminDashboard.tsx`
-   Add "Communications" to the main `TabsList`.
-   Render `AdminCommunications` component inside the new `TabsContent`.

## Verification Plan

### Automated Tests
-   **Backend:**
    -   Test sending a message to a single user (verify DB records).
    -   Test sending to "All Users" (verify participant creation).
    -   Test Reply permissions: User cannot reply if `allow_reply=false`.
    -   Test Notification triggers: Simulate a `TradeClosed` event and verify `notifications` table insertion.

### Manual Verification
1.  **Admin Broadcast:**
    -   Log in as Admin.
    -   Go to "Communications" -> "Compose".
    -   Select "All Users", Subject "System Update", Body "New Maintenance". Toggle "Reply Disabled".
    -   Send.
2.  **User Receipt:**
    -   Log in as User (e.g., in Incognito or separate browser).
    -   Check Account -> Mailbox. Verify message appears.
    -   Verify "Reply" input is **hidden**.
3.  **Two-Way Chat:**
    -   Admin sends 1:1 message to User with "Reply Enabled".
    -   User replies.
    -   Admin sees reply in "Inbox".
4.  **Notifications:**
    -   User places a trade with tight SL.
    -   Price moves (mock/simulated) to hit SL.
    -   Verify "Bell" icon shows specific "Stop Loss Hit" alert.

## Integration Steps
1.  Apply DB Schema migrations.
2.  Implement Backend Routes & Services.
3.  Implement Admin UI.
4.  Implement Client UI (Header & Account Mailbox).
5.  Connect WebSocket events.
