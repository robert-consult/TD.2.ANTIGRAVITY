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
| Web application | Traders, admins, partners | Browser |
| Public website | Prospects, learners, evaluators | Browser |
| Capacitor wrapper | Mobile users who need the web app in a native shell | Android and iOS wrapper |
| React Native app | Mobile users who need native UI and device-level integration | Android and iOS native app |

The public website is intentionally isolated from the authenticated trading application. It can link into the app, but it does not share runtime state or authenticated UI with it.
