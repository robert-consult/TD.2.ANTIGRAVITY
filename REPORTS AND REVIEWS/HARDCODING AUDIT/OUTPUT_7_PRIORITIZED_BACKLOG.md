# Output 7 - Prioritized Backlog

## P0 - Critical risk, security, or severe drift

| Item | Related finding IDs | Why it matters | Dependency chain | Complexity | Risk reduction | Operational value |
| --- | --- | --- | --- | --- | --- | --- |
| Remove checked-in mobile signing material and rotate signing assets | HC-043 | Highest-severity secret exposure in the repo | Secure signing workflow; CI guard; repo cleanup | Medium | Very high | High |
| Eliminate `system_config` bootstrap duplication and centralize singleton ownership | HC-001; HC-011 | Current missing-row behavior and bootstrap ownership are ambiguous | Bootstrap service; route refactor | Medium | Very high | High |
| Fix provider selection precedence and remove prod env fallback ambiguity | HC-012; HC-014 | Quote-provider choice must be deterministic in production | Provider service refactor; diagnostics endpoint | Medium | Very high | Very high |
| Surface captcha effective provider and block silent downgrade from hidden state | HC-005; HC-006 | Security posture is currently weaker than configured posture when secrets are missing | Captcha status endpoint; admin UI status | Low | High | High |
| Add grift live invalidation and version-aware propagation | HC-025; HC-026; HC-027 | Multi-node anti-abuse drift is unacceptable | Live-bus event; config service; admin ack status | Medium | High | High |
| Remove dead controls `quoteRefreshMs` and `challengeEvaluationIntervalSec` | HC-016; HC-024 | Dead fields create operator trust failure | Route/UI cleanup; compatibility messaging; later migration | Low | High | Medium |

## P1 - Essential admin control

| Item | Related finding IDs | Why it matters | Dependency chain | Complexity | Risk reduction | Operational value |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical global performance config resolver across schema; server; admin; and client | HC-018; HC-019; HC-031 | Quote freshness and bandwidth tuning are already important and currently duplicated | Shared resolver; admin helper refactor | Medium | High | Very high |
| Challenge scheduler control cleanup with immediate reschedule semantics | HC-023; HC-024 | Existing challenge cadence control is partially shadowed | Scheduler event; admin UI cleanup | Medium | Medium | High |
| Remember-me; signup; and bot guard consolidation under typed system runtime domains | HC-002; HC-003; HC-004; HC-007; HC-008 | Security/business controls are scattered across one giant route object | Runtime config services; admin regrouping | Medium | Medium | High |
| Controlled-reload provider config editor and diagnostics | HC-013; HC-015 | Provider operations need safe reload semantics and effective-state visibility | Provider registry cleanup; reload status | Medium | Medium | High |
| Add effective-value inspector for deploy-owned and runtime-owned controls | HC-001; HC-003; HC-005; HC-012; HC-038; HC-042 | Operators need to see configured vs effective vs deploy-owned values | Read-only inspector endpoint; admin section | Medium | Medium | High |

## P2 - Operational flexibility

| Item | Related finding IDs | Why it matters | Dependency chain | Complexity | Risk reduction | Operational value |
| --- | --- | --- | --- | --- | --- | --- |
| Mobile/native/website runtime mirror for host and deep-link values | HC-032; HC-033; HC-034; HC-035; HC-036; HC-037 | Multi-surface cutovers are currently brittle | Shared surface config; read-only runtime mirror | Medium | Medium | High |
| Client polling/runtime interval consolidation | HC-029; HC-030; HC-031 | Frontend polling behavior is scattered and partly invisible | Shared interval layer; consumer migration | Medium | Medium | High |
| Auto-close and feed propagation status UI | HC-015; HC-021; HC-022 | Operators need to know whether reload-required settings actually took effect | Status endpoints; scheduler/feed ack display | Low | Medium | Medium |
| Read-only deploy inspector for exports; ClickHouse; HPA; and alerts | HC-038; HC-039; HC-040; HC-041; HC-042 | Improves visibility without blurring deploy/runtime ownership | Inspector endpoint; admin read-only section | Medium | Low | Medium |

## P3 - Cleanup, consolidation, or legacy removal

| Item | Related finding IDs | Why it matters | Dependency chain | Complexity | Risk reduction | Operational value |
| --- | --- | --- | --- | --- | --- | --- |
| Reconcile prior audit docs with live code | HC-044 | Prevents stale documents from becoming a second source of truth | Finish P0/P1 items first | Low | Medium | Medium |
| Remove duplicated client/admin performance literals after canonical resolver lands | HC-019; HC-031 | Lowers future drift | Depends on P1 performance resolver | Low | Medium | Medium |
| Collapse overlapping system-config read paths into one domain API | HC-001 | Reduces route bloat and hidden defaults | Depends on centralized system runtime service | Medium | Medium | Medium |
| Review remaining fallback literals in trading and mobile surfaces after service consolidation | HC-020; HC-033; HC-035 | Final cleanup after ownership is clear | Depends on P1/P2 architecture changes | Medium | Medium | Medium |
