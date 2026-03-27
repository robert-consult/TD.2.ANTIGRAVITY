# TD.2.ANTIGRAVITY Petascale Ops Engine

This `ops/` directory acts as the strict operational boundary for the Petascale Infrastructure deployments on OVH Bare Metal. 
It strictly segregates Observability (Dashboards/Alerts), Chaos Engineering, Security Fuzzing, and Incident Response playbooks from the core application source code.

## Sub-Modules

### `/alerts`
Prometheus `Rule` files. Defines the mathematical boundaries for when the on-call engineer should be paged (e.g., Export Pipeline starvation, ClickHouse lag, Queue backup).

### `/chaos`
Active synthetic workload generators and cluster disruption scripts. Used during pre-flight certification drills to prove resiliency under billion-row loads, connection storms, and pod termination events.

### `/dashboards`
Hard-coded, version-controlled Grafana JSON models capturing System Health, ClickHouse Saturation, and Export Pipeline telemetry.

### `/runbooks`
Actionable Incident Response guides indexed directly to the alerts fired by `petascale-alerts.yaml`. Detailed with strict CLI/Kubectl commands relative to this specific application.

### `/security`
Stand-alone scripts, fuzzers, and templates used for neutralizing injection vectors and managing Zero-Trust secrets architectures dynamically.

---
*No business logic, API mappings, or React components should ever be imported into this tree path.*

## Deployment helpers (optional)
- Grafana dashboards: `./ops/deploy-grafana.sh`
- Prometheus OPS alert rules: `./ops/deploy-prometheus-alerts.sh`

## Canonical Kubernetes Apply Path
- Source of truth for ops resources: `ops/kubernetes/`
- Canonical apply command: `kubectl apply -k ops/kubernetes`
- Optional internal-TLS bundle (requires cert-manager CRDs): `kubectl apply -f ops/kubernetes/75-internal-tls.yaml`

### Pre-apply prerequisites
- `kubectl apply -k ops/kubernetes` generates the dashboard, MinIO monitor, and Headlamp plugin ConfigMaps automatically.
- If `ops/headlamp-plugin/src/index.tsx` changed, rebuild and sync the shipped plugin asset before `kubectl apply -k ops/kubernetes`:
  - `npm run build --prefix ops/headlamp-plugin`
  - `mkdir -p ops/kubernetes/assets/headlamp-plugin`
  - `cp ops/headlamp-plugin/dist/main.js ops/kubernetes/assets/headlamp-plugin/main.js`
- The manual `kubectl create configmap ...` steps are only needed if you bypass the canonical kustomize apply path and apply individual manifests by hand.

### Auth-gated admin surfaces
- Grafana ingress uses app-session auth:
  - `ops/kubernetes/grafana-ingress.yaml` -> `resource=grafana` (`admin`, `superadmin`)
- Prometheus ingress uses app-session auth:
  - `ops/kubernetes/prometheus-ingress.yaml` -> `resource=prometheus` (`superadmin`)
- Headlamp ingress uses app-session auth:
  - `ops/kubernetes/headlamp-ingress.yaml` -> `resource=headlamp` (`superadmin`)
- Bull-board ingress uses app-session auth:
  - `ops/kubernetes/bull-board-ingress.yaml` -> `resource=bullboard` (`superadmin`)
- MinIO monitor ingress uses app-session auth:
  - `ops/kubernetes/minio-monitor-deployment.yaml` -> `resource=minio-monitor` (`superadmin`)
- Auth backend endpoint:
  - `GET /api/admin/ops/ingress-auth?resource=<grafana|prometheus|headlamp|bullboard|minio-monitor>`

### Canonical operator paths
- Grafana (`admin`, `superadmin`): `/grafana`
- Prometheus (`superadmin`): `/prometheus`
- Headlamp (`superadmin`): `/headlamp`
- MinIO monitor (`superadmin`): `/minio-monitor`
- Bull Board (`superadmin`): `/api/admin/data-exports/queues`

### Local fallback access
- Grafana: `kubectl port-forward -n tradehub svc/tradehub-grafana 3000:3000` then open `http://127.0.0.1:3000/grafana`
- Prometheus: `kubectl port-forward -n tradehub svc/tradehub-prometheus 9090:9090` then open `http://127.0.0.1:9090/`
- Headlamp: `kubectl port-forward -n tradehub svc/tradehub-headlamp 4466:4466` then open `http://127.0.0.1:4466/`
