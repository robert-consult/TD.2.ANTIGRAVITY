# Petascale Analytics

> **Diátaxis quadrant:** Reference
> **Sources:** `petascale/README.md`, `server/services/clickhouseSync.ts`

---

## Overview

ClickHouse provides petascale analytics for trade history, audit trails, and operational metrics that exceed PostgreSQL's practical query volume.

---

## Components

| Component | Location |
|---|---|
| Docker stack | `petascale/docker-compose.yml` |
| ClickHouse sync service | `server/services/clickhouseSync.ts` |
| ClickHouse client | `server/services/clickhouseClient.ts` |
| Grafana integration | `petascale/grafana/` |
| KES (key management) | `petascale/kes/` |

---

## Sync Architecture

The ClickHouse sync scheduler (worker role) periodically replicates data from PostgreSQL to ClickHouse for high-performance analytical queries.

---

## Related Pages

- [Observability →](01_Observability.md)
- [Background Jobs →](../02_Architecture_Reference/06_Background_Jobs.md)
