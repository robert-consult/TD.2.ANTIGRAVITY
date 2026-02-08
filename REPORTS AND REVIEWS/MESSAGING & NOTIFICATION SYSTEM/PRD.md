# Product Requirements Document: Internal Mailbox & Messaging System

## 1. Executive Summary
This document outlines the requirements for an internal mailbox and messaging system inspired by MetaTrader 5 (MT5). The system facilitates secure, triaged communication between Admins and Traders. It supports platform updates, broadcasting new assets, and direct communication, with configurable reply settings. It also integrates a robust notification system for trade actions and account states.

## 2. Project Goals
- **Enhanced Communication:** Provide a direct, in-app channel for admins to reach traders without relying on external email/SMS.
- **Operational Efficiency:** Allow bulk messaging and automated notifications to reduce manual admin workload.
- **User Engagement:** Keep traders informed about platform updates, new symbols, and account activities in real-time.
- **Control:** Give admins granular control over message reply capabilities and target audiences to prevent spam and communication overload.

## 3. User Roles & Permissions

### 3.1. Admin
- **Send Messages:** Can send messages to individual traders, specific groups/tiers, or the entire user base.
- **Configure Replies:** Can toggle "Reply Enabled" on a per-message or conversation basis.
- **Manage Notifications:** Configure system-wide alerts (e.g., maintenance, new symbols).
- **View Inbox/Sent:** specialized "Communications" tab in the Admin Dashboard.
- **Granular Targeting:** Ability to select users by ID, Tier, Activity Level, or "System Select" (automated grouping).

### 3.2. Trader (User)
- **Receive Messages:** View messages in a dedicated "Mailbox" minitab within the Account section.
- **Reply:** Can only reply to messages if the Admin has enabled the reply function for that specific thread.
- **Receive Notifications:** Real-time alerts for Trade Actions (TP/SL hit), orders, automated system clauses, and account status (blocks/freezes).
- **Visual Indicators:** "Blue" notification dot/icon on the Account header and distinct notification icon near the profile settings.

## 4. Functional Requirements

### 4.1. Messaging System (Mailbox)
- **Structure:** Thread-based or Subject-based messaging.
- **Types of Messages:**
    - **Platform Updates:** One-way announcements (e.g., "Maintenance at 02:00 UTC").
    - **Symbol Updates:** "New Universe Expansion" - alerts about new tradable assets. Customizable by admin.
    - **Tier Upgrades:** Notifications when a user moves to a new trading tier.
    - **Welcome Messages:** Automated welcome notes upon **Signup** and **Verification Approval**.
    - **Direct Support:** 1-on-1 communication for specific issues.
- **Reply Control:**
    - **Toggle:** Admin UI must have a "Allow Reply" toggle when composing.
    - **Logic:** If `FALSE`, user sees "No Reply" status. If `TRUE`, user sees a text input field.
- **Targeting (Anti-Deluge):**
    - **Bulk Select:** Select all users, or filter by Tier (e.g., "All Gold Tier").
    - **System Select:** Pre-defined cohorts (e.g., "Active in last 7 days", "High Risk").
    - **Manual Selection:** Manually select specific users via checkboxes from a list.
    - **Individual:** Search and select by User ID/Email.

### 4.2. Notification System
- **Real-time Alerts:** deeply integrated with the trading engine.
- **Triggers:**
    - **Trade Execution:** **Automated Only** (Pending Order Fills, Stop Outs). *Exclude manual Open/Close actions.*
    - **TP/SL Hit:** Specific alert when logic closes a trade.
    - **Max Hold Time:** Alert when a trade is closed due to exceeding maximum hold duration.
    - **Automated Clauses:** "See Reasons" context for automated system actions (e.g., Margin Call, Algo-liquidation).
    - **Blocks/Freezes:** Immediate notification if account status changes.
    - **Approvals:** KYC/verification status changes.

### 4.3. Admin Dashboard Integration
- **New Tab:** "Communications" (placed before "System Config").
- **Sub-Tabs:**
    - **Compose/Broadcast:** Interface to write and target messages.
    - **Inbox:** View incoming replies (triaged).
    - **Sent/History:** Audit trail of sent communications.
    - **Notification Config:** Settings for automated system alerts.

### 4.4. Client-Side Integration
- **Header:**
    - Notification Icon (Bell) next to the Admin/Profile dropdown.
    - Badge count for unread high-priority notifications.
- **Account Page:**
    - **Minitab:** dedicated "Mailbox" tab inside the Account view (next to existing tabs or as a sub-section).
    - **Visual:** highlighted (e.g., "Blue" indicator) when new messages exist.
    - **Audio:** Simple, low-size, "cute" notification sound for new alerts (configurable on/off).

## 5. Non-Functional Requirements
- **Performance:** Messaging retrieval must not block the main trading thread. Use lazy loading for mailbox content.
- **Persistence:** Messages must be persisted in the database (PostgreSQL).
- **Real-time:** Use WebSockets (existing infrastructure) to push "New Message" signals to online clients.
- **Scalability:** Broadcasting to 10k+ users should be handled via a job queue to avoid API timeouts.
- **Security:** Strict validation that users can only read their own messages and reply only when permitted.

## 6. UI/UX Design

### 6.1. Client Mailbox
- **Layout:** Split view (List of threads on left, Message content on right) or Master-Detail for mobile.
- **States:** Read, Unread, Reply-Locked, Reply-Open.
- **Styling:** Consistent with `TradeScreen.tsx` dark mode aesthetics. Glassmorphism for overlays.

### 6.2. Admin Compose
- **Fields:** To (Search/Select/Group), Subject, Body (Rich Text/Markdown supported), Allow Reply (Toggle).
- **Validation:** Prevent sending empty messages. Confirmation dialog for "Broadcast to All".

## 7. Database Schema Requirements (Concept)
- `mailbox_threads`: Grouping messages.
- `mailbox_messages`: Individual message content.
- `mailbox_participants`: Mapping users to threads (essential for group messages).
- `notifications`: Ephemeral or short-term alerts (distinct from mailbox).

## 8. Deep Context & "Gold Standard" Research
- **MT5 Parity:** The system should mirror the reliability and professional feel of MetaTrader's internal mail. It is not a "chat app" (like WhatsApp) but a "formal communication channel".
- **Triage:** Admins need to easily filter between "System Generated" replies and "Human" replies to prioritize support.

