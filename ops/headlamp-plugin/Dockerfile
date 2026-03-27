# TradeHub Ops Headlamp Plugin — Custom Image
#
# Copies the shipped tradehub-ops plugin artifact into the official Headlamp
# container image. Rebuild `ops/headlamp-plugin/dist/main.js` first with:
#   npm run build --prefix ops/headlamp-plugin
#
# Build:
#   docker build -t tradehub-headlamp:latest -f ops/headlamp-plugin/Dockerfile .
#
# The resulting image can be deployed as a drop-in replacement for
# `ghcr.io/headlamp-k8s/headlamp:v0.29.2`.

FROM ghcr.io/headlamp-k8s/headlamp:v0.29.2

# Copy the prebuilt plugin into Headlamp's plugins directory
COPY ops/headlamp-plugin/dist/main.js /headlamp/plugins/tradehub-ops/main.js

# Headlamp will auto-discover plugins in /headlamp/plugins/
