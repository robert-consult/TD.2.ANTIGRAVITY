# Admin API Surface

> **Diátaxis quadrant:** Reference
> **Sources:** `server/routes/admin*.ts`

---

## Authorization

Admin endpoints require `requireAdmin` middleware. Some require `superadmin` role for elevated access.

---

## Key Admin Route Modules

| File | Surface |
|---|---|
| `server/routes/admin.ts` (~70KB) | Core admin: global settings, user management, system config |
| `server/routes/adminSecurity.ts` | Security controls, session management |
| `server/routes/adminSystemConfig.ts` | System configuration |
| `server/routes/adminOps.ts` | Ops controls, ingress auth |
| `server/routes/adminUsers.ts` | User administration |
| `server/routes/adminKyc.ts` | KYC verification |
| `server/routes/adminGovernance.ts` | Runtime governance inspector |
| `server/routes/adminActivity.ts` | Activity monitoring |
| `server/routes/adminDataRollups.ts` | Data rollup read models |
| `server/routes/adminDataExports.ts` | Background export pipeline |
| `server/routes/adminInstitutionalAudit.ts` | Institutional audit routes |
| `server/routes/adminTraderScouting.ts` | Trader scouting routes |
| `server/routes/adminScout.ts` | Challenge/badge/progression admin |
| `server/routes/adminI18n.ts` | Translation management |

---

## Related Pages

- [REST Endpoints →](00_REST_Endpoints.md)
- [Server Backend →](../02_Architecture_Reference/02_Server_Backend.md)
