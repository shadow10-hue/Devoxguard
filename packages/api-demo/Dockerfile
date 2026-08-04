# syntax=docker/dockerfile:1
# Build from the repo root (npm workspaces need the root lockfile):
#   docker build -f packages/api-demo/Dockerfile -t devoxguard-api-demo .
# Base images pinned by digest (supply-chain: tags are mutable, digests not).

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/api-demo/package.json packages/api-demo/
COPY packages/dashboard/package.json packages/dashboard/
# --ignore-scripts: no lifecycle scripts run at install time (husky etc.);
# nothing in this tree needs a native build.
RUN npm ci --ignore-scripts
COPY packages/engine packages/engine
COPY packages/api-demo packages/api-demo
# Engine must compile first: api-demo imports its compiled dist/, and the
# engine build includes the mandatory YAML rule copy step.
RUN npm run build -w packages/engine && npm run build -w packages/api-demo

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/api-demo/package.json packages/api-demo/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4
ENV NODE_ENV=production
WORKDIR /app
# Production node_modules keeps the @devox/engine workspace symlink, so the
# packages/engine tree must exist at the same relative path.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder /app/packages/engine/package.json ./packages/engine/
COPY --from=builder /app/packages/api-demo/dist ./packages/api-demo/dist
COPY --from=builder /app/packages/api-demo/package.json ./packages/api-demo/
# The runtime needs no package manager: dropping npm/corepack/yarn removes
# their bundled dependencies (and their CVEs) from the attack surface.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Least privilege: never run as root. 'node' is the stock unprivileged user.
USER node
EXPOSE 3000
# The API has no dedicated health route; any HTTP status < 500 means the
# process is up and serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "packages/api-demo/dist/main.js"]
