---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - ops/runbooks/
  - k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md
  - PRODUCTION READINESS/
  - ops/README.md
  - petascale/README.md
last_verified: 2026-03-29
status: maintained
---

# Operational Runbooks

## Current Runbook Families

- app/operator incident runbooks in `ops/runbooks/`
- rollout and cutover runbooks in `k8s/`
- broader readiness plans in `PRODUCTION READINESS/`
- analytics/export operator material in `petascale/`

## Key Maintained Pointers

- export pipeline stall response: `ops/runbooks/RUNBOOK_EXPORT_PIPELINE_STALL.md`
- worker canary and API cutover: `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md`
- readiness archive: `PRODUCTION READINESS/00_MASTER_EXECUTION_INDEX.md`

## Documentation Boundary

- maintained docs should point operators to the canonical runbook files
- long command sequences and incident procedures belong in the runbooks themselves
- public docs must never expose these paths or their internal access assumptions
