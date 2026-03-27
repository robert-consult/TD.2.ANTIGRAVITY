# Quick Start (Local Development)

> **Diátaxis quadrant:** Tutorial
> **Sources:** `README.md`, `AGENTS.md` §Golden commands

---

## Prerequisites

- **Node.js** 20+ and **npm** 10+
- **Docker** (for PostgreSQL and Valkey)
- **Git**

---

## 1. Clone and Install

```bash
git clone <repo-url> TD.2.ANTIGRAVITY
cd TD.2.ANTIGRAVITY
npm ci
```

> `npm ci` is preferred over `npm install` for deterministic, lockfile-pinned installs.

---

## 2. Start Infrastructure

TradeQuip requires PostgreSQL and Valkey (Redis-compatible). Docker Compose handles both:

```bash
docker compose -f docker-compose.infra.yml up -d
```

This starts:
- **PostgreSQL** on port `5432`
- **Valkey** on port `6379`

---

## 3. Initialize the Database

```bash
npm run db:ensure
```

This bootstraps the local database: runs migrations, applies seed data, and verifies schema integrity.

---

## 4. Configure Environment

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

At minimum, the following secrets must be configured (even for local dev):

| Variable | Generation | Purpose |
|---|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` | Cookie signing |
| `LEGAL_TERMS_HMAC_SECRET` | `openssl rand -hex 32` | Legal acceptance tokens |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | At-rest encryption (mailbox, inquiries) |

See [Environment Variables](03_Environment_Variables.md) for the complete reference.

---

## 5. Start the Dev Server

```bash
npm run dev
```

Open **http://localhost:5000**. The dev server runs both the Express API and the Vite frontend with HMR.

---

## Durable Database Mode (Recommended)

By default, Docker volumes are ephemeral. For persistent trade history across container restarts:

```bash
npm run infra:up:durable        # Postgres + Valkey with named volumes
npm run db:ensure:durable       # Initialize durable DB
npm run dev:durable             # Dev server against durable DB
```

> Durable Valkey uses port `6380` to avoid conflicts with the ephemeral stack.

---

## Core Commands Reference

| Task | Command |
|---|---|
| Development (full stack) | `npm run dev` |
| Type checking | `npm run check` |
| Production build | `npm run build` |
| Start production | `npm run start` |
| E2E tests (Playwright) | `npm run e2e` |
| Install Playwright browsers | `npm run e2e:install` |
| DB ensure (dev) | `npm run db:ensure` |
| DB migrate (CI) | `npm run db:migrate:drizzle` |
| DB audit | `npm run db:audit` |
| Admin smoke test | `npm run smoke:admin` |
| Activity audit verify | `npm run audit:activity` |
| Load test: quotes | `npm run loadtest:publish-quotes` |
| Load test: WS fanout | `npm run loadtest:ws-fanout` |

---

## Mobile Setup

| Platform | Guide |
|---|---|
| Capacitor (wrapper) | [Capacitor Guide →](../04_Mobile/01_Capacitor_Guide.md) |
| React Native | [React Native Guide →](../04_Mobile/02_React_Native_Guide.md) |

---

## Related Pages

- [System Overview →](00_System_Overview.md)
- [Project Deep Map →](02_Project_Deep_Map.md)
- [Environment Variables →](03_Environment_Variables.md)
- [Definition of Done →](../01_Development_Guides/07_Definition_of_Done.md)
