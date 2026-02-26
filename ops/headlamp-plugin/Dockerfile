# TradeHub Ops Headlamp Plugin — Custom Image
#
# Builds the tradehub-ops Headlamp plugin and bakes it into the official
# Headlamp container image. The resulting image can be deployed as a drop-in
# replacement for `ghcr.io/headlamp-k8s/headlamp:v0.29.2`.
#
# Build:
#   docker build -t tradehub-headlamp:latest -f ops/headlamp-plugin/Dockerfile .
#
# The plugin source is compiled with the Headlamp plugin SDK and placed into
# the `/headlamp/plugins/tradehub-ops/` directory inside the container.

FROM node:20-alpine AS builder

WORKDIR /build

# Copy plugin source
COPY ops/headlamp-plugin/package.json ops/headlamp-plugin/tsconfig.json ./
RUN npm install --ignore-scripts

COPY ops/headlamp-plugin/src ./src

# Build the plugin using the headlamp-plugin CLI
RUN npx @kinvolk/headlamp-plugin build

# ─── Final image ─────────────────────────────────────────────────────────────
FROM ghcr.io/headlamp-k8s/headlamp:v0.29.2

# Copy compiled plugin into Headlamp's plugins directory
COPY --from=builder /build/dist /headlamp/plugins/tradehub-ops

# Headlamp will auto-discover plugins in /headlamp/plugins/
