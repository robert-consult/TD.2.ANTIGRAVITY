---
audience: public
exposure: public
owner: documentation-program
canonical_sources:
  - README.md
  - PROJECT_STRUCTURE.md
  - WEBSITE/README.md
last_verified: 2026-03-27
status: maintained
---

# Surface Map

TradeQuip currently exposes four primary product surfaces.

| Surface | Audience | Delivery |
| --- | --- | --- |
| Authenticated web application | Traders, admins, partners | Browser |
| Public website | Prospects, learners, evaluators | Browser |
| Capacitor wrapper | Mobile users who need the authenticated web app in a native shell | Android and iOS wrapper |
| React Native app | Mobile users who need native UI and device-level integration | Android and iOS native app |

Boundary notes:

- the authenticated app is the primary trading, compliance, admin, and partner runtime
- the public website is intentionally isolated from the authenticated trading application; it links into the app through external URLs and does not share runtime state
- the wrapper preserves browser-style session, CSRF, and `/ws` behavior by keeping the app same-origin with the server
- the native app is not a copy of `client/`; it is a separate UI surface that reuses transport and policy contracts
