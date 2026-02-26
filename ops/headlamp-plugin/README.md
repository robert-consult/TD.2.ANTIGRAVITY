# TradeHub Ops — Headlamp Plugin
#
# Custom Headlamp plugin providing petascale infrastructure monitoring
# dashboards directly inside the Headlamp K8s Web UI.

## Overview

This plugin adds a **TradeHub Ops** sidebar section to Headlamp with the following
monitoring views:

| View | Description |
|---|---|
| **Overview** | Pod/deployment health summary with TileCharts |
| **Infrastructure** | API/Worker/Ingestor pod tables with status, restarts, age |
| **Export Pipeline** | BullMQ worker pods + metric/alert reference table |
| **ClickHouse** | StatefulSet status + OLAP metric reference |
| **MinIO Storage** | StatefulSet status + storage metric reference |
| **Valkey Cache** | Pod status + cache/queue metric reference |
| **Security Events** | Alert rules + security telemetry metric reference |
| **Grafana Links** | Dashboard inventory + runbook links |

## Build & Deploy

### 1. Build the custom Headlamp image

```bash
# From the repo root:
docker build -t tradehub-headlamp:latest -f ops/headlamp-plugin/Dockerfile .
```

### 2. Deploy to K8s

```bash
# Ensure headlamp-viewer SA exists:
kubectl apply -f ops/kubernetes/headlamp-rbac.yaml

# Deploy the custom Headlamp:
kubectl apply -f ops/kubernetes/headlamp-deployment.yaml

# Expose via ingress:
kubectl apply -f ops/kubernetes/headlamp-ingress.yaml
```

### 3. Access

Navigate to `https://<your-domain>/headlamp` — the TradeHub Ops sidebar
will appear automatically.

## Plugin Architecture

- Uses `@kinvolk/headlamp-plugin` SDK
- Registers 8 sidebar entries under "TradeHub Ops" parent
- Queries live K8s resources via `K8s.ResourceClasses.Pod/StatefulSet/Deployment`
- Injects a TradeHub pod health chart into the Headlamp overview page
- All views are **read-only** (enforced by `headlamp-viewer` ClusterRole)

## Files

```
ops/headlamp-plugin/
├── Dockerfile           # Multi-stage build
├── package.json         # Plugin dependencies
├── tsconfig.json        # TypeScript config
├── README.md            # This file
└── src/
    └── index.tsx        # Plugin entry point (all components)
```
