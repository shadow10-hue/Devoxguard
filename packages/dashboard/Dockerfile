# syntax=docker/dockerfile:1
# Build from the repo root:
#   docker build -f packages/dashboard/Dockerfile -t devoxguard-dashboard .
#
# SECURITY (AR-6 in .github/SECURITY.md): Vite inlines every VITE_* build
# arg into the emitted JS bundle. VITE_DEVOXGUARD_API_KEY therefore ships in
# plaintext inside the image. Acceptable for the demo only — a production
# dashboard must authenticate through a backend session, never a bundled key.

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/api-demo/package.json packages/api-demo/
COPY packages/dashboard/package.json packages/dashboard/
RUN npm ci --ignore-scripts
COPY packages/dashboard packages/dashboard
ARG VITE_API_BASE=http://localhost:3000
ARG VITE_DEVOXGUARD_API_KEY=""
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_DEVOXGUARD_API_KEY=$VITE_DEVOXGUARD_API_KEY
RUN npm run build -w packages/dashboard

# Unprivileged nginx: runs as uid 101, listens on 8080, no root anywhere.
FROM nginxinc/nginx-unprivileged:alpine@sha256:2ddec616f1cb58bcac057aa388f28cb81e35137641ef4226d321714499329bd1
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/dashboard/dist /usr/share/nginx/html
# The base image already drops to this user; restated so the policy is
# explicit in this Dockerfile (and scanners can verify it).
USER nginx
EXPOSE 8080
