# `NATIVE/src/` AGENTS.md

## Scope
Shared React Native app code used by both Android and iOS.

## Core rules
- Reuse shared transport/security contracts first; do not fork API or WebSocket behavior per screen.
- Use `services/runtimeConfig.ts` for hosts, deep-link prefixes, and push environment.
- When changing auth/session behavior, keep `api.ts`, `csrf.ts`, `legalSignals.ts`, `websocket.ts`, and the related hooks consistent.
- When changing deep-link behavior, keep `src/App.tsx` aligned with the canonical web route contract.
- Trader/support parity only. Do not add admin or partner UI here.

## Tests/checks
- Update `NATIVE/__tests__/` when changing services, hooks, or deep-link/push behavior.
- Run `cd NATIVE && npm test`.
- Run `cd NATIVE && npm run lint`.
