# Petascale Data Infrastructure Integration - Assessment & Plan

## Tasks
- [x] Assess current database, Valkey, and backend Node API setup in the `TD.2.ANTIGRAVITY` application.
- [x] Review the downloaded tools in `Petascale-data` (ClickHouse, MinIO, BullMQ, Prometheus, Grafana, Pigsty, Valkey, KES) and define their roles.
- [x] Compare architectural options:
  - Option A: Separate Analytics/Export Node App.
  - Option B: Integrated Background Services with API linking.
- [x] Define the holistic monitoring strategy extending beyond trading data to the entire `TD.2.ANTIGRAVITY` system.
- [x] Write a refined Architecture Assessment and Implementation Plan for user review.

## Execution
- [x] **Phase 1: Bare-Metal Infra**. Created `petascale/docker-compose.yml` (MinIO, ClickHouse, Prometheus, Grafana).
- [ ] **Phase 2: Node Dependencies**. Install BullMQ, `@aws-sdk/client-s3`, `@clickhouse/client`, and `prom-client`.
- [ ] **Phase 3: Client Init**. Set up singleton clients for BullMQ, MinIO, and ClickHouse in `server/services/`.
- [ ] **Phase 4: Export Worker**. Implement the streaming export job worker (streaming PG -> MinIO).
