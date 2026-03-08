# Audit and Decomposition Policy

## Purpose
This is the canonical policy for:
- audit reports
- decomposition reviews
- maintainability reviews
- refactor recommendations driven by file size, duplication, or code structure

Use this guide before making claims about technical debt, maintainability risk, or decomposition priority.

Read this together with:
- `.agents/shared-services.md`
- `.agents/performance.md`
- `.agents/security.md`
- `server/routes/AGENTS.md` when route or WS decomposition is involved

## Non-negotiable rules
- Current-state-first: old reports are leads, not truth. Verify the live tree before making claims.
- Risk beats size: prioritize correctness, security, compliance, hot paths, cross-domain coupling, and high-churn code before raw file size.
- LOC over bytes: line count is only a heuristic trigger. Raw `KB` must not be used as the primary decomposition metric.
- Thresholds are triggers, not mandates: crossing a size threshold means "inspect cohesion and seams", not "split immediately".
- Cohesion matters: a large but cohesive file can be acceptable; a smaller mixed-responsibility file can still need decomposition.
- Decompose on real seams: split by domain responsibility, interface boundary, ownership boundary, or test seam. Do not split by arbitrary chunk size.
- No thin-shell theater: do not replace one god-file with a thin wrapper plus several equally mixed support files.
- Check second-generation god-files: every decomposition review must inspect extracted child files, not only the original parent.
- Shared-first dedup: prefer `shared/`, existing domain helpers, and typed support modules before proposing new helpers.
- No generic dumping-ground utils: do not propose `server/lib/util.ts`-style catch-all files unless the helper is truly cross-domain, stable, and has no better home.
- Local wrappers are allowed when semantics differ: keep small local adapters if they express domain meaning, fallback behavior, or a safer typed boundary.
- Behavior preservation is non-negotiable: decompositions must preserve route parity, API contracts, mount order, middleware order, WS behavior, and audit/security invariants.
- Hot-path caution: avoid refactors that increase allocations, fanout work, synchronous work, or coupling in trading, quotes, WS, risk, or compliance paths.

## What to evaluate
Do not judge maintainability by size alone. Inspect:
- mixed responsibilities in one file
- repeated branching or repeated normalization logic
- state and effect density
- hidden coupling across tabs, handlers, or services
- weak test seams or hard-to-mock internal helpers
- ownership ambiguity across domains
- review difficulty caused by unrelated concerns being interleaved
- hot-path sensitivity and regression risk

## Recommendation rubric
Rank recommendations in this order:
1. Correctness, security, or compliance regressions
2. Hot-path performance or bandwidth risks
3. Contract, route, mount-order, or middleware hazards
4. Cross-domain maintainability problems with clear seams
5. Size-driven cleanup only after the above are addressed

## Required audit output categories
Every audit or decomposition report must distinguish:
- stale claims
- real issues
- no-action items
- optional follow-ups

No-action is a valid result. If the current tree is healthy, say so explicitly instead of manufacturing work.

## Anti-patterns to reject
Reject recommendations that:
- rank work by byte size alone
- recommend already-completed work
- count duplication without checking existing shared helpers first
- propose a new utility file without proving cross-domain need
- ignore the quality of extracted child files
- treat every large file as equally urgent
- omit "no work needed" when the current tree is acceptable
- push decomposition that weakens behavior parity or hot-path performance

## Required evidence checklist
Every audit or decomposition recommendation must include:
- an exact verification date
- explicit wording such as `Verified against current tree on YYYY-MM-DD`
- current `wc -l` or equivalent line-count evidence for the files being discussed
- `rg` evidence for any claims about `@ts-nocheck`, duplicate helpers, route registrations, or stale modules
- duplicate-helper verification against `shared/` and existing domain support modules
- route/API parity expectations for proposed route splits
- required validation commands for the recommended change

If a historical report is disproven by the live tree, mark the old claim as stale and do not restate it as active debt.

## Required scan before making claims
Use targeted, current-tree commands before recommending work.

Current large-file and LOC scan:
```bash
find client server shared -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | sort -nr | head -n 40
```

`@ts-nocheck` scan:
```bash
rg -n "@ts-nocheck" client server shared
```

Duplicate-helper definition scan:
```bash
rg -n "^function nowSec\\(|^export function nowSec\\(|^function clampInt\\(|^export function clampInt\\(|^function toFiniteNumber\\(|^export function toFiniteNumber\\(|^function normalizeChallengeMailboxCategory\\(|^export function normalizeChallengeMailboxCategory\\(" client server shared
```

Route registration or parity scan:
```bash
rg -n "\\.(get|post|patch|put|delete)\\(" server/routes.ts server/routes
```

If route decomposition is proposed, record the method/path surface before and after and verify that mount order and middleware order remain intact.

## Decomposition decision standard
Recommend decomposition when most of these are true:
- the file mixes unrelated responsibilities
- the seams are clear and low-risk
- the extracted modules will each be more cohesive than the original
- behavior can be preserved with clear parity checks
- the change improves reviewability, ownership, or testability

Do not recommend decomposition when:
- the file is large but cohesive and already understandable
- the proposed split is only size-driven
- the likely result is a thin shell plus several equally mixed support files
- the refactor would put a hot path at unnecessary risk

## Dedup decision standard
Recommend dedup only after confirming:
- the logic is actually duplicated, not just similar
- the candidate abstraction has one stable owner
- the shared home is already present or clearly justified
- the resulting abstraction does not hide domain-specific semantics

Prefer:
- `shared/` for true cross-subproject contracts or primitives
- domain-specific support modules for domain-specific helpers
- local wrappers when the caller needs a domain-shaped API over a shared primitive
