# Algorithm Design: Internal Mailbox & Notification System

## 1. Message Routing & Delivery Algorithm

### 1.1. Core Logic
The system must support both **Direct Messaging (1:1)** and **Broadcast Messaging (1:N)** efficiently without duplicating message content for every recipient.

**Data Structure Strategy:**
- **Store Message Content Once:** `mailbox_messages` table holds the body, subject, and metadata.
- **Link Recipients:** `mailbox_participants` table maps `message_id` to `user_id`.
- **Thread Management:** A `thread_id` groups related messages. For broadcasts, a new thread is created per recipient (conceptually) or a "Broadcast Group" thread is used if no reply is expected.
- **Optimization:** For "All Users" broadcasts, do *not* insert 10k rows into `mailbox_participants` immediately. Instead, use a "System Broadcast" flag and a `last_read_broadcast_id` on the user profile to pull generic messages dynamically. *However, for this specific request (MT5 style), individual persistence is preferred for "Inbox" feel.*

### 1.2. Pseudocode: Sending a Message
```
FUNCTION SendMessage(sender_id, recipient_ids, subject, body, allow_reply, is_broadcast):
    // 1. Create Message Record
    message_id = INSERT INTO mailbox_messages (sender_id, subject, body, allow_reply, created_at)

    // 2. Handle Recipients
    IF is_broadcast AND recipient_ids IS "ALL":
        // Optimization: Use a special "ALL_USERS" recipient or background job to fan-out
        JobQueue.enqueue("FanOutBroadcast", message_id)
    ELSE:
        FOR each user_id IN recipient_ids:
            // Check if existing thread exists (for 1:1)
            thread_id = FindThread(sender_id, user_id)
            IF thread_id IS NULL:
                thread_id = CreateThread(sender_id, user_id)

            INSERT INTO mailbox_participants (thread_id, user_id, message_id, is_read=FALSE)

    // 3. Trigger Real-time Notification
    FOR each user_id IN recipient_ids:
        WebSocket.emit(user_id, "NEW_MESSAGE", { id: message_id, subject: subject })
```

### 1.3. Pseudocode: Fetching Mailbox (User Side)
```
FUNCTION GetUserMailbox(user_id, page, limit):
    // 1. Fetch Direct Messages
    direct_msgs = SELECT * FROM mailbox_participants 
                  JOIN mailbox_messages ON ...
                  WHERE user_id = user_id
                  ORDER BY created_at DESC

    // 2. Fetch System Broadcasts (if using optimization)
    broadcasts = SELECT * FROM mailbox_messages 
                 WHERE is_global_broadcast = TRUE 
                 AND created_at > user.created_at

    // 3. Merge and Sort
    all_messages = Merge(direct_msgs, broadcasts).SortByDate()
    
    RETURN Paginate(all_messages, page, limit)
```

## 2. Notification Trigger Algorithm

### 2.1. Trade Execution Hooks
The trading engine (`onTradeClose`, `onOrderFill`) must accept a hook to trigger notifications.

**Alert Logic:**
```
EVENT OnTradeClosed(trade):
    // 1. Check if notifying is enabled for this user/trade type
    settings = GetUserNotificationSettings(trade.user_id)
    
    // 2. Determine Notification Type
    IF trade.close_reason == "TP_HIT":
        type = "TAKE_PROFIT"
        message = "Take Profit hit for " + trade.symbol + " at " + trade.close_price
    ELSE IF trade.close_reason == "SL_HIT":
        type = "STOP_LOSS"
        message = "Stop Loss hit for " + trade.symbol + " at " + trade.close_price
    ELSE IF trade.close_reason == "MAX_HOLD":
        type = "MAX_HOLD"
        message = "Trade closed due to maximum hold time violation."
    ELSE IF trade.close_reason == "LIQUIDATION":
        type = "MARGIN_CALL"
        message = "Position liquidated due to low margin."
    ELSE IF trade.open_reason == "PENDING_FILL":
        type = "ORDER_FILLED"
        message = "Pending order filled for " + trade.symbol
    ELSE:
        // Ignore manual open/close
        RETURN

    // 3. Persist Notification
    notification_id = INSERT INTO notifications (user_id, type, message, is_read=FALSE)
    
    // 4. Push to Client (with Sound Flag)
    WebSocket.emit(user_id, "NOTIFICATION", { type: type, message: message, playSound: TRUE })
```

### 2.2. Automated Clauses & Blocks
When the system (e.g., `risk.ts` or `compliance.ts`) takes an action against a user:

```
FUNCTION FreezeAccount(user_id, reason_code, reason_text):
    // 1. Update User Status
    UPDATE users SET is_frozen = TRUE WHERE id = user_id

    // 2. Send "Important" Mailbox Message
    SendMessage(
        sender_id = SYSTEM_ADMIN_ID, 
        recipient_ids = [user_id], 
        subject = "Account Frozen", 
        body = "Your account has been frozen. Reason: " + reason_text + ". Please contact support.", 
        allow_reply = TRUE // Allow them to appeal
    )

    // 3. Send Push Notification
    SendNotification(user_id, "URGENT", "Account Frozen: " + reason_code)
```

## 3. Admin Filtering & Targeting Algorithm

### 3.1. "Anti-Deluge" Bulk Selection
To prevent admins from being overwhelmed by selecting "All Users" manually:

**Selection Logic:**
- **Input:** Admin filters (e.g., `Tier="Gold"`, `LastActive < 30 days`).
- **Processing:**
    1.  Count potential matches.
    2.  IF matches > 100: Warn Admin ("You are targeting 5,400 users. Continue?").
    3.  IF confirmed: Process as a `BatchJob` rather than a synchronous API call.

### 3.2. Reply Triage
- **Inbox View:**
    - Filter `mailbox_messages` where `sender_id != ADMIN` (i.e., incoming replies).
    - Group by `thread_id`.
    - Sort by `last_reply_at` DESC.
    - **Highlight:** Threads with `is_read = FALSE` by Admin.

## 4. Platform Update Propagation
- **Requirement:** New symbols or platform changes.
- **Mechanism:**
    1.  Admin updates `symbol_configs`.
    2.  System automatically triggers a "silent" notification or a generic "News" item.
    3.  **Client:** On startup/refresh, client checks `daily_news` or `system_announcements` endpoint.
    4.  **Mailbox:** Optional "Weekly Digest" generated by a cron job summarizing new assets.

## 5. Toggle Logic for Reply & Sound
- **Database Column:** `mailbox_messages.allow_reply` (Boolean).
- **Frontend Check:**
    ```typescript
    if (message.allow_reply) {
        return <ReplyForm messageId={message.id} />
    }
    ```
- **Sound Logic:**
    -   Frontend listens for `NOTIFICATION` event.
    -   Checks `userSettings.soundEnabled` (default TRUE).
    -   Plays small `notification.mp3` asset.
