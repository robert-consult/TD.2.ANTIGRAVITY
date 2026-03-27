---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - AGENTS.md
  - PROJECT_STRUCTURE.md
  - .agents/deep-context.md
  - server/index.ts
  - server/routes.ts
  - shared/ws/protocol.ts
  - CAPACITOR.md
  - MOBILE/README.md
  - NATIVE/README.md
  - WEBSITE/WIRING.md
  - ops/README.md
  - petascale/README.md
last_verified: 2026-03-27
status: maintained
---

# Canonical Source Map

| Topic | Canonical Source |
| --- | --- |
| Repo mission and operating rules | `AGENTS.md` |
| Tree layout and module map | `PROJECT_STRUCTURE.md` |
| Domain entrypoints | `.agents/deep-context.md` |
| Server runtime startup and roles | `server/index.ts` |
| HTTP mount topology | `server/routes.ts` |
| WebSocket protocol constants | `shared/ws/protocol.ts` |
| WS runtime behavior | `server/routes/wsCore.ts` |
| Client shell routing | `client/src/App.tsx`, `client/src/AuthenticatedShell.tsx` |
| Trader HTTP flow | `server/routes/trader/` |
| Profile and verification flow | `server/routes/profile/`, `server/routes/verification.ts` |
| Legal acceptance | `server/routes/legal.ts`, `server/legal/` |
| Partner flow | `server/routes/partnerPortal.ts`, `client/src/pages/PartnerPortal.tsx` |
| Recruitment and challenges | `server/recruitment/`, `server/routes/traderTalent.ts`, `server/routes/adminScout/` |
| Client i18n | `client/src/i18n/` |
| DB schema | `shared/schema.pg.*.ts` |
| Migrations and audits | `db/`, `scripts/drizzleMigrate.ts`, `scripts/dbAudit.ts` |
| Website runtime | `WEBSITE/README.md`, `WEBSITE/WIRING.md` |
| Capacitor wrapper | `CAPACITOR.md`, `MOBILE/README.md`, `MOBILE/AGENTS.md`, `MOBILE/src/mobile/` |
| React Native app | `NATIVE/README.md`, `NATIVE/AGENTS.md`, `NATIVE/src/` |
| Local infra compose | `docker-compose.infra.yml`, `docker-compose.infra.durable.yml` |
| Cluster manifests and GitOps | `k8s/`, `gitops/`, `ops/README.md` |
| Petascale analytics stack | `petascale/README.md`, `petascale/` |
| Security-local operator material | `security/AGENTS.md`, `security/vuln-db/` |
| Repo support modules and artifacts | `Documentation/generated/Repository_Inventory.md`, `Documentation/internal/09_Repo_Supporting_Modules.md` |
| Historical audits and report archive | `REPORTS AND REVIEWS/`, root audit markdown files |
