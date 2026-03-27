---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - Documentation/
last_verified: 2026-03-27
status: maintained
---

# Migration Waves

## Wave 1

- stand up public, internal, generated, and enhancement lanes
- add automation and validation
- fix high-risk factual drift in new maintained docs

## Wave 2

- replace legacy high-drift references with maintained internal equivalents
- expand generated inventories as needed
- continue aligning root/module source docs
- make top-level repo coverage explicit so support modules, archives, and artifacts are not omitted

## Maintained Coverage Map

| Repo Surface | Maintained Reference |
| --- | --- |
| core runtime and shared contracts | `Documentation/internal/01_Runtime_Topology.md`, `Documentation/generated/REST_API_Catalog.md`, `Documentation/generated/WebSocket_Catalog.md` |
| trader, admin, partner, recruitment flows | `Documentation/internal/02_Trader_Journey.md` through `Documentation/internal/06_Website_and_Education.md` |
| mobile surfaces | `Documentation/internal/07_Mobile_and_Native.md` |
| infra, ops, cluster, analytics | `Documentation/internal/08_Infrastructure_and_Operations.md` |
| support modules, archives, artifacts | `Documentation/internal/09_Repo_Supporting_Modules.md`, `Documentation/generated/Repository_Inventory.md` |

## Legacy Page Matrix

| Legacy Page | Disposition |
| --- | --- |
| `Documentation/00_Getting_Started/00_System_Overview.md` | split |
| `Documentation/00_Getting_Started/01_Quick_Start.md` | rewrite |
| `Documentation/00_Getting_Started/02_Project_Deep_Map.md` | replace-with-generated |
| `Documentation/00_Getting_Started/03_Environment_Variables.md` | replace-with-generated |
| `Documentation/01_Development_Guides/00_Adding_Web_Screen.md` | rewrite |
| `Documentation/01_Development_Guides/01_Adding_API_Endpoint.md` | rewrite |
| `Documentation/01_Development_Guides/02_Adding_Database_Table.md` | rewrite |
| `Documentation/01_Development_Guides/03_Adding_Mobile_Feature.md` | rewrite |
| `Documentation/01_Development_Guides/04_Adding_Observability.md` | rewrite |
| `Documentation/01_Development_Guides/05_Shared_First_Development.md` | keep |
| `Documentation/01_Development_Guides/06_Internationalization.md` | rewrite |
| `Documentation/01_Development_Guides/07_Definition_of_Done.md` | keep |
| `Documentation/02_Architecture_Reference/00_System_Overview.md` | split |
| `Documentation/02_Architecture_Reference/01_Client_Frontend.md` | rewrite |
| `Documentation/02_Architecture_Reference/02_Server_Backend.md` | rewrite |
| `Documentation/02_Architecture_Reference/03_Database_Layer.md` | rewrite |
| `Documentation/02_Architecture_Reference/04_Shared_Contracts.md` | keep |
| `Documentation/02_Architecture_Reference/05_WebSocket_Protocol.md` | replace-with-generated |
| `Documentation/02_Architecture_Reference/06_Background_Jobs.md` | replace-with-generated |
| `Documentation/02_Architecture_Reference/07_Trading_Engine.md` | rewrite |
| `Documentation/02_Architecture_Reference/08_Website_Module.md` | split |
| `Documentation/03_API_Reference/00_REST_Endpoints.md` | replace-with-generated |
| `Documentation/03_API_Reference/01_WebSocket_Messages.md` | replace-with-generated |
| `Documentation/03_API_Reference/02_Policy_Gates.md` | keep |
| `Documentation/03_API_Reference/03_Admin_API.md` | rewrite |
| `Documentation/03_API_Reference/04_Partner_API.md` | rewrite |
| `Documentation/04_Mobile/00_Architecture_Comparison.md` | rewrite |
| `Documentation/04_Mobile/01_Capacitor_Guide.md` | rewrite |
| `Documentation/04_Mobile/02_React_Native_Guide.md` | rewrite |
| `Documentation/04_Mobile/03_Signing_Distribution.md` | keep |
| `Documentation/04_Mobile/04_Push_Notifications.md` | keep |
| `Documentation/05_Security_Reference/00_Security_Guardrails.md` | keep |
| `Documentation/05_Security_Reference/01_Grift_Engine.md` | rewrite |
| `Documentation/05_Security_Reference/02_Legal_Compliance.md` | rewrite |
| `Documentation/05_Security_Reference/03_Threat_Model.md` | keep |
| `Documentation/05_Security_Reference/04_Production_Requirements.md` | keep |
| `Documentation/06_Operations/00_Kubernetes.md` | rewrite |
| `Documentation/06_Operations/01_Observability.md` | rewrite |
| `Documentation/06_Operations/02_Petascale_Analytics.md` | keep |
| `Documentation/06_Operations/03_Deployment_Runbook.md` | keep |
| `Documentation/06_Operations/04_Incident_Response.md` | keep |
| `Documentation/06_Operations/05_CI_CD.md` | rewrite |
| `Documentation/06_Operations/06_Production_Readiness.md` | keep |
| `Documentation/07_Appendices/00_Audit_Reports_Index.md` | keep |
| `Documentation/07_Appendices/01_Reports_Archive.md` | keep |
| `Documentation/07_Appendices/02_Glossary.md` | keep |
| `Documentation/07_Appendices/03_Agent_Guidance_Index.md` | replace-with-generated |
| `Documentation/SUMMARY.md` | rewrite |
