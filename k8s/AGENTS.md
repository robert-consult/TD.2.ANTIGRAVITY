# `k8s/` AGENTS.md (Kubernetes / Ops)

## What this area is
Kubernetes manifests for tradehub services (API, ingestor, worker) and supporting infra.

## Non-negotiables
- Resource requests/limits must be set and justified (avoid overprovisioning; avoid throttling hot paths).
- Probes must remain fast and safe (`/`, `/health`, `/ready` in `server/index.ts`).
- Secrets must come from Kubernetes secrets or external secret manager—never from git.
- Monitoring must stay functional (Prometheus scrapes `/metrics`).

## Key manifests
- Namespace/config/secrets: `00-namespace.yaml`, `01-configmap.yaml`, `02-secrets.yaml`
- Postgres/Valkey: `03-postgres.yaml`, `05-valkey.yaml`
- API/worker/ingestor: `10-api-deployment.yaml`, `11-ingestor-deployment.yaml`, `12-worker-deployment.yaml`
- HPA + custom metrics: `40-hpa.yaml`, `60-monitoring.yaml` (scrapes `/metrics`, adapter exposes `ws_active_connections`)

## Required checks before finalizing
- Validate manifests (at minimum): `kubectl apply --dry-run=client -f k8s/`
- If changing probes/ports: confirm they match `server/index.ts` and `server/routes.ts`

