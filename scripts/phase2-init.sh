#!/usr/bin/env bash
# ---------------------------------------------------------------------
# idempotent bootstrap script – run inside Replit once after pulling
# the Phase‑2 code snippets below. It creates missing folders, installs
# extra npm deps, and applies DB migrations.
# ---------------------------------------------------------------------

set -e

# Ensure we are at project root
cd "$(dirname "$0")/.."

# Install new frontend + backend deps
npm i @tanstack/react-table csv-stringify node-cron dayjs dotenv-cli

# copy new env template if none exists
cp -n .env.example .env || true

# run prisma / mongoose seed (choose whichever DB the project uses)
node scripts/migrate-mongo.js

# build client assets (Vite / CRA / Next)
runtime="$(jq -r .scripts.build package.json 2>/dev/null || echo '')"
if [[ -n "$runtime" ]]; then npm run build; fi

echo "Phase‑2 bootstrap complete!"