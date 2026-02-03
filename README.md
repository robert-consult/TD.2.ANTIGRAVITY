# TD.1.11.ANTIGRAVITY

- Web dev: `npm run dev`
- Durable Postgres (prevents “history disappears after shutdown” on ephemeral hosts):
  - Start infra: `npm run infra:up:durable`
  - Ensure schema: `npm run db:ensure:durable`
  - Run dev against durable DB: `npm run dev:durable`
  - Valkey (durable infra) listens on `6380`
  - Diagnostics: `npm run audit:trade-history:durable`
- Build: `npm run build`
- Mobile (Capacitor): `CAPACITOR.md`
- Agent guidance: `AGENTS.md` (checklists in `/.agents/`)
