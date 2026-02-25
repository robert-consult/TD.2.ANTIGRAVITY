# Tradehub Petascale Stack

This folder is the production-oriented integration point for the local source packages in `/home/Petascale-data` plus Headlamp.

## Package Mapping (all 12)

1. `bullmq` -> app dependency and worker runtime in `server/services/adminDataExportQueue.ts`.
2. `bull-board` -> queue UI mounted at `/api/admin/data-exports/queues`.
3. `clickhouse` -> `docker-compose.yml` service `clickhouse` + init SQL in `clickhouse/init/00-init.sql`.
4. `grafana` -> `docker-compose.yml` service `grafana` + provisioning under `grafana/provisioning`.
5. `infra-pkg` -> mounted helper service `infra_pkg` for package build workflows.
6. `kes` -> `docker-compose.yml` service `kes` + config in `kes/config.yml`.
7. `minio_monitor` -> `docker-compose.yml` service `minio_monitor` using `vendor/minio_monitor/main.py`.
8. `minio` -> `docker-compose.yml` service `minio`, private bucket for export artifacts.
9. `pigsty` -> mounted helper service `pigsty` for Postgres operations/tooling.
10. `prometheus` -> `docker-compose.yml` service `prometheus` + `prometheus.yml` + alert rules.
11. `valkey` -> `docker-compose.yml` service `valkey` (BullMQ backend + cache).
12. `headlamp` -> `docker-compose.yml` service `headlamp` for Kubernetes UI.

## Source Sync

Run the sync script to import package metadata/artifacts into this repo:

```bash
./petascale/sync_local_sources.sh
```

This populates `petascale/vendor/*` and `petascale/vendor/MANIFEST.txt`.

## Bring Up Stack

```bash
cd petascale
docker compose up -d
```

## Runtime Controls (worker)

Key environment knobs used by the export/analytics worker:

- `CLICKHOUSE_SYNC_ENABLED=1`
- `CLICKHOUSE_SYNC_INTERVAL_SEC=300`
- `CLICKHOUSE_SYNC_BATCH_SIZE=20000`
- `CLICKHOUSE_SYNC_MAX_LOOPS_PER_TICK=4`
- `ADMIN_DATA_EXPORT_RETENTION_SWEEP_ENABLED=1`
- `ADMIN_DATA_EXPORT_RETENTION_SWEEP_INTERVAL_SEC=600`
- `ADMIN_DATA_EXPORT_RETENTION_SWEEP_BATCH_LIMIT=200`
- `EXPORT_LOCAL_LINK_SIGNING_SECRET=<32+ chars>`

These control OLTP->OLAP replication cadence, artifact expiration cleanup, and local-link signature integrity.

## Required Environment Hardening Before Production

- Replace all `*_change_me` values via `.env` or secret manager injection.
- Set real `SESSION_SECRET`, `LEGAL_TERMS_HMAC_SECRET`, `ENCRYPTION_KEY`, verification secrets.
- Set `EXPORT_LOCAL_LINK_SIGNING_SECRET` to a dedicated 32+ char secret.
- Restrict exposed ports with OVH firewall + allowlist.
- Keep MinIO bucket private and use short-lived signed links only.
