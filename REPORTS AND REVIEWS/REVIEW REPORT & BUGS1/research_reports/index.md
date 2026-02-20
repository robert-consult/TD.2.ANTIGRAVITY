# System Bug Research Project — Master Index

**Project:** Comprehensive Taxonomy of Bugs & Vulnerabilities for React 18 / TypeScript 5 / Vite Stack  
**Date:** 2026-02-18 (Enriched)  
**Total Reports:** 5  
**Total Categories:** 59 Distinct Bug/Vulnerability Types

---

## 1. Executive Summary

This research project catalogs the specific failure modes of modern high-performance web applications. Unlike generic OWASP lists, this taxonomy focuses on the **intersection of technologies** used in this system: React's concurrency model, WebSocket real-time transport, Client-side storage limits, and the npm supply chain.

The reports below serve as a **hardening guide** for Senior Engineers and Security Teams to audit, defend, and architect the system against subtle but critical failures.

---

## 2. Research Reports

### [Report 1: Frontend & State Management](file:///C:/Users/Rb/.gemini/antigravity/brain/230233fd-2bdb-4b19-9080-88ae8622cadb/research_reports/report_1_frontend_and_state.md) — 14 Categories
**Focus:** React 18 Lifecycle, Hooks, Concurrent Rendering, TypeScript, TanStack Query, Zod  
**Key Definitions:** Stale Closures, Effect Races, Zombie Children, Context Tearing, TypeScript Escape Hatches, Query Key Collisions, Zod Coercion, Memory Leaks, Error Boundaries, SSR Hydration, Render Waterfalls, Re-Render Cascades.

### [Report 2: Network & Transport](file:///C:/Users/Rb/.gemini/antigravity/brain/230233fd-2bdb-4b19-9080-88ae8622cadb/research_reports/report_2_network_transport.md) — 12 Categories
**Focus:** WebSocket, HTTP, CORS, DNS, TLS  
**Key Definitions:** Reconnection Storms, Message Loss, HoL Blocking, CSWSH, CORS Misconfiguration, DNS Rebinding, Fetch Timeouts, WS Backpressure, Request Dedup, TLS Downgrade.

### [Report 3: Storage, Caching & Offline](file:///C:/Users/Rb/.gemini/antigravity/brain/230233fd-2bdb-4b19-9080-88ae8622cadb/research_reports/report_3_storage_offline.md) — 10 Categories
**Focus:** IndexedDB, Service Worker, Cache API, Web Locks  
**Key Definitions:** Quota Exceeded, Cache Poisoning, Main Thread Blocking, Crypto Key Exposure, IDB Auto-Commit, SW Lifecycle, Storage Partitioning, Web Locks Deadlocks, Cache Versioning.

### [Report 4: Security & Cryptography](file:///C:/Users/Rb/.gemini/antigravity/brain/230233fd-2bdb-4b19-9080-88ae8622cadb/research_reports/report_4_security.md) — 12 Categories
**Focus:** XSS, CSRF, CSP, Supply Chain, Cookies, Clickjacking  
**Key Definitions:** React XSS, Prototype Pollution, ReDoS, NPM Supply Chain, CSRF in SPAs, CSP Gaps, postMessage Injection, Cookie Flags, Clickjacking, Timing Channels, dangerouslySetInnerHTML.

### [Report 5: Build Tooling & Environment](file:///C:/Users/Rb/.gemini/antigravity/brain/230233fd-2bdb-4b19-9080-88ae8622cadb/research_reports/report_5_build_environment.md) — 11 Categories
**Focus:** Vite, Rollup, TypeScript, Docker/WSL, CI/CD  
**Key Definitions:** Tree Shaking, Source Map Leaks, Env Variable Injection, TS Declaration Emit, CSS Ordering, HMR State, Monorepo Deps, WSL Path Normalization, Dynamic Import Failures.

---

## 3. Global Taxonomy Map

| Layer | Bug Type | Severity | Commonality |
|-------|----------|----------|-------------|
| **UI** | Stale Closures | 🔴 Critical | Very Common |
| **UI** | Effect Races | 🟠 High | Common |
| **UI** | Context Tearing | 🟡 Medium | Uncommon |
| **UI** | Re-Render Cascades | 🟠 High | Very Common |
| **UI** | Memory Leaks (Long-Running) | 🔴 Critical | Common |
| **UI** | Missing Error Boundaries | 🔴 Critical | Common |
| **UI** | Render Waterfall | 🟠 High | Common |
| **TS** | Type Escape Hatches (`any`, `as`) | 🟠 High | Very Common |
| **TS** | Zod Coercion Pitfalls | 🟡 Medium | Common |
| **Data** | TanStack Query Key Collisions | 🟠 High | Common |
| **Net** | Reconnect Storms | 🔴 Critical | Common |
| **Net** | Message Loss | 🔴 Critical | Common |
| **Net** | CORS Misconfiguration | 🔴 Critical | Common |
| **Net** | WS Backpressure | 🟠 High | Uncommon |
| **Net** | Fetch Timeouts (Infinite Wait) | 🟠 High | Common |
| **Net** | DNS Rebinding | 🟡 Medium | Rare |
| **Data** | Quota Exceeded | 🟠 High | Uncommon |
| **Data** | Cache Poisoning | 🔴 Critical | Rare but Fatal |
| **Data** | IDB Auto-Commit | 🟠 High | Common |
| **Data** | Cache Versioning Failures | 🟠 High | Common |
| **Data** | Web Locks Deadlocks | 🟡 Medium | Rare |
| **Sec** | React XSS | 🟠 High | Uncommon |
| **Sec** | Supply Chain | 🔴 Critical | Frequent Risk |
| **Sec** | CSRF in SPAs | 🟠 High | Common |
| **Sec** | CSP Gaps | 🟠 High | Very Common |
| **Sec** | Clickjacking | 🟡 Medium | Common |
| **Sec** | Timing Side Channels | 🟡 Medium | Uncommon |
| **Sec** | Cookie Misconfig | 🟠 High | Common |
| **Env** | Secrets Leak | 🔴 Critical | Common Misconfig |
| **Env** | Docker/WSL Paths | 🟡 Medium | Common |
| **Env** | Dynamic Import 404s | 🟠 High | Common |
| **Env** | CSS Extraction Ordering | 🟡 Medium | Uncommon |

---

## 4. How to Use This Research

1. **Audit:** Use the "Detection" section of each report to scan your codebase for these specific patterns.
2. **Train:** Share these reports with the development team to build a shared vocabulary ("Is this a stale closure?").
3. **Automate:** Implement the suggested ESLint rules and CI checks to prevent regression.
4. **Cross-Reference:** Use the [Bug & Vulnerability Catalog](file:///C:/Users/Rb/.gemini/antigravity/brain/230233fd-2bdb-4b19-9080-88ae8622cadb/bug_vulnerability_catalog.md) for audit-derived instances of these patterns.

---

*Generated by Antigravity Deep Research (Enriched)*
