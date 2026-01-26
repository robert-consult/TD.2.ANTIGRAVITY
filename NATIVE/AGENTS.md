# `NATIVE/` AGENTS.md (React Native)

## What this area is
React Native app aligned to the same API contracts as the web app.

## Non-negotiables
- Keep API endpoints aligned with the server (`server/routes.ts` and `server/routes/*`).
- Never embed secrets in the app bundle; use environment/configuration for API base URLs.
- Treat WebSocket auth and reconnect behavior as security-critical.

## Key entrypoints
- App + navigation: `NATIVE/App.tsx`, `NATIVE/src/navigation/`
- Data hooks: `NATIVE/src/hooks/`
- API + WS services: `NATIVE/src/services/`

## Required checks before finalizing
- Tests: `cd NATIVE && npm test`
- Lint: `cd NATIVE && npm run lint`

