# The Prima API as one container (Azure Container Apps). The website is built separately for Static Web Apps.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cms/package.json apps/cms/
RUN npm ci -w @prima/core -w @prima/api
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @prima/core && npm run build -w @prima/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cms/package.json apps/cms/
RUN npm ci --omit=dev -w @prima/core -w @prima/api && npm cache clean --force
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY db/migrations db/migrations
COPY db/modules db/modules
COPY db/release-manifest.json db/release-manifest.json
COPY apps/api/src/connections-mail/job-email-v2.sql apps/api/src/connections-mail/job-email-v2.sql
COPY ops/base-transition ops/base-transition
COPY ops/existing-admin ops/existing-admin
USER node
EXPOSE 3000
WORKDIR /app/apps/api
# The API. The database setup job runs the same image with: node dist/src/db-setup.js
CMD ["node", "dist/src/main.js"]
