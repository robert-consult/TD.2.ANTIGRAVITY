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

### 1. Rebuild the shipped plugin artifact

```bash
npm run build --prefix ops/headlamp-plugin
mkdir -p ops/kubernetes/assets/headlamp-plugin
cp ops/headlamp-plugin/dist/main.js ops/kubernetes/assets/headlamp-plugin/main.js
```

### 2. Deploy to K8s

```bash
./ops/headlamp-plugin/deploy.sh
```

Or use the canonical ops apply path after the asset has been synced:

```bash
kubectl apply -k ops/kubernetes
```

### 3. Access

Navigate to `https://<your-domain>/headlamp` — the TradeHub Ops sidebar
will appear automatically.

## Plugin Architecture

- Bundled with repo-local `esbuild` and runtime shims for Headlamp browser globals
- Registers 8 sidebar entries under "TradeHub Ops" parent
- Queries live K8s resources via `K8s.ResourceClasses.Pod/StatefulSet/Deployment`
- Injects a TradeHub pod health chart into the Headlamp overview page
- All views are **read-only** (enforced by `headlamp-viewer` ClusterRole)

## Files

```
ops/headlamp-plugin/
├── Dockerfile           # Optional custom image build
├── build.mjs            # Bundles src/index.tsx into dist/main.js
├── dist/main.js         # Built plugin artifact
├── package.json         # Plugin build scripts
├── tsconfig.json        # TypeScript config
├── README.md            # This file
└── src/
    └── index.tsx        # Plugin entry point (all components)
```
