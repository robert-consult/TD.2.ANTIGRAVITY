---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - WEBSITE/README.md
  - WEBSITE/WIRING.md
  - WEBSITE/client/src/
  - WEBSITE/server/
  - PROJECT_STRUCTURE.md
last_verified: 2026-03-29
status: maintained
---

# Website And Education

The website is a distinct module with separate runtime and content concerns.

## Current Intent

- marketing and discovery
- education catalog, modules, and lessons
- platform-guide content
- contact and conversion entrypoints

## Current Runtime Shape

- browser routes live in `WEBSITE/client/src/App.tsx`
- content APIs live in `WEBSITE/server/routes.ts`
- content generation lives in `WEBSITE/scripts/` and writes website-owned generated payloads into `WEBSITE/server/content/generated/`

## Important Boundaries

- website runtime and content are isolated from the authenticated trading application
- app linking happens through external URLs
- the live source path is `WEBSITE/client/src`
- app-link configuration is centralized in `WEBSITE/client/src/lib/app-config.ts`
- the website can be removed without breaking the authenticated trading app runtime

Use `WEBSITE/README.md` and `WEBSITE/WIRING.md` as the primary module references for this lane.
