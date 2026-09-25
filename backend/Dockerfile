# syntax=docker/dockerfile:1.7
# Build from the repository root, because the API bundles the shared rules in shared/wms-domain:
#   docker build -f backend/Dockerfile -t hvac-wms-api .
# Targets: `runtime` (the API) and `migrate` (applies database migrations, run it before a new release).
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

FROM base AS deps
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS build
COPY shared/wms-domain/package.json /app/shared/wms-domain/package.json
COPY shared/wms-domain/src /app/shared/wms-domain/src
COPY backend/ ./
RUN npx prisma generate && npm run build

FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --from=build --chown=node:node /app/backend/prisma ./prisma
COPY --from=build --chown=node:node /app/backend/package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/'+(process.env.API_PREFIX||'api')+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
