---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - Documentation/
  - server/
  - client/
  - MOBILE/
  - NATIVE/
  - WEBSITE/
last_verified: 2026-03-29
status: maintained
---

# Migration Waves

## Current State

- parity-first migration is complete enough to archive the numbered folders in one step
- the maintained lanes are the active docs system
- the legacy tree is a frozen archive, not an active navigation surface

## Archive Rule

Every legacy page must have either:

- a maintained replacement target, or
- an explicit archive-only rationale when the page is historical/supporting rather than current truth

## Maintained Coverage Map

| Repo Surface | Maintained Reference |
| --- | --- |
| core runtime and shared contracts | `Documentation/internal/01_Runtime_Topology.md`, `Documentation/generated/REST_API_Catalog.md`, `Documentation/generated/WebSocket_Catalog.md` |
| trader, admin, partner, recruitment flows | `Documentation/internal/02_Trader_Journey.md` through `Documentation/internal/06_Website_and_Education.md` |
| mobile surfaces | `Documentation/internal/07_Mobile_and_Native.md` |
| infra, ops, cluster, analytics | `Documentation/internal/08_Infrastructure_and_Operations.md` |
| support modules, archives, artifacts | `Documentation/internal/09_Repo_Supporting_Modules.md`, `Documentation/generated/Repository_Inventory.md` |

## Legacy Parity Ledger

