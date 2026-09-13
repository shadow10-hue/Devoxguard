# syntax=docker/dockerfile:1
# Build from the repo root:
#   docker build -f packages/dashboard/Dockerfile -t devoxguard-dashboard .
#
# SECURITY (AR-6 in .github/SECURITY.md, resolved): the SPA no longer reads
# any VITE_* API key — it calls its own origin, which nginx reverse-proxies
# to the backend, injecting the real key server-side from the container's
# environment at start time (see nginx.conf.template). No key is baked into
# the build or shipped to the browser.

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/api-demo/package.json packages/api-demo/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --ignore-scripts
COPY packages/dashboard packages/dashboard
RUN npm run build -w packages/dashboard

# Unprivileged nginx: runs as uid 101, listens on 8080, no root anywhere.
FROM nginxinc/nginx-unprivileged:alpine@sha256:d9083fe47768377ef55dedafd67d4da7c2f2bc2bece7554954f29359deb0dce9
COPY packages/dashboard/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/packages/dashboard/dist /usr/share/nginx/html
# Sane default for local/dev use; deliberately NO default for
# DEVOXGUARD_API_KEY — unset means nginx proxies with an empty key and the
# backend guard correctly 401s, rather than silently working insecurely.
ENV DEVOXGUARD_API_UPSTREAM=http://api-demo:3000
# The base image already drops to this user; restated so the policy is
# explicit in this Dockerfile (and scanners can verify it).
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
