---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - WEBSITE/README.md
  - WEBSITE/WIRING.md
  - PROJECT_STRUCTURE.md
last_verified: 2026-03-27
status: maintained
---

# Website And Education

The website is a distinct module with separate runtime and content concerns.

Current intent:

- marketing and discovery
- education catalog, modules, and lessons
- platform-guide content
- contact and conversion entrypoints

Important boundaries:

- website runtime and content are isolated from the authenticated trading application
- app linking happens through external URLs
- education payloads are website-owned and generated into website content storage

Use `WEBSITE/README.md` and `WEBSITE/WIRING.md` as the primary module references for this lane.
