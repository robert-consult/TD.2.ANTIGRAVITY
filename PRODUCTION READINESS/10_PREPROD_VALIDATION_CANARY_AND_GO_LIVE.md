# Preprod Validation, Canary, And Go-Live

Last updated: 2026-03-09

## Objective

This is the final execution checklist for moving from repo readiness to live production cutover.

## Phase 1: Local And Repo Validation

Required:

- `npm run check`
- `npm run build`
- targeted `vitest` suite used in CI
- `kubectl kustomize` render for app, ops, and Argo CD paths

Current status:

- completed in this task

Limitation:

- `kubectl apply --dry-run=client` could not be fully verified in this sandbox because `kubectl` attempted API discovery against `127.0.0.1:6443`

## Phase 2: Operator Workstation Bootstrap

Run:

- `npm run ops:toolchain-check`
- install missing tools
- `npm run ops:secrets:generate`
- `npm run ops:sops:bootstrap`

Exit criteria:

- required CLIs installed
- age key created and secured
- overlay secrets updated and encrypted

## Phase 3: GitHub Configuration

Required:

- Actions enabled
- branch protection set
- GHCR publish path confirmed
- environments created
- reviewers/approvers assigned

## Phase 4: OVH Cluster Bring-up

Required:

- RKE2 cluster healthy
- ingress-nginx healthy
- cert-manager healthy
- Longhorn default storage class healthy
- Argo CD healthy

## Phase 5: Staging Deployment

1. Merge repo changes.
2. Run `Release Build`.
3. Run `Promote Overlay` for `staging`.
4. Allow Argo CD to sync staging app and ops stacks.
5. Confirm pods are healthy.
6. Confirm Postgres/Valkey/MinIO/ClickHouse PVCs bind.
7. Confirm ingress and TLS resolve.
8. Confirm Twelve Data provider test passes.

## Phase 6: Staging Acceptance

Required checks:

- admin login
- trader login
- `/metrics` scrape internal success
- quote feed freshness
- admin export queue sanity
- ClickHouse sync freshness
- MinIO export path sanity
- Grafana dashboards reachable

## Phase 7: Backup And Restore Gate

Before any production promotion:

- successful backup run for all stateful systems
- at least one Postgres restore drill
- at least one MinIO restore drill

## Phase 8: Production Promotion

1. Promote prod overlay image via PR.
2. Merge only after staging sign-off.
3. Sync Argo CD prod apps.
4. Start worker canary path using the existing runbook and scripts:
   - `k8s/RUNBOOK_WORKER_CANARY_API_CUTOVER.md`
   - `scripts/ops/canary_cutover_runbook.sh`
5. Observe metrics and dashboards.
6. If healthy, continue to full production release.

## Phase 9: Rollback

Use the fastest safe rollback path:

1. revert overlay PR or promote prior image tag
2. allow Argo CD to sync previous version
3. if needed, use Argo rollback to prior revision
4. confirm queues, quote freshness, and login health recover

## Hard Go-Live Blockers

Do not go live until all are true:

- all placeholder secrets replaced and encrypted
- Twelve Data key validated
- Twilio and Resend validated
- staging certs and prod cert path validated
- backup restore drill completed
- worker canary completed successfully
- operator on-call coverage confirmed
- alert routes tested

## Day-0 Support Window

Recommended:

- 24-hour hypercare after first production sync
- operators watching:
  - API error rate
  - WebSocket churn
  - quote staleness
  - export queue
  - ClickHouse sync
  - MinIO health
  - node saturation

## Open Item Still Visible In Repo

- internal TLS remains a follow-up hardening item before a no-exception production transport posture

This does not block staging bootstrap, but it does block the final security-hardening standard originally targeted for production.
