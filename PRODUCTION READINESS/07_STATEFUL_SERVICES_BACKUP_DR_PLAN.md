# Stateful Services Backup And DR Plan

Last updated: 2026-03-09

## Services In Scope

- Postgres
- Valkey
- MinIO
- ClickHouse
- Prometheus/Grafana state where required
- Longhorn-backed PVC snapshots

## Current Repo State

- Postgres PVC requested in `k8s/03-postgres.yaml`
- Prometheus PVC requested in `k8s/60-monitoring.yaml`
- ClickHouse and MinIO PVCs requested in `k8s/70-petascale-infra.yaml`
- manual Postgres backup helper exists: `scripts/db-backup.sh`
- no automated backup CronJobs are yet committed

## Required Backup Design

### Postgres

Target:

- daily full backup
- WAL archiving for PITR
- encrypted off-node backup storage

Minimal operational plan:

- use a Postgres backup tool/operator of your choice after cluster bootstrap
- store backups off the cluster
- keep at least:
  - 7 daily
  - 4 weekly
  - 3 monthly

### Valkey

Target:

- treat as rebuildable cache/session store where acceptable
- for sessions, rely on app behavior and short recovery time rather than deep retention

Operational note:

- document whether session loss during cluster restore is acceptable

### MinIO

Target:

- bucket replication or scheduled object backup to secondary storage
- verify exported admin data can be restored and link reissued if needed

### ClickHouse

Target:

- scheduled backups of metadata and data
- ability to restore analytical tables without blocking core trade flow

### Longhorn

Target:

- recurring snapshots
- snapshot retention by class:
  - frequent short retention for fast rollback
  - daily retention for DR

## Restore Drills Required Before Production

1. Restore Postgres into staging from backup.
2. Validate user login, quote persistence, and core admin read paths.
3. Restore MinIO data to staging and validate exported file access.
4. Restore ClickHouse and confirm analytical queries and rollups recover.
5. Confirm worker resumes queue processing after service restarts.

## RPO / RTO Targets

Initial recommended targets:

- Postgres:
  - RPO: 15 minutes or better
  - RTO: 1-2 hours
- MinIO:
  - RPO: 1 hour
  - RTO: 2-4 hours
- ClickHouse:
  - RPO: 1 hour
  - RTO: 4 hours

These are not guaranteed by the repo today; they are operational targets for the platform build-out.

## Repo Gaps Still Open

- no backup manifests or CronJobs are committed yet
- no restore runbooks are committed yet for each stateful service
- no evidence of backup restore drills exists yet

## Required Inputs From You

- backup destination choice
  - OVH object storage
  - secondary MinIO
  - other
- retention policy approval
- acceptable RPO/RTO values
