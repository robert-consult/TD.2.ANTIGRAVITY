---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/routes.ts
  - server/routes/wsCore.ts
  - client/src/i18n/I18nProvider.tsx
  - server/engine/orderEngine.ts
  - server/routes/trader/
  - ops/
last_verified: 2026-03-27
status: maintained
---

# Drift And Gap Register

## Confirmed Drift

| Area | Drift | Current Truth |
| --- | --- | --- |
| Tech versions | Multiple docs said React 18 | Repo packages are on React 19 |
| REST paths | Several docs named `/api/profile`, `/api/legal/accept`, `/api/legal/status`, `/api/auth/verify-email`, `/api/trader/trades/open` | Current live paths include `/api/profile/me`, `/api/legal/doc1/accept`, `/api/legal/doc1/resolve`, `/api/verification/email/send`, `POST /api/trades` |
| WS protocol | Docs used `subscribe` and `unsubscribe` | Canonical types are `auth:hello`, `quotes:subscribe`, `trades:subscribe`, `account:subscribe`, `notifications:updated`, `quote-subscriptions:updated`, `legal:doc1-updated` |
| Client i18n | Docs described `i18next` | Client uses a custom `I18nProvider` and bundle store |
| Trading engine intent | Docs implied `orderEngine.ts` is the manual HTTP trade executor | Manual open and close handlers live in `server/routes/trader/`; `orderEngine.ts` processes pending orders and SL/TP |
| Background jobs | Docs referenced stale service paths | Current runtime uses `server/cron/` and other live files discovered from `server/index.ts` |
| Observability paths | Docs referenced the stale paths ops/grafana/provisioning/dashboards and ops/prometheus/rules | Current tree uses `ops/grafana-config/provisioning/...` and `ops/dashboards/...` |

## Structural Gaps

- no enforced distinction between public and internal docs
- no generated catalogs for routes, WS, env, or runtime inventory
- no validation for stale paths or invalid commands
- internal docs did not mirror the actual trader, admin, partner, and recruitment flows