| Legacy Page | Unique Content Preserved | Stale Claims / Risks | Maintained Target | Archive Rationale |
| --- | --- | --- | --- | --- |
| `Documentation/legacy/00_Getting_Started/00_System_Overview.md` | platform goals, component framing | old mixed overview model | `Documentation/public/01_Platform_Overview.md`, `Documentation/public/02_Surface_Map.md`, `Documentation/internal/01_Runtime_Topology.md` | historical overview kept, current truth promoted |
| `Documentation/legacy/00_Getting_Started/01_Quick_Start.md` | local setup flow | legacy mobile links and older command framing | `Documentation/internal/guides/Local_Quick_Start.md` | archive preserves earlier onboarding narrative |
| `Documentation/legacy/00_Getting_Started/02_Project_Deep_Map.md` | repo-map framing | path counts and old path assumptions | `Documentation/generated/Repository_Inventory.md`, `Documentation/internal/09_Repo_Supporting_Modules.md` | generated whole-repo inventory is now authoritative |
| `Documentation/legacy/00_Getting_Started/03_Environment_Variables.md` | env grouping | stale env narrative risk | `Documentation/generated/Environment_Catalog.md` | source-derived catalog supersedes hand summary |
| `Documentation/legacy/01_Development_Guides/00_Adding_Web_Screen.md` | screen workflow | shallow route guidance | `Documentation/internal/guides/Adding_Web_Screen.md` | maintained guide matches current shells |
| `Documentation/legacy/01_Development_Guides/01_Adding_API_Endpoint.md` | route workflow | old route decomposition model | `Documentation/internal/guides/Adding_API_Endpoint.md` | maintained guide reflects current route architecture |
| `Documentation/legacy/01_Development_Guides/02_Adding_Database_Table.md` | migration workflow | partial schema-domain coverage | `Documentation/internal/guides/Adding_Database_Table.md` | maintained guide now covers all schema domains |
| `Documentation/legacy/01_Development_Guides/03_Adding_Mobile_Feature.md` | wrapper vs native decision | too shallow for current split | `Documentation/internal/guides/Adding_Mobile_Feature.md` | maintained guide absorbs decision model |
| `Documentation/legacy/01_Development_Guides/04_Adding_Observability.md` | observability workflow | stale ops paths | `Documentation/internal/guides/Adding_Observability.md` | maintained guide uses current ops layout |
| `Documentation/legacy/01_Development_Guides/05_Shared_First_Development.md` | shared-first rule | legacy cross-links | `Documentation/internal/guides/Shared_First_Development.md` | current rule preserved in maintained guide |
| `Documentation/legacy/01_Development_Guides/06_Internationalization.md` | i18n workflow | `i18next` drift | `Documentation/internal/guides/Internationalization.md` | maintained guide matches custom provider/store |
| `Documentation/legacy/01_Development_Guides/07_Definition_of_Done.md` | DoD checklist | legacy links | `Documentation/internal/guides/Definition_of_Done.md` | current release-done flow promoted |
| `Documentation/legacy/02_Architecture_Reference/00_System_Overview.md` | architecture framing | older flow description | `Documentation/public/01_Platform_Overview.md`, `Documentation/internal/01_Runtime_Topology.md` | current topology split across public/internal layers |
| `Documentation/legacy/02_Architecture_Reference/01_Client_Frontend.md` | client shell and perf notes | React/version drift and shallow route model | `Documentation/internal/02_Trader_Journey.md`, `Documentation/internal/guides/Adding_Web_Screen.md` | maintained pages now cover client intent |
| `Documentation/legacy/02_Architecture_Reference/02_Server_Backend.md` | route/middleware shape | stale path and background-job claims | `Documentation/internal/01_Runtime_Topology.md` | maintained runtime page carries stable topology |
| `Documentation/legacy/02_Architecture_Reference/03_Database_Layer.md` | schema and migration framing | incomplete domain map | `Documentation/internal/reference/Database_Architecture.md` | maintained reference is deeper and current |
| `Documentation/legacy/02_Architecture_Reference/04_Shared_Contracts.md` | shared-first explanation | legacy links | `Documentation/internal/reference/Shared_Contracts_and_Policy.md` | broader maintained reference supersedes it |
| `Documentation/legacy/02_Architecture_Reference/05_WebSocket_Protocol.md` | socket connection framing | stale message names risk | `Documentation/generated/WebSocket_Catalog.md`, `Documentation/internal/01_Runtime_Topology.md` | generated catalog now owns message inventory |
| `Documentation/legacy/02_Architecture_Reference/06_Background_Jobs.md` | scheduler awareness | stale job paths | `Documentation/generated/Runtime_Inventory.md`, `Documentation/internal/01_Runtime_Topology.md` | source-derived runtime inventory replaces hand list |
| `Documentation/legacy/02_Architecture_Reference/07_Trading_Engine.md` | trading invariants | `orderEngine.ts` intent drift | `Documentation/internal/reference/Trading_Engine.md` | maintained reference corrects engine boundaries |
| `Documentation/legacy/02_Architecture_Reference/08_Website_Module.md` | website isolation intent | old module-level framing | `Documentation/public/03_Public_Website_and_Education.md`, `Documentation/internal/06_Website_and_Education.md` | current website docs cover public and internal views |
| `Documentation/legacy/03_API_Reference/00_REST_Endpoints.md` | endpoint grouping | stale route names | `Documentation/generated/REST_API_Catalog.md` | generated catalog is canonical |
| `Documentation/legacy/03_API_Reference/01_WebSocket_Messages.md` | message grouping | stale WS names | `Documentation/generated/WebSocket_Catalog.md` | generated catalog is canonical |
| `Documentation/legacy/03_API_Reference/02_Policy_Gates.md` | policy-gate explanation | legacy links | `Documentation/internal/reference/Shared_Contracts_and_Policy.md` | maintained policy reference supersedes it |
| `Documentation/legacy/03_API_Reference/03_Admin_API.md` | admin lane grouping | too shallow vs decomposed admin routes | `Documentation/internal/03_Admin_Journey.md` | maintained admin page captures real route groups |
| `Documentation/legacy/03_API_Reference/04_Partner_API.md` | partner endpoint grouping | too shallow vs onboarding/data-room model | `Documentation/internal/04_Partner_Journey.md` | maintained partner page captures current flow |
| `Documentation/legacy/04_Mobile/00_Architecture_Comparison.md` | wrapper vs native comparison | old path assumptions | `Documentation/internal/07_Mobile_and_Native.md`, `Documentation/internal/guides/Adding_Mobile_Feature.md` | maintained docs now carry the decision rule |
| `Documentation/legacy/04_Mobile/01_Capacitor_Guide.md` | wrapper guidance | old path assumptions | `Documentation/internal/07_Mobile_and_Native.md`, `Documentation/internal/guides/Adding_Mobile_Feature.md` | maintained mobile docs supersede it |
| `Documentation/legacy/04_Mobile/02_React_Native_Guide.md` | native guidance | stale React Native theme-path assumptions | `Documentation/internal/07_Mobile_and_Native.md`, `Documentation/internal/guides/Adding_Mobile_Feature.md` | maintained mobile docs supersede it |
| `Documentation/legacy/04_Mobile/03_Signing_Distribution.md` | signing/distribution concerns | legacy credential assumptions | `Documentation/internal/guides/Mobile_Signing_and_Distribution.md` | maintained guide carries current release rule |
| `Documentation/legacy/04_Mobile/04_Push_Notifications.md` | push feature awareness | too shallow for current server/native/wrapper flow | `Documentation/internal/guides/Push_Notifications.md` | maintained guide captures live registration paths |
| `Documentation/legacy/05_Security_Reference/00_Security_Guardrails.md` | security invariants | legacy links | `Documentation/internal/reference/Security_and_Compliance.md` | maintained security reference absorbs it |
| `Documentation/legacy/05_Security_Reference/01_Grift_Engine.md` | grift overview | old architecture summary | `Documentation/internal/reference/Grift_Engine.md` | maintained grift reference is current |
| `Documentation/legacy/05_Security_Reference/02_Legal_Compliance.md` | verification/legal framing | stale endpoint names | `Documentation/internal/reference/Security_and_Compliance.md`, `Documentation/internal/02_Trader_Journey.md` | maintained docs split stable concerns correctly |
| `Documentation/legacy/05_Security_Reference/03_Threat_Model.md` | threat-model framing | legacy cross-links | `Documentation/internal/reference/Security_and_Compliance.md` | maintained reference carries current security posture |
| `Documentation/legacy/05_Security_Reference/04_Production_Requirements.md` | pointer to production requirements ledger | moved archive path risk | `Documentation/internal/reference/Security_and_Compliance.md` | canonical ledger remains `.agents/PRODUCTION_REQUIREMENTS.md` |
| `Documentation/legacy/06_Operations/00_Kubernetes.md` | cluster deploy framing | old simplified ops model | `Documentation/internal/08_Infrastructure_and_Operations.md`, `Documentation/internal/reference/Operational_Runbooks.md` | maintained docs split topology vs runbook |
| `Documentation/legacy/06_Operations/01_Observability.md` | observability stack framing | stale ops paths | `Documentation/internal/08_Infrastructure_and_Operations.md`, `Documentation/internal/guides/Adding_Observability.md` | maintained docs now use live paths |
| `Documentation/legacy/06_Operations/02_Petascale_Analytics.md` | analytics stack awareness | legacy links only | `Documentation/internal/08_Infrastructure_and_Operations.md`, `Documentation/internal/reference/Operational_Runbooks.md` | maintained docs cover current operator boundary |
| `Documentation/legacy/06_Operations/03_Deployment_Runbook.md` | rollout/runbook index | old path assumptions | `Documentation/internal/reference/Operational_Runbooks.md` | canonical runbook files remain in ops/k8s |
| `Documentation/legacy/06_Operations/04_Incident_Response.md` | incident-runbook index | legacy links | `Documentation/internal/reference/Operational_Runbooks.md` | maintained runbook reference supersedes it |
| `Documentation/legacy/06_Operations/05_CI_CD.md` | CI/CD awareness | too shallow vs real infra modules | `Documentation/internal/08_Infrastructure_and_Operations.md` | maintained infra page captures live module boundaries |
| `Documentation/legacy/06_Operations/06_Production_Readiness.md` | readiness checklist | legacy env links | `Documentation/internal/reference/Operational_Runbooks.md`, `Documentation/internal/reference/Security_and_Compliance.md` | maintained references point to canonical readiness material |
| `Documentation/legacy/07_Appendices/00_Audit_Reports_Index.md` | audit archive awareness | legacy links | `Documentation/internal/09_Repo_Supporting_Modules.md` | maintained support-module page now indexes archive role |
| `Documentation/legacy/07_Appendices/01_Reports_Archive.md` | reports archive index | legacy links | `Documentation/internal/09_Repo_Supporting_Modules.md` | maintained support-module page now carries archive purpose |
| `Documentation/legacy/07_Appendices/02_Glossary.md` | glossary terms | legacy-only location | `Documentation/internal/reference/Glossary.md` | maintained glossary now carries current terms |
| `Documentation/legacy/07_Appendices/03_Agent_Guidance_Index.md` | agent guidance inventory | legacy links and outdated placement | `Documentation/generated/Agent_Guidance_Catalog.md` | generated catalog is canonical |
| `Documentation/SUMMARY.md` | top-level navigation | old “migration sources” framing | `Documentation/SUMMARY.md` | summary rewritten for current lanes plus frozen archive |
