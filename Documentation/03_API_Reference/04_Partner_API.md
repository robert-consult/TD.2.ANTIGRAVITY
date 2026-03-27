# Partner Portal API

> **Diátaxis quadrant:** Reference
> **Sources:** `server/routes/partnerPortal.ts`

---

## Overview

The partner portal provides white-label partner functionality with E2EE inquiry submission, data room access, and tear-sheet analytics.

---

## Key Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/partner/invite/redeem` | Public (rate-limited) | Redeem partner invite token |
| `GET` | `/api/partner/data-room` | Partner auth | Partner data room |
| `GET` | `/api/partner/tear-sheet/:hashId` | Partner auth | Cached tear-sheet analytics |
| `POST` | `/api/partner/inquiries` | Partner auth (E2EE required) | Submit encrypted inquiry |
| `GET` | `/api/partner/inquiries/recipients` | Partner auth | Inquiry recipient key status |

---

## Transport Security

- All `/api/partner/*` traffic must use HTTPS in production (loopback exception for dev)
- Partner invite redemption is rate-limited per IP/token
- Inquiry submissions require valid E2EE envelope payloads

---

## Related Pages

- [REST Endpoints →](00_REST_Endpoints.md)
- [Security Guardrails →](../05_Security_Reference/00_Security_Guardrails.md)
