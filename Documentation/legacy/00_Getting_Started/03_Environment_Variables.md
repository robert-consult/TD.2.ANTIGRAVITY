# Environment Variables

> **Diátaxis quadrant:** Reference
> **Sources:** `.env.example`, `server/index.ts` `validateEnvVars()`, `.agents/PRODUCTION_REQUIREMENTS.md`

---

## Critical Secrets (Startup will abort if missing)

| Variable | Validation | Generation | Failure Mode |
|---|---|---|---|
| `SESSION_SECRET` | ≥ 32 chars | `openssl rand -hex 32` | Session cookies cannot be signed |
| `LEGAL_TERMS_HMAC_SECRET` | ≥ 32 chars | `openssl rand -hex 32` | Legal compliance tokens untrusted |
| `ENCRYPTION_KEY` | Exactly 64 hex chars (32 bytes) | `openssl rand -hex 32` | At-rest encryption for mailbox/inquiries fails |
| `EMAIL_VERIFY_TOKEN_SECRET` | ≥ 32 chars (required in prod) | `openssl rand -hex 32` | Email verification token hashing unkeyed |
| `COOKIE_SAMESITE` | Must NOT be `none` | Use `lax` or `strict` | CSRF protection collapses |

---

## Database & Infrastructure

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DB_DIALECT` | `postgresql` | Database dialect |
| `VALKEY_URL` | — | Valkey (Redis) connection for sessions + quote cache |

---

## Authentication & Verification

| Variable | Purpose | Notes |
|---|---|---|
| `RESEND_API_KEY` | Email verification via Resend | Warning if missing |
| `TWILIO_ACCOUNT_SID` | SMS verification | Warning if missing |
| `TWILIO_AUTH_TOKEN` | SMS verification auth | Warning if missing |
| `TWILIO_MESSAGING_SERVICE_SID` | SMS sender (preferred) | Either this or `TWILIO_FROM_NUMBER` |
| `TWILIO_FROM_NUMBER` | SMS sender (fallback) | Either this or messaging service |
| `SMS_OTP_SECRET` | HMAC-based OTP hashing | Falls back to `TWILIO_AUTH_TOKEN` |

---

## Market Data

| Variable | Purpose |
|---|---|
| `TWELVE_DATA_API_KEY` | Twelve Data provider |
| `FORGE_KEY` | 1Forge provider (legacy) |
| `MARKET_DATA_PROVIDER_FILE_SYNC` | Set to `1` to sync provider configs from `config/marketdata/` |

---

## Challenge System

| Variable | Purpose |
|---|---|
| `CHALLENGE_CERT_VERIFICATION_SECRET` | HMAC for certificate verification codes (≥ 32 chars) |

---

## Server Runtime

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode |
| `APP_ROLE` | `monolith` | Process role: `monolith`, `api`, `worker`, `ingestor`, or comma-separated |
| `SERVER_REUSE_PORT` | `0` | Set `1` in production for `SO_REUSEPORT` |
| `E2E_DISABLE_BACKGROUND_JOBS` | `0` | Set `1` to disable schedulers during E2E testing |
| `LOG_API_BODIES` | `0` | Set `1` in development to log API response bodies |

---

## Transport Security

| Variable | Default | Purpose |
|---|---|---|
| `TRANSPORT_HEADERS_ENABLED` | `true` | Enable security headers |
| `TRANSPORT_REQUIRE_TLS` | `true` in prod | Reject non-HTTPS API calls |
| `TRANSPORT_HSTS_ENABLED` | `true` in prod | Enable HSTS header |
| `TRANSPORT_HSTS_MAX_AGE_SEC` | `31536000` | HSTS max-age (300–63072000) |
| `TRANSPORT_HSTS_INCLUDE_SUBDOMAINS` | `true` | Include subdomains in HSTS |
| `TRANSPORT_HSTS_PRELOAD` | `true` | HSTS preload flag |
| `COOKIE_SECURE` | `true` in prod | Secure cookie flag |

---

## WebSocket Controls

| Variable | Default | Purpose |
|---|---|---|
| `WS_MAX_CONNECTIONS_PER_USER` | — | Per-user concurrent WS connection cap |
| `WS_MESSAGE_RATE_LIMIT` | — | Max messages per window |
| `WS_MESSAGE_RATE_WINDOW_MS` | — | Rate limit window |
| `WS_MAX_MESSAGE_BYTES` | — | Max inbound payload size |

---

## Related Pages

- [Quick Start →](01_Quick_Start.md)
- [Security Guardrails →](../05_Security_Reference/00_Security_Guardrails.md)
- [Production Requirements Ledger →](../05_Security_Reference/04_Production_Requirements.md)
