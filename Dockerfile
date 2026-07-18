# syntax=docker/dockerfile:1.6
# =============================================================================
# Outbound.AI backend — production image.
#
# Multi-stage build:
#   1. base     — pinned Node.js runtime shared by both stages.
#   2. deps     — installs full deps (including dev) needed to build.
#   3. builder  — runs `esbuild` to bundle server.ts → dist/server.cjs.
#   4. runner   — small Alpine runtime that only carries the built bundle
#                 and production node_modules. Runs as non-root `node`.
#
# The image intentionally does NOT include the frontend assets — the
# `frontend` service serves them via Nginx. If backend receives an
# unhandled path (which shouldn't happen behind Nginx), the server's
# built-in fallback returns 404.
# =============================================================================

ARG NODE_VERSION=20.18.1-alpine3.20

# ---- 1. Base ----------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
# Alpine ships tini for signal handling + dumb-init as pid 1 alternatives.
RUN apk add --no-cache tini wget

# ---- 2. Deps (full deps for the build stage) --------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# `npm ci` = deterministic install pinned to the lockfile.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline

# ---- 3. Builder -------------------------------------------------------------
FROM deps AS builder
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY server.ts ./
COPY server ./server
COPY src ./src
COPY index.html ./
# We bundle only the backend here — Vite build lives in Dockerfile.frontend.
# Keeping esbuild's `--packages=external` avoids bundling node_modules that
# won't runtime-load correctly (native addons, ESM shims, etc.).
RUN npx esbuild server.ts \
      --bundle \
      --platform=node \
      --format=cjs \
      --target=node20 \
      --packages=external \
      --sourcemap \
      --outfile=dist/server.cjs

# ---- 4. Prod dependencies only ---------------------------------------------
# Cheaper install with only runtime deps so the final image stays small.
FROM base AS prod_deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund --prefer-offline

# ---- 5. Runner --------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Drop root: the `node` user ships with the official image.
USER node
WORKDIR /home/node/app

# Copy production node_modules first so it caches independently of source.
COPY --chown=node:node --from=prod_deps /app/node_modules ./node_modules
# Copy built bundle + package.json for version stamping.
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

# server.ts falls back to serving `dist/index.html` for `*` requests when
# NODE_ENV=production. Keep a tiny stub so the fallback returns something
# reasonable if a request reaches the backend directly (Nginx normally routes
# `/` to the frontend service, so this is defensive).
RUN mkdir -p ./dist && echo '<!doctype html><meta http-equiv="refresh" content="0;url=/"><title>Outbound.AI</title>' > ./dist/index.html

EXPOSE 3000

# Container-level healthcheck. The `/health` endpoint is designed for this:
# returns 200 when postgres + redis are reachable, 503 otherwise.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

# tini reaps zombies and forwards signals cleanly to Node.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.cjs"]
