# TradeQuip Marketing Website

Public-facing marketing website for TradeQuip. Hosted independently at `example.com`, with the trading application at `tradehub.example.com`.

## Quick Start

```bash
cd WEBSITE
npm ci
npm run dev
```

The website server defaults to `http://localhost:5001`. Override it with `PORT` if needed.

## Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | Hero, features, TradingView ticker tape, external auth CTA buttons |
| `/dashboard` | Markets | Live TradingView charts, market cards by category |
| `/education` | Education catalog | Core curriculum, optional extensions, and platform-guide callout |
| `/education/:moduleSlug` | Module | Module landing page with lesson list, flags, and disclosures |
| `/education/:moduleSlug/:lessonSlug` | Lesson | GitBook-style lesson page with inline quiz and disclosures |
| `/platform-guide` | Platform Guide | Module 10 overview for the authenticated app guide |
| `/platform-guide/:lessonSlug` | Platform lesson | Platform-guide lesson page with screenshot placeholders |
| `/contact` | Contact | Contact form (POST to `/api/contact`) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Health check |
| `/api/education/catalog` | GET | Returns the grouped education catalog for Modules 1-9 |
| `/api/education/modules/:moduleSlug` | GET | Returns module landing data for Modules 1-9 |
| `/api/education/lessons/:moduleSlug/:lessonSlug` | GET | Returns lesson payloads for Modules 1-9 |
| `/api/platform-guide` | GET | Returns Module 10 overview payload |
| `/api/platform-guide/lessons/:lessonSlug` | GET | Returns Module 10 lesson payloads |
| `/api/education/modules` | GET | Legacy summary alias for module cards |
| `/api/contact` | POST | Validates and forwards contact form submissions |

## App Link Contract

The website only integrates with the trading app through external URLs:

- Login: `https://tradehub.example.com/login?tab=login`
- Signup: `https://tradehub.example.com/login?tab=register`
- App home: `https://tradehub.example.com/`

These URLs are centralized in [`client/src/lib/app-config.ts`](./client/src/lib/app-config.ts).

## Build

```bash
npm run build
```

Production output goes to `dist/public/` (static assets) and `dist/index.js` (server).

The education surface is generated before dev/build from:

- `/home/bcodex/PUBLIC WEBSITE/integration_enhancements_framework`
- `/home/bcodex/PUBLIC WEBSITE/education_module_development`

Generated website-owned payloads are written into `server/content/generated/`.

## Environment

- `PORT`
  - Optional website server port. Defaults to `5001`.
- `WEBSITE_CONTACT_WEBHOOK_URL`
  - Optional but recommended. When set, `/api/contact` forwards validated submissions to this endpoint.
  - If omitted, `/api/contact` returns `503` instead of logging PII locally.

## Tech Stack

- **Frontend:** React 18, Wouter, TanStack Query, Framer Motion, TailwindCSS
- **UI Components:** shadcn/ui (Radix primitives)
- **TradingView:** Embedded widgets (chart, ticker tape, market cards)
- **Server:** Express (static hosting + education/platform-guide JSON APIs)
- **Content Pipeline:** build-time markdown sync and verification scripts
- **Build:** Vite, TypeScript, esbuild

## Architecture

See [AGENTS.md](./AGENTS.md) for architecture rules and [WIRING.md](./WIRING.md) for the domain topology and link map.

**Key principle:** This website has zero runtime or code coupling to the trading application. Login/signup buttons use native `<a>` tags to redirect to `tradehub.example.com`. The website has no authentication, no database, and no trading logic.
