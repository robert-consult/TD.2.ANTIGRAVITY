# WEBSITE Wiring Guide

## Domain Topology

```
example.com (this module)          tradehub.example.com (TD.2.ANTIGRAVITY app)
├── /                  HomePage    ├── /login                     LoginPage
├── /dashboard         Markets     ├── /login?tab=login           Login tab deep link
├── /education         Catalog     ├── /login?tab=register        Register tab deep link
├── /education/:m      Module      ├── /verify-email              Email verification
├── /education/:m/:l   Lesson      ├── /                          Authenticated app shell
├── /platform-guide    Guide       ├── /api/auth/*                Auth endpoints
├── /platform-guide/:l GuidePage   └── /api/trades/*, /api/quotes/*, ...
├── /contact           Contact     ├── /verify-email              Email verification
└── /api/status        Health
    /api/education/*   Curriculum content
    /api/platform-guide/*  Module 10 content
    /api/contact       Form POST
```

## Cross-Domain Link Map

All external links are centralized in `client/src/lib/app-config.ts`:

```typescript
export const APP_CONFIG = {
  tradingAppUrl: 'https://tradehub.example.com/',
  loginUrl: 'https://tradehub.example.com/login?tab=login',
  signupUrl: 'https://tradehub.example.com/login?tab=register',
}
```

### Link Pattern: Native `<a>` for Cross-Domain

```tsx
// ✅ CORRECT — browser redirect, zero SPA coupling
<a href={APP_CONFIG.loginUrl}>
  <Button>Login</Button>
</a>

// ❌ WRONG — wouter Link tries SPA navigation
<Link href="/login">Login</Link>
```

**Why:** The website is a separate SPA with its own router. Using wouter `<Link>` for `/login` would try to match a route that doesn't exist in the website's router. Native `<a>` tags trigger a full browser navigation to `tradehub.example.com`.

### Link Pattern: Wouter `<Link>` for Internal

```tsx
// ✅ Internal navigation within the website SPA
<Link href="/dashboard">Markets</Link>
<Link href="/education">Education</Link>
<Link href="/platform-guide">Platform Guide</Link>
```

## Where Links Appear

| Component | Link Target | Type |
|-----------|------------|------|
| `MarketingHeader.tsx` | Login, Signup, Platform Guide | `<a>` to tradehub for auth, `<Link>` for internal |
| `HomePage.tsx` | Login, Signup, Dashboard | `<a>` for auth, `<Link>` for internal |
| `EducationPage.tsx` | Platform Guide, app home CTA | `<Link>` for guide, native `<a>` for app CTA |
| `App.tsx` | Catalog, module, lesson, and guide routes | Wouter `<Route>` |

## Content Pipeline Topology

- Authoring inputs live outside the website module in:
  - `/home/bcodex/PUBLIC WEBSITE/integration_enhancements_framework`
  - `/home/bcodex/PUBLIC WEBSITE/education_module_development`
- WEBSITE consumes those inputs only during `npm run content:sync`.
- Runtime reads only the generated files in `server/content/generated/`.
- `npm run audit:website-isolation` still enforces that WEBSITE code does not import from outside `WEBSITE/`.

## Local Runtime

- Trading app local dev: `http://localhost:5000`
- WEBSITE local dev: `http://localhost:5001`
- WEBSITE port override: `PORT=<port> npm run dev`

## Separation Guarantees

- **Zero shared code** — WEBSITE/ imports nothing from the parent repo
- **Zero shared state** — no cookies, localStorage, or sessions cross domains
- **Zero shared database** — website server has no DB connection
- **Zero shared auth** — website has no concept of "logged in" users
- **Deletable** — removing `WEBSITE/` has zero effect on the trading app
- **Auditable** — `npm run audit:website-isolation` fails on cross-imports in either direction
