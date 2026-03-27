---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - client/src/pages/PartnerPortal.tsx
  - server/routes/partnerPortal.ts
  - shared/partnerProfile.ts
last_verified: 2026-03-27
status: maintained
---

# Partner Journey

The partner surface is its own product lane with onboarding gates and partner-specific controls.

Current journey stages:

1. invite redemption through `/api/partner/invite/redeem`
2. onboarding and institution profile completion
3. gate evaluation for data-room and allocation actions
4. data-room and tear-sheet exploration
5. inquiry routing and E2EE-backed messaging workflows

Important implementation boundaries:

- partner auth and partner portal routes currently live together in `server/routes/partnerPortal.ts`
- the main UI lives in `client/src/pages/PartnerPortal.tsx`
- partner profile contracts live in `shared/partnerProfile.ts`
- partner controls are not a thin extension of trader or admin UI; they have separate gating and data models
