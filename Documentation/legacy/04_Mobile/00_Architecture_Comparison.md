# Mobile Architecture Comparison

> **Diátaxis quadrant:** Explanation
> **Sources:** `NATIVE/AGENTS.md` §Relationship to MOBILE, `MOBILE/AGENTS.md`

---

## Comparison

| | Capacitor (`MOBILE/`) | React Native (`NATIVE/`) |
|---|---|---|
| **Technology** | Capacitor 8 (WebView wrapper) | React Native 0.83 |
| **UI Source** | Web app (`client/`) via remote URL | Native components |
| **Update Cycle** | Instant (web deploy) | App store submission |
| **Performance** | WebView overhead | Native rendering |
| **Offline** | Limited (web-dependent) | Full native offline support |
| **Node Modules** | `MOBILE/node_modules/` | `NATIVE/node_modules/` |
| **Bridge** | Minimal (lifecycle, deep links, push) | Full service layer |

**Do not merge** their codebases; they have separate `node_modules/`.

---

## When to Use Each

- **Capacitor:** Fast web updates, content-heavy screens, when web is source of truth
- **React Native:** Performance-critical features, true native UX, offline-first requirements

---

## Related Pages

- [Capacitor Guide →](01_Capacitor_Guide.md)
- [React Native Guide →](02_React_Native_Guide.md)
