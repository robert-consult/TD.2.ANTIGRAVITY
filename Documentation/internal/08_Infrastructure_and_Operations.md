---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - docker-compose.infra.yml
  - docker-compose.infra.durable.yml
  - k8s/
  - gitops/
  - ops/README.md
  - petascale/README.md
  - PRODUCTION READINESS/
  - ops/prometheus-config/
  - ops/dashboards/
last_verified: 2026-03-29
status: maintained
---

# Infrastructure And Operations

Repo infrastructure and operator material is spread across several top-level modules. It is internal-only.

## Local And Cluster Runtime

- local developer infra comes from `docker-compose.infra.yml` and `docker-compose.infra.durable.yml`
- `k8s/` holds cluster manifests and runtime topology for deployments, monitoring, scaling, and service exposure
- `gitops/` holds GitOps-oriented deployment structure and overlays

## Operator Assets

- `ops/` is the operational boundary for dashboards, alerts, runbooks, chaos tooling, ingress-auth surfaces, and cluster plugins
- Grafana dashboards live in `ops/dashboards/`
- Prometheus config and alerting inputs live in `ops/prometheus-config/`
- Kubernetes operator ingress/manifests live in `ops/kubernetes/`
- `petascale/` is the analytics and export-oriented stack for ClickHouse, MinIO, Prometheus, Grafana, BullMQ, and related vendor sync
- `PRODUCTION READINESS/` contains operator-focused readiness material that should remain internal reference only

## Documentation Boundary

- public docs must not expose internal ops routes, secret handling, ingress auth, or incident response mechanics
- internal docs should link to canonical operator files instead of duplicating long command inventories
- historical operator reports are supporting material, not runtime truth

## Gold-Standard Migration Rule

- maintained internal docs carry the current topology and stable operator intent
- deep execution sequences, incident playbooks, and cutover steps belong in dedicated runbook/reference docs
- legacy operations pages can be archived only after their still-useful instructions are promoted into maintained references

Use [Repository Inventory](../generated/Repository_Inventory.md) to verify where each operator module sits in the repo.
