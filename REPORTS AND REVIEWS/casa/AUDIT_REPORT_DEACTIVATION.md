# Account Deactivation & Deletion System Audit

## Executive Summary
This report analyzes the current implementation of Account Deactivation and Deletion features in the TradeQuip platform. The audit focuses on the technical implementation, data retention implications, and user privacy ("Stealth") considerations.

## System Overview

The system implements a "Soft Delete" strategy for both deactivation and deletion. No data is physically removed from the database during these actions.

### Deactivation (`/api/profile/account/deactivate`)
- **Mechanism**: Sets `isDisabled = true` on the user record.
- **Effect**:
  - Immediate logout and session revocation.
  - Login blocked via `user.isDisabled` check.
  - Hidden from Leaderboard (`showOnLeaderboard: false`).
- **Reversibility**: Reversible by administrative action (flipping `isDisabled` to false).

### Deletion (`/api/profile/account/delete`)
- **Mechanism**: Sets `isDisabled = true`, `isDeleted = true`, and records timestamps/reasons.
- **Effect**:
  - Immediate logout and session revocation.
  - Login blocked via `user.isDeleted` check (returns "Account deleted" error).
  - Hidden from Leaderboard.
- **Data Retention**:
  - **User Record**: Linkages to trades, orders, and positions are preserved.
  - **PII**: Name, Email, Phone, and IP addresses remain in the database.
  - **Uniqueness**: `email` and `username` unique constraints remain active.

## Identified Gaps & Findings

### 1. PII Retention & "Right to be Forgotten"
**Gap**: The current "Delete" function is a permanent soft-ban. It does not anonymize or scrub Personally Identifiable Information (PII).
- **Impact**: User data (Email, Name, Phone) persists indefinitely. This may conflict with GDPR/CCPA requirements which typically mandate PII deletion or anonymization upon request, separate from financial transaction retention.
- **Recommendation**: Implement a scheduled job to scrub PII from the `users` table for deleted accounts after a mandatory retention period (e.g., 30-90 days or 5-7 years depending on jurisdiction), while keeping the `id` for trade integrity.

### 2. Re-registration Friction
**Gap**: Because the user row persists, the `email` and `username` remain "taken".
- **Impact**: A user who deletes their account cannot sign up again with the same email address without Support intervention.
- **Recommendation**: If "Delete" is intended to allow a fresh start, the email should be freed (or the old account heavily archived/renamed). If "Delete" is intended to prevent platform abuse, the current behavior is correct.

### 3. "Stealth" & Messaging
**Observation**: The current UI copy ("retaining data for audit") is accurate but perceived as harsh or "big brother"-like.
- **Update**: The messaging will be updated to focus on regulatory compliance rather than surveillance.

### 4. Reactivation Path
**Gap**: There is no self-service reactivation for "Deactivated" accounts.
- **Impact**: Any "taking a break" user must contact support to return.

## Implementation Plan
1.  **UI Update**: Update the Profile Settings card to use customer-friendly "Stealth" messaging.
2.  **Report Delivery**: Deliver this audit finding to the engineering team for roadmap consideration regarding PII scrubbing.
