# syntax=docker/dockerfile:1.7
# Multi-stage build (build guide Section 14.1). API and worker ship in the same image.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
# Prisma's query engine needs OpenSSL, which distroless lacks; bookworm-slim + non-root is the fallback in 14.1.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
RUN pnpm prisma generate
CMD ["pnpm", "start:dev"]

FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm build && pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]   # worker: override with ["node", "dist/worker.js"]
