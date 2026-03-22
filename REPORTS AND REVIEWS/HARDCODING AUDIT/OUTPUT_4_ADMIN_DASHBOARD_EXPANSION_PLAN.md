# Output 4 - Repo-Specific Admin Dashboard Expansion Plan

The existing admin surface is already spread across:
- `client/src/pages/AdminDashboard.tsx`
- `client/src/components/admin/dashboard/SystemConfigTab.tsx`
- `client/src/components/admin/dashboard/AdminDashboardSupport.tsx`
- `client/src/components/admin/grift/ConfigTab.tsx`
- `client/src/components/admin/scout-challenges/SettingsTab.tsx`

The expansion plan below keeps those entrypoints, but reorganizes them around effective control domains instead of route/file history.

## Proposed top-level admin sections

1. `System And Runtime`
2. `Market Data`
3. `Trading And Risk`
4. `Identity And Session`
5. `Abuse And Grift`
6. `Communications`
7. `Recruitment And Challenges`
8. `Clients And Surfaces`
9. `Infra Visibility`

## Proposed subtab model

| Section | Subtabs | Current file anchors | Primary finding IDs | Write path | Propagation indicator |
| --- | --- | --- | --- | --- | --- |
| `System And Runtime` | General; Effective Values; Runtime Health | `SystemConfigTab.tsx`; `AdminDashboard.tsx` | HC-001; HC-018; HC-019 | `/api/admin/system-config`; `/api/admin/global-settings` | Live-bus event receipt plus cache invalidation status |
| `Market Data` | Feed Cadence; Providers; Provider Routing; Symbol Universe; Diagnostics | `SystemConfigTab.tsx`; provider admin routes | HC-012; HC-013; HC-015; HC-016 | existing provider routes plus new effective endpoint | `feed reload`; `provider cache cleared`; `custom universe refreshed` |
| `Trading And Risk` | Limits; Market Hours; Loss Controls; Auto-Close; Quote Guards | `AdminDashboard.tsx`; global settings editors | HC-017; HC-020; HC-021 | `/api/admin/global-settings` | `global-settings:updated`; `autoclose:reschedule` |
| `Identity And Session` | Signup Gates; Waitlist; Remember Me; Session Transport; Captcha Health | `SystemConfigTab.tsx` | HC-002; HC-003; HC-004; HC-005; HC-006 | `/api/admin/system-config` plus read-only deploy inspector | Effective provider; cookie transport source; cache refresh status |
| `Abuse And Grift` | Bot Guard; Grift Thresholds; Grift Retention; Grift Engine Limits | `SystemConfigTab.tsx`; `grift/ConfigTab.tsx` | HC-007; HC-008; HC-025; HC-026; HC-027 | `/api/admin/system-config`; `/api/admin/grift/config` | `grift:config-updated` and node ack list |
| `Communications` | Mailbox; Notifications; Delivery Controls; E2EE | communications admin surfaces | HC-010 | `/api/admin/communications/...` | `communications:config-updated` and query invalidation status |
| `Recruitment And Challenges` | Scheduler; Defaults; Rewards; Leaderboards; Enforcement | `scout-challenges/SettingsTab.tsx` | HC-023; HC-024 | `/api/admin/challenges/settings` | `challenges:config-updated` and scheduler next-run timestamp |
| `Clients And Surfaces` | Web Runtime; Wrapper Runtime; Native Runtime; Deep Links; Website Links | `AdminDashboardSupport.tsx`; new surface inspector | HC-029; HC-031; HC-032; HC-033; HC-034; HC-035; HC-036; HC-037 | mostly read-only plus controlled mirrors | Surface badges: `web`; `native`; `wrapper`; `website` |
| `Infra Visibility` | Deploy Values; Exports; ClickHouse; Object Storage; HPA/Probes; Alerts | new read-only admin section | HC-038; HC-039; HC-040; HC-041; HC-042; HC-043 | read-only API backed by env/manifests | `deploy-managed` badge only |

## Setting-group design

| Group | Representative settings | Field types | Why grouped this way |
| --- | --- | --- | --- |
| Feed Cadence | `feedPollMs`; `staleThresholdMs`; rollover TZ/time | bounded integer; timezone select; HH:MM input | One operator mental model: quote freshness and rollover |
| Client Runtime | `restFallbackPollMs`; tier poll/flush; WS push frequency | bounded integer matrix; select for strategy | These settings already travel together through `/api/global-settings` |
| Remember Me | max age; device cap; reauth absence; token rotation | integer; toggle; warning toggle | Shared session posture with clear business/security tradeoff |
| Signup Gates | captcha enforce; provider; phone enforce; freeze; waitlist | toggle; enum; textarea; batch cap | One end-user journey and one support blast radius |
| Bot Guard | score threshold; PoW toggles; difficulty; TTL | integer; toggle | Coarse controls only; keep scoring internals out of generic admin |
| Grift | tiers; enforcement thresholds; retention windows | bounded integer sets; dependency validation | Security team needs one pane with explicit threshold ordering |
| Challenge Scheduler | enabled; interval; max rows; next run | toggle; integer; status badge | Prevents scheduler-specific drift and dead controls |

## Field-type guidance

| Setting shape | Preferred field type | Repo-specific usage |
| --- | --- | --- |
| bounded integer | number input with unit suffix and min/max badge | feed cadence; queue limits; challenge scheduler; grift tiers |
| bounded decimal/percent | numeric input with precision clamp | loss limits; warning thresholds; leverage multipliers |
| enum | select with effective-value helper text | captcha provider; quote mode; provider driver; breach policy |
| CSV/list | tokenized input with live normalization preview | fallback provider list; restricted ISO2 list |
| boolean with operational impact | toggle plus confirmation drawer | trading halt; signup freeze; challenge auto-advance |
| secret reference | redacted read-only reference or rotate action | captcha secrets; petascale credentials; provider secret refs |
| deploy-only value | read-only inspector row | hostnames; cookies; object storage endpoint; HPA values |

## Validation UX requirements

- Every row shows `Configured`, `Effective`, and `Source`.
- Every saved change shows `Propagation scope`: runtime; controlled reload; restart; deploy; migration.
- Numeric settings show hard bounds from server validators, not only helper text.
- Dangerous changes require a reason string and a typed confirmation when blast radius is `all traders`, `all signups`, or `all quotes`.
- Shadow/dead fields must show `Deprecated` and be blocked from edits.
- Secret-backed features show `configured but degraded` when the secret is missing and runtime fallback was used.

## Warning UX for dangerous changes

- `Reload required` badge: HC-013; HC-015; HC-021; HC-023.
- `Deploy-managed` badge: HC-003; HC-014; HC-022; HC-032; HC-034; HC-037; HC-038; HC-039; HC-040; HC-042.
- `Restricted secret flow` badge: HC-006; HC-041; HC-043.
- `Invariant` badge: HC-028.
- `Shadowed / dead` badge: HC-016; HC-024.
- `Duplicate source` badge: HC-001; HC-011; HC-012; HC-019; HC-020; HC-031; HC-035.

## Audit history and rollback placement

- Per section header: last changed at; actor; pending propagation count.
- Per setting group: right-side drawer showing before/after diff; actor; reason; audit event; downstream dependencies.
- Rollback button only for DB-backed runtime domains with versioned records.
- No rollback button for deploy-owned values; instead show owning manifest/env var and last deploy source.

## Propagation status indicators

| Scope | Status to show |
| --- | --- |
| runtime | `saved`; `event published`; `caches invalidated`; `clients refreshed` |
| controlled reload | `saved`; `reload requested`; `worker/feed acknowledged`; `next run at` |
| deploy | `read-only`; `managed by deploy`; `current manifest value` |
| secret | `secret present`; `secret missing`; `rotation workflow` |

## Effective-value inspector

Every admin-editable or admin-visible setting row should show:

- configured value
- effective value
- source precedence slot
- last updated by
- last updated at
- last propagation result
- downstream consumers
- stale fallback behavior if config store is unavailable

Example badges to use per row:
- `server`
- `worker`
- `ws`
- `web`
- `native`
- `wrapper`
- `website`
- `deploy`

## Role boundaries to enforce

| Scope | Typical owners | Approval model |
| --- | --- | --- |
| Low-risk runtime tuning | Platform ops | Single admin with audit reason |
| Trading/risk limits | Senior ops | Two-person approval when changing leverage or loss controls |
| Signup/jurisdiction/legal | Compliance admin | Restricted role; no broad platform admins |
| Bot/grift enforcement | Security admin | Restricted role with audit reason required |
| Secrets | Secret-management workflow only | Out-of-band rotation |
| Deploy-managed values | Ops/SRE | Read-only in admin; changed via GitOps |

## Representation of server/web/mobile/native/worker settings

- One logical setting row per business control.
- Surface-specific behavior appears as consumer badges and effective values, not duplicate editors.
- Example:
  - `WebSocket reconnect base delay`
  - configured value: `1500`
  - effective server/web value: `1500`
  - effective native value: `3000`
  - badge on native: `drift`
  - action: `open surface mirror issue`
