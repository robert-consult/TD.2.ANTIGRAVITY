---
audience: internal
exposure: internal
owner: documentation-program
canonical_sources:
  - AGENTS.md
  - README.md
  - package.json
  - docker-compose.infra.yml
  - .env.example
last_verified: 2026-03-29
status: maintained
---

# Local Quick Start

## Baseline Workflow

1. install dependencies with `npm ci`
2. start local infra with `docker compose -f docker-compose.infra.yml up -d`
3. create or verify schema state with `npm run db:ensure`
4. start the full-stack dev runtime with `npm run dev`

## Core Verification Commands

- typecheck: `npm run check`
- production build: `npm run build`
- e2e: `npm run e2e`
- DB migrate path: `npm run db:migrate:drizzle`
- DB audit path: `npm run db:audit`

## Environment Notes

- use `.env.example` as the template for local environment variables
- startup secret validation lives in `server/index.ts`; missing critical secrets can intentionally abort startup
- local infra defaults to Postgres plus Valkey; durable local mode uses `docker-compose.infra.durable.yml`

## Adjacent Surfaces

- website module: `cd WEBSITE && npm ci && npm run dev`
- Capacitor wrapper: `cd MOBILE && npm install && npm run sync`
- React Native app: `cd NATIVE && npm install && npm run android`
