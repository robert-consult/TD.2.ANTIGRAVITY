# Threat Model — TD.2.ANTIGRAVITY Petascale Infrastructure

## Scope
Admin DataTab, export pipelines, ClickHouse OLAP, MinIO artifact storage, BullMQ queues, Valkey cache, and K8s deployment.

## Attack Vector Matrix

| # | Vector | Current Defense | Remaining Gap | Ops Mitigation |
|---|--------|----------------|---------------|----------------|
| 1 | **CSRF** | Double-submit cookie (`server/security/csrf.ts`), enforced on all `/api` mutating requests | WS upgrade path — session validated but no CSRF token | `csrf-coverage-audit.ts` |
| 2 | **XSS** | React auto-escaping, E2EE envelope prevents plaintext injection | CSP headers not verified | Ingress `Content-Security-Policy` annotation |
| 3 | **CSV Injection** | `csvEscape` in export workers | `=+-@` prefix requires verification | `csv-injection-fuzzer.ts` |
| 4 | **SSRF** | No user-controlled URL fetching in export path | MinIO internal endpoint reachable from API pod | NetworkPolicy already isolates (31-network-policies.yaml) |
| 5 | **Data Exfiltration** | Signed URL TTL, `requireAdmin`, per-admin rate limits | Volume-based alerting absent | `SuspiciousExportVolume` Prometheus alert |
| 6 | **DDoS / DoS** | Ingress: 200 RPS, 100 connections | No per-endpoint granularity | `BruteForceLoginAttempts` alert + OVH edge sync |
| 7 | **Brute Force** | Login rate limit IP+email (`loginRateLimit.ts`) | Admin panel endpoint rates | Covered by `adminDataExports.ts` rate limiter |
| 8 | **Replay** | Session tokens with server-side expiry | WS message replay mitigated by session binding | `sessionTrail.ts` audit log |
| 9 | **At-Rest Data** | AES-256-GCM (`crypto.ts`), E2EE for messages | MinIO exports unencrypted server-side | Enable SSE-KMS via KES integration |
| 10 | **In-Transit Data** | TLS forced at ingress (`ssl-redirect: true`) | Internal cluster traffic is plaintext | `RUNBOOK_INTERNAL_TLS.md` |

## Encryption Posture

| Layer | Method | Key Management | Status |
|-------|--------|---------------|--------|
| Client ↔ Ingress | TLS 1.2+ | cert-manager / tradehub-tls secret | ✅ Active |
| App At-Rest (messages) | AES-256-GCM | `ENCRYPTION_KEY` env (32-byte hex) | ✅ Active |
| Client E2EE (mailbox) | Envelope encryption | Per-user keypair in `e2ee.ts` | ✅ Active |
| MinIO At-Rest | SSE-KMS via KES | KES + auto-TLS (`70-petascale-infra.yaml`) | ⚠️ Deployed but not wired to exports |
| ClickHouse At-Rest | Disk-level only | OS/filesystem encryption | ⚠️ No application-layer encryption |
| Valkey In-Transit | Plaintext | N/A | ❌ Needs TLS config |

## CSRF Coverage

The CSRF double-submit pattern in `server/security/csrf.ts` covers:
- All `POST`, `PUT`, `DELETE`, `PATCH` on `/api/*` (enforced in `server/routes.ts:120`)
- Token issued via `GET /api/csrf` and set as `HttpOnly` + `SameSite=Lax` cookie
- Triple validation: session token = cookie token = header token

**WebSocket Exemption:** WS connections validate session auth but bypass CSRF (acceptable for non-state-mutating subscriptions).
