# REST Endpoints

> **Diátaxis quadrant:** Reference
> **Sources:** `server/routes.ts`, `server/routes/` directory, `server/routes/AGENTS.md`

---

## Discovery Command

To list all registered API routes from the source:

```bash
rg -n "\.(get|post|patch|put|delete)\(" server/routes.ts server/routes/
```

---

## Public Endpoints (No Auth Required)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/status` | Health check (plaintext `OK`) |
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness probe |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/api/csrf` | CSRF token issuance |
| `POST` | `/api/auth/register` | User registration |
| `POST` | `/api/auth/login` | User login |
| `GET` | `/api/global-settings` | Public global settings (sanitized) |
| `GET` | `/api/instruments` | Available instruments |
| `GET` | `/api/legal/docs` | Legal document metadata |

---

## Authenticated Trader Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auth/current-user` | Current user + session info |
| `POST` | `/api/auth/logout` | Session termination |
| `POST` | `/api/trader/trades/open` | Open a trade |
| `POST` | `/api/trader/trades/:id/close` | Close a trade |
| `GET` | `/api/trader/trades` | Trade list |
| `GET` | `/api/trader/account` | Account state (equity, margin) |
| `GET` | `/api/profile` | User profile (incl. KYC status, policy gates) |
| `GET` | `/api/profile/kyc` | KYC profile (policy-gated: `KYC_VIEW`) |
| `POST` | `/api/profile/kyc/submit` | Submit KYC documents (policy-gated: `KYC_SUBMIT`) |
| `GET` | `/api/profile/payout` | Payout info (policy-gated: `KYC_VIEW`) |
| `POST` | `/api/auth/verify-email` | Email verification token validation |
| `POST` | `/api/auth/resend-verification` | Resend verification email |
| `POST` | `/api/legal/accept` | Accept legal documents (HMAC-signed) |
| `GET` | `/api/legal/status` | Legal acceptance status |
| `GET` | `/api/mailbox/messages` | E2EE mailbox messages |
| `POST` | `/api/mailbox/messages` | Send E2EE message |
| `GET` | `/api/notifications` | User notifications |
| `PATCH` | `/api/notifications/settings` | Notification preferences |
| `GET` | `/api/trader/challenges` | Available challenges |

---

## Admin Endpoints (Require `requireAdmin`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/global-settings` | Full settings (with perf controls) |
| `PUT` | `/api/admin/global-settings` | Update settings |
| `GET` | `/api/admin/users` | User management |
| `GET` | `/api/admin/audit` | Audit trail |
| `GET` | `/api/admin/data-exports` | Export pipeline |

> For the full admin API surface, see [Admin API →](03_Admin_API.md).

---

## Partner Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/partner/invite/redeem` | Redeem partner invite |
| `GET` | `/api/partner/tear-sheet/:hashId` | Partner tear sheet |
| `GET` | `/api/partner/data-room` | Partner data room |

> For the full partner API, see [Partner API →](04_Partner_API.md).

---

## CSRF Enforcement

All session-scoped non-safe HTTP requests to `/api/*` must include `x-csrf-token` header, matching the `XSRF-TOKEN` cookie. Bootstrap via `GET /api/csrf`.

---

## Related Pages

- [WebSocket Messages →](01_WebSocket_Messages.md)
- [Server Backend →](../02_Architecture_Reference/02_Server_Backend.md)
