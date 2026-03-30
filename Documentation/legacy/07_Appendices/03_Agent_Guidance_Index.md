# Agent Guidance Index

> **Diátaxis quadrant:** Reference
> **Sources:** All 24 `AGENTS.md` files across the repository

---

## `.agents/` Policy Files (Root)

| File | Purpose |
|---|---|
| `.agents/deep-context.md` | Deep context map — domain entrypoints by problem type |
| `.agents/release-done.md` | Definition of Done — verification matrix |
| `.agents/security.md` | Security checklist — code-change review requirements |
| `.agents/performance.md` | Performance & bandwidth checklist — tier matrix, hot-path rules |
| `.agents/observability.md` | Observability checklist — logs, metrics, operator surfaces |
| `.agents/shared-services.md` | Shared-first development — dedup rules |
| `.agents/audit-decomposition.md` | Audit & decomposition policy — recommendation rubric |
| `.agents/vuln-db.md` | Vulnerability DB & scanning policy |
| `.agents/PRODUCTION_REQUIREMENTS.md` | Production requirements ledger (60+ entries) |

---

## Module-Level AGENTS.md Files

| File | Scope |
|---|---|
| `AGENTS.md` (root) | Repo router — universal gateway |
| `server/AGENTS.md` | API + WS + Trading Engine |
| `server/routes/AGENTS.md` | Route architecture guardrails |
| `client/AGENTS.md` | Web UI |
| `shared/AGENTS.md` | Shared contracts |
| `db/AGENTS.md` | Database layer |
| `MOBILE/AGENTS.md` | Capacitor wrapper |
| `MOBILE/src/mobile/AGENTS.md` | Bridge hooks/utilities |
| `MOBILE/android/AGENTS.md` | Android shell |
| `MOBILE/ios/AGENTS.md` | iOS shell |
| `NATIVE/AGENTS.md` | React Native app |
| `NATIVE/src/AGENTS.md` | Shared RN app code |
| `NATIVE/android/AGENTS.md` | Android native shell |
| `NATIVE/ios/AGENTS.md` | iOS native shell |
| `WEBSITE/AGENTS.md` | Public marketing website |
| `k8s/AGENTS.md` | Kubernetes manifests |
| `PRODUCTION READINESS/AGENTS.md` | Production readiness docs |
| `e2e/AGENTS.md` | E2E test suite |
| `scripts/AGENTS.md` | Scripts & tooling |

---

## Hierarchy

```
AGENTS.md (root router)
├── .agents/deep-context.md (navigation map)
├── .agents/release-done.md (DoD)
├── .agents/security.md (security review)
├── .agents/performance.md (perf checklist)
├── .agents/observability.md (ops checklist)
├── .agents/shared-services.md (shared-first)
├── .agents/audit-decomposition.md (audit policy)
├── .agents/vuln-db.md (vuln policy)
├── .agents/PRODUCTION_REQUIREMENTS.md (PRD ledger)
├── server/AGENTS.md
│   └── server/routes/AGENTS.md
├── client/AGENTS.md
├── shared/AGENTS.md
├── db/AGENTS.md
├── MOBILE/AGENTS.md
│   ├── MOBILE/src/mobile/AGENTS.md
│   ├── MOBILE/android/AGENTS.md
│   └── MOBILE/ios/AGENTS.md
├── NATIVE/AGENTS.md
│   ├── NATIVE/src/AGENTS.md
│   ├── NATIVE/android/AGENTS.md
│   └── NATIVE/ios/AGENTS.md
├── WEBSITE/AGENTS.md
├── k8s/AGENTS.md
├── PRODUCTION READINESS/AGENTS.md
├── e2e/AGENTS.md
└── scripts/AGENTS.md
```

---

## Related Pages

- [System Overview →](../00_Getting_Started/00_System_Overview.md)
- [Project Deep Map →](../00_Getting_Started/02_Project_Deep_Map.md)
