---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/recruitment/
  - server/routes/traderTalent.ts
  - server/routes/adminScout/
  - client/src/components/admin/ScoutWorkbench.tsx
  - shared/challenges/systemConfig.ts
last_verified: 2026-03-27
status: maintained
---

# Challenges And Recruitment

TradeQuip includes a challenges and recruitment ecosystem that cuts across trader, admin, and partner flows.

Key concerns:

- challenge discovery and enrollment
- progression, badges, rewards, and certificates
- scouting and candidate pipelines
- challenge evaluation and admin overrides
- challenge-linked policy and eligibility checks

Ownership boundaries:

- trader-facing challenge routes live in `server/routes/traderTalent.ts`
- admin challenge and scouting controls live under `server/routes/adminScout/` and `server/routes/adminTraderScouting.ts`
- recruitment logic spans `server/recruitment/`
- shared challenge config and contracts live in `shared/challenges/`
