# syntax=docker/dockerfile:1.7
# Builds the PWA and serves it with unprivileged nginx, which also proxies /api.

FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Manifests first: the install layer only rebuilds when dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN pnpm --filter web build
# P31: the PC agent, served at /downloads/pc-agent/ for the one-line installers.
COPY apps/pc-agent/agent.cjs apps/web/dist/downloads/pc-agent/agent.cjs
RUN cd apps/web/dist/downloads/pc-agent && sha256sum agent.cjs > agent.cjs.sha256


FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
