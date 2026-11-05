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


# P65: Prima Secure's web app (apps/prima, npm workspaces), served at /prisma/, plus its
# no-sign-in preview at /prisma/demo/ (its own code on sample data). P66: built for the office
# (VITE_OFFICE): it signs in with the office session and calls /api/prisma/..., which the office
# signs on to Prima for the person.
FROM node:22-alpine AS prima
WORKDIR /prima
COPY apps/prima/package.json apps/prima/package-lock.json apps/prima/tsconfig.base.json ./
COPY apps/prima/packages/core/package.json packages/core/
COPY apps/prima/apps/api/package.json apps/api/
COPY apps/prima/apps/web/package.json apps/web/
COPY apps/prima/apps/cms/package.json apps/cms/
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci -w @prima/core -w @prima/web --no-audit --no-fund
COPY apps/prima/packages/core packages/core
COPY apps/prima/apps/web apps/web
RUN PRIMA_BASE=/prisma/ VITE_ALLOW_SAME_ORIGIN_API=true VITE_API_URL=/api/prisma VITE_OFFICE=true npm run build -w @prima/web \
 && npm run build:demo -w @prima/web


FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY --from=prima /prima/apps/web/dist /usr/share/nginx/html/prisma
COPY --from=prima /prima/apps/web/dist-demo /usr/share/nginx/html/prisma/demo
EXPOSE 8080
