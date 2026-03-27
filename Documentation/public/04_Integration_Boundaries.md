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

# Integration Boundaries

External-facing documentation should assume these boundaries:

- the trading platform exposes HTTP APIs and a WebSocket endpoint for live updates
- session-aware mutations require CSRF handling on trusted client surfaces
- the public website is not the trading runtime
- mobile surfaces share backend contracts, but not the same UI implementation

Public docs should describe capabilities and expectations, not internal deployment, security, or operator mechanics.
