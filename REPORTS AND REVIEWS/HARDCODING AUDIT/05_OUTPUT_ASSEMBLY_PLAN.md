# Output Assembly Plan

## Completion order

1. Fill `OUTPUT_2_FULL_CONFIGURATION_INVENTORY.md` first.
2. Derive `OUTPUT_3_WIRED_VS_NOT_WIRED_MATRIX.md` from the inventory.
3. Build `OUTPUT_9_EVIDENCE_APPENDIX.md` alongside the inventory while evidence is fresh.
4. Use the classified inventory to produce:
   - `OUTPUT_4_ADMIN_DASHBOARD_EXPANSION_PLAN.md`
   - `OUTPUT_5_RUNTIME_CONFIG_ARCHITECTURE.md`
   - `OUTPUT_6_FILE_BY_FILE_IMPLEMENTATION_MAP.md`
   - `OUTPUT_7_PRIORITIZED_BACKLOG.md`
   - `OUTPUT_8_FINAL_RECOMMENDATION.md`
5. Finish with `OUTPUT_1_EXECUTIVE_SUMMARY.md`.

## Output-to-workstream map

| Output | Primary inputs | Must not start until | Core checks |
| --- | --- | --- | --- |
| `Output 1` Executive Summary | `WS10`-`WS12` | Class counts and priority bands are stable | Counts by class/domain reconcile with inventory |
| `Output 2` Full Configuration Inventory | `WS02`-`WS10` | Control-plane map exists | Every finding has class, source of truth, scope |
| `Output 3` Wired vs Not Wired Matrix | `Output 2` | Wiring fields are populated | Every matrix row traces back to inventory finding IDs |
| `Output 4` Admin Dashboard Expansion Plan | `WS03`, `WS07`, `WS10`, `WS11` | Runtime vs controlled-reload split is clear | No secrets or deploy-only values are proposed as broad admin fields |
| `Output 5` Runtime Config Architecture | `WS01`, `WS10`, `WS11` | Precedence conflicts are understood | Central source-of-truth model matches repo constraints |
| `Output 6` File-by-File Implementation Map | `WS12` | Target-state decisions are stable | Exact files, APIs, tests, and docs are named |
| `Output 7` Prioritized Backlog | `Output 6` | Scoring is complete | Priority reflects risk, dependency chain, and operational value |
| `Output 8` Final Recommendation | `WS11`, `WS12` | Class assignment is stable | Explicit split across admin, reload, env, secret, invariant, policy, cleanup |
| `Output 9` Evidence Appendix | `WS02`-`WS10` | Evidence collected per major finding | Major claims have quick-verification references |

## Reconciliation rules before sign-off

- Every finding in `Output 3`, `Output 7`, or `Output 9` must exist in `Output 2`.
- Every `P0` and `P1` backlog item must reference at least one finding ID.
- Every runtime-eligible recommendation must have a propagation path in `Output 5` or `Output 6`.
- Every adminization recommendation must appear in `Output 4` and `Output 8`.
- Every major claim in `Output 1` must trace back to inventory counts or evidence rows.

## Definition of done for the audit pack

The audit is only complete when:

- the full effective config surface is inventoried,
- hidden hardcoded behavior is surfaced,
- admin-config coverage is explicitly mapped,
- partially wired and drifted settings are identified,
- runtime vs reload vs deploy vs migration scope is separated,
- secrets vs non-secrets are cleanly separated,
- admin expansion is designed with RBAC and auditability,
- implementation work is broken down concretely enough for execution.
