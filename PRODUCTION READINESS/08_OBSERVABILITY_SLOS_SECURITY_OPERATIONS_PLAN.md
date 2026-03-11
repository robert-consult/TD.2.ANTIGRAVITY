# Observability, SLOs, And Security Operations Plan

Last updated: 2026-03-09

## Repo Surfaces Already Present

- `/metrics` exposure and transport metrics in server runtime
- Prometheus manifests in `k8s/60-monitoring.yaml`
- Grafana deployment and provisioning in `ops/kubernetes/`
- dashboard assets now vendored into `ops/kubernetes/assets/`
- existing runbooks under `ops/runbooks/`
- DDoS response runbook already exists

## What Was Added In This Task

- GitOps-renderable ops overlays
- Grafana admin placeholder secret manifests
- nightly security workflow
- release image scanning workflow

## Day-One Dashboards To Use

Use the existing dashboard pack for:

- overall ops overview
- bare-metal health
- Kubernetes health
- MinIO storage
- ClickHouse analytics
- security events
- cache/session health
- app RED metrics

## SLOs To Track

Initial recommended SLOs:

- API:
  - 99.9% successful availability for critical auth and trader APIs
- WebSocket:
  - sustained connection health with low reconnect churn
- quote freshness:
  - stale quote windows within configured threshold for active markets
- admin export queue:
  - no long-running backlog growth without alert
- ClickHouse sync:
  - no extended staleness beyond configured sync window

## Metrics Exposure Policy

Target policy:

- keep `/metrics` private-only by default
- use `METRICS_AUTH_TOKEN` only if an external collector truly needs it

Current repo posture:

- `METRICS_REQUIRE_PRIVATE=true` is set in Kubernetes config

## Security Operations Controls

### Supply chain

Implemented:

- nightly `npm audit`
- nightly Trivy repo scan
- release image scan
- SBOM generation and image signing

### Secret hygiene

Implemented:

- generated secret files are gitignored
- SOPS template exists

Still required:

- real secret encryption with SOPS
- Argo CD decryption path

### Transport security

Implemented:

- external TLS is assumed in ingress config
- internal TLS scaffolding exists

Not yet complete:

- end-to-end internal TLS enforcement
- CA trust wiring for app-to-service traffic

## Incident Runbooks To Keep Active

- `ops/runbooks/RUNBOOK_DDOS_DOS_RESPONSE.md`
- `ops/runbooks/RUNBOOK_INTERNAL_TLS.md`
- `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md`

## Remaining Gaps

- alertmanager receiver routing is not configured here
- no evidence of operational alert tuning yet
- internal TLS is not yet a fully enforced state
