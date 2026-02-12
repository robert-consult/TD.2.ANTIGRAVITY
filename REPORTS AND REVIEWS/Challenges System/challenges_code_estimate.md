# Challenges System — Code Estimate

> **Date:** 2026-02-09 | **Companion to:** [challenges_system_design.md](file:///C:/Users/Rb/.gemini/antigravity/brain/da9fe537-7b31-4e7b-81ee-9ca84aef3671/challenges_system_design.md)

---

## Summary

| | Lines |
|-|------:|
| **Total Estimate** | **~10,000–12,000** |
| Server-side (TypeScript) | ~5,500 |
| Client-side (React TSX) | ~4,000 |
| CSS | ~850 |
| Schema / Types | ~800 |

---

## Breakdown by Layer

### Schema & Database (~770 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| `challenge_phases` table + relations | ~80 | Schema, indexes, insert schema |
| `challenges` enhancements (30+ columns) | ~120 | New columns + validation |
| `challenge_enrollments` enhancements | ~60 | New columns |
| `challenge_enrollment_events` (hash-chained) | ~90 | Schema + hash chain helpers |
| `challenge_badges` + `badge_awards` | ~80 | Two tables |
| `challenge_prize_awards` | ~60 | Hash-chained |
| `challenge_certificates` + `certificate_templates` | ~100 | Two tables + relations |
| `challenge_progression_tiers` + `user_progression` | ~80 | Two tables |
| `challenge_leaderboard_snapshot` | ~40 | Materialized view-like |
| `system_config` / `communication_settings` | ~60 | ~35 new toggles |

---

### Server — API Routes (~2,750 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Admin challenge CRUD (templates + phases) | ~400 | Create/read/update/delete/duplicate/archive + Zod |
| Admin enrollments management | ~500 | List/detail/override/extend/advance/reset/DQ + audit |
| Admin badges/certificates/tiers CRUD | ~350 | Three mini-CRUDs with validation |
| Admin prizes management | ~150 | List + approve flow |
| Admin analytics endpoints | ~250 | Aggregations, funnel, trends |
| Trader challenge browse/detail | ~200 | List + detail with phase/reward info |
| Trader enrollment (enroll/withdraw/status) | ~300 | Snapshot logic, eligibility, rate limiting |
| Trader enrollment detail + trades/events | ~250 | Ownership checks, windowed queries |
| Trader leaderboard | ~150 | Ranked query with privacy |
| Trader badges/progression/certificates | ~200 | Read + download + verify |

---

### Server — Evaluation Engine (~640 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Enhanced evaluation cron pass | ~350 | Phase-aware, multi-metric, batched |
| Trailing drawdown calculation | ~80 | Peak tracking |
| Consistency rule engine | ~60 | Single-day profit check |
| Warning threshold detection | ~50 | 80% limit checks |
| Phase advancement logic | ~100 | Auto-advance, window reset |

---

### Server — Rewards Engine (~820 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Badge award logic | ~120 | Criteria matching, dedup |
| Prize ranking + distribution | ~200 | Ranking, allocation, approval flow |
| Certificate generation | ~250 | Template merge, HMAC codes, PDF gen |
| Selection boost + pipeline update | ~100 | Scout score update, partner visibility |
| Progression tier evaluation | ~150 | Multi-criteria tier advancement |

---

### Server — Notifications (~330 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Challenge notification service | ~200 | 18 event types with toggle checks |
| Mailbox thread integration | ~100 | Template merge, thread creation |
| `CHALLENGE` type additions | ~30 | Type union + settings check |

---

### Server — Security (~170 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Hash chain helpers (events + prizes) | ~80 | SHA-256 chain logic |
| Rate limiting (per-endpoint) | ~60 | Challenge-specific limits |
| Admin notes encryption | ~30 | Using existing crypto |

> Zod schemas (~200 lines) already counted in API Routes estimates.

---

### Client — Admin Dashboard (~2,600 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Templates sub-tab (table + multi-card form) | ~800 | 6 color-coded cards, phase builder |
| Enrollments sub-tab (table + detail panel) | ~700 | Filters, gauges, equity curve, timeline |
| Analytics sub-tab (cards + charts) | ~500 | 7 charts with data fetching |
| Settings sub-tab (Cards A–G) | ~600 | All toggles + badge/cert/tier CRUDs |

---

### Client — Trader Side (~1,400 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Challenge browse (card grid + detail modal) | ~400 | Cards, filters, phase breakdown |
| My Challenges dashboard (enrollment cards) | ~500 | Gauges, equity curve, trade log |
| Challenge leaderboard | ~200 | Ranked table with highlights |
| Badges/progression/certificates display | ~300 | Profile integration, download, share |

---

### Client — CSS (~850 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Challenge admin styles | ~400 | Cards, sub-tabs, gauges, detail panel |
| Challenge trader styles | ~300 | Card grid, dashboard, leaderboard |
| Badge/certificate/progression styles | ~150 | Visual badges, tier badges |

---

### Shared / Types (~150 lines)

| Component | Lines | Notes |
|-----------|------:|-------|
| Shared types/constants | ~150 | Status enums, event types, config keys |

---

## By Implementation Phase

| Phase | Scope | Lines |
|-------|-------|------:|
| **A** | Schema, templates CRUD, eval engine, security hardening | ~3,500 |
| **B** | Enrollments management, events (hash-chained), notifications, trader dashboard | ~3,000 |
| **C** | Leaderboard, analytics, rewards (badges, prizes, certificates) | ~2,500 |
| **D** | Progression tiers, partner integration, certificate templates, custom rewards | ~1,500 |
| **Total** | | **~10,500** |
