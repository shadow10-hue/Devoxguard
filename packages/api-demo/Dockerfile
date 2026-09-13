# syntax=docker/dockerfile:1
# Build from the repo root (npm workspaces need the root lockfile):
#   docker build -f packages/api-demo/Dockerfile -t devoxguard-api-demo .
# Base images pinned by digest (supply-chain: tags are mutable, digests not).

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
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

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/api-demo/package.json packages/api-demo/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
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
# Checks GET /devoxguard/health, which itself verifies Mongo (fail-closed:
# a 503 here means Mongo is unreachable) and Elasticsearch (fail-open: a
# down ES still reports 200, per docs/architecture.md §5).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/devoxguard/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "packages/api-demo/dist/main.js"]
