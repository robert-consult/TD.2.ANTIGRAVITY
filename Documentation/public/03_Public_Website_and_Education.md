---
audience: public
exposure: public
owner: documentation-program
canonical_sources:
  - WEBSITE/README.md
  - PROJECT_STRUCTURE.md
last_verified: 2026-03-27
status: maintained
---

# Public Website And Education

The public website is a separate module that focuses on:

- product discovery
- education content
- platform-guide material
- external contact and conversion paths

The education experience is structured as:

- education catalog
- module landing pages
- lesson pages
- platform-guide pages

Public-facing boundaries:

- the website runs independently from the authenticated trading app
- cross-domain navigation uses external app URLs rather than shared SPA routing
- website runtime content is generated into `WEBSITE/server/content/generated/` and served by the website module, not the trading runtime
- authenticated trading, compliance, admin controls, and partner workflows remain outside the website surface
