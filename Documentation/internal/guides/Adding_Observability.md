---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - server/routes/wsCore.ts
  - server/observability/
  - ops/dashboards/
  - ops/prometheus-config/
  - ops/runbooks/
  - ops/kubernetes/
last_verified: 2026-03-30
status: maintained
---

# Adding Observability

## Current Stack

- metrics are exposed from the app runtime at `/metrics`
- HTTP and business-flow observability live under `server/observability/`
- dashboards live in `ops/dashboards/`
- Prometheus config and alerting inputs live in `ops/prometheus-config/`
- operator runbooks live in `ops/runbooks/`

## Workflow

1. add or extend the metric in the owning server/runtime module
2. update dashboard JSON in `ops/dashboards/` when the metric is operationally important
3. update alerting or scrape config under `ops/prometheus-config/` if required
4. add or update a runbook in `ops/runbooks/` when the metric maps to an operational response

## Repo-Specific Layout

- Grafana provisioning is under `ops/grafana-config/`
- Prometheus assets are under `ops/prometheus-config/`

## Repo-Grounded Example

```ts
// Excerpt from the current trader route observability pattern.
const startedAtMs = Date.now();
recordBusinessFlowStep({ flow: "trade_lifecycle", step: "open", outcome: "attempt" });

if (!Number.isInteger(userId) || userId <= 0) {
  recordOperationFailure({
    operation: "trade.open",
    reason: "not_authenticated",
    flow: "trade_lifecycle",
    step: "open",
    startedAtMs,
  });
  return res.status(401).json({ message: "Not authenticated" });
}
```

```ts
// Excerpt from the shared background-job instrumentation contract.
await withObservedBackgroundJob({
  job: "grift.periodic_evaluation",
  fn: () => runPeriodicEvaluation(),
});
```

The first pattern matches the current trade routes in `server/routes/trader/`; the second matches the shared background-job instrumentation contract in `server/observability/business.ts`.

## Verification

- `npm run check`
- `npm run build`
- if the metric affects operator workflow, verify the corresponding dashboard/runbook path exists
