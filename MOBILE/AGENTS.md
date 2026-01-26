# `MOBILE/` AGENTS.md (Capacitor Wrapper)

## What this area is
Capacitor-based wrapper for the web app, optimized for “remote URL mode” so cookie sessions and `/ws` stay same-origin.

## Non-negotiables
- Prefer **remote URL mode** (see `MOBILE/README.md` and `CAPACITOR.md`) to avoid cross-origin cookie/CORS complexity.
- Do not add native plugins that expand permissions without documenting the threat model and review steps.
- Never commit keystores, signing configs, or generated secrets.

## Key files
- Capacitor config: `MOBILE/capacitor.config.ts`
- Mobile-only UI overrides: `MOBILE/src/mobile/`
- Android project: `MOBILE/android/`

## Required checks before finalizing
- If web build changes must ship to mobile: `cd MOBILE && npm run sync`
- For Android build sanity (when required): `cd MOBILE && npm run doctor`

