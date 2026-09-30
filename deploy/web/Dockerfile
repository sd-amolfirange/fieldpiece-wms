# syntax=docker/dockerfile:1.7
# The web app: builds frontend/ as it is (no changes) and serves it with nginx, which also forwards /api to the API.
# Build from the repository root: docker build -f deploy/web/Dockerfile .
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# The shared rules package the frontend depends on (file:../shared/wms-domain).
COPY shared/wms-domain/package.json shared/wms-domain/package-lock.json shared/wms-domain/
RUN --mount=type=cache,target=/root/.npm npm ci --prefix shared/wms-domain --no-audit --no-fund
COPY shared/wms-domain/ shared/wms-domain/
# The frontend's typecheck also covers its unit tests, which import the mock server's core (never bundled). That
# core only needs @wms/domain, linked to the copy above instead of installing the mock server's dependencies.
COPY backend/demo-server/src/core/ backend/demo-server/src/core/
RUN mkdir -p backend/demo-server/node_modules/@wms && ln -s /app/shared/wms-domain backend/demo-server/node_modules/@wms/domain
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc frontend/
RUN --mount=type=cache,target=/root/.npm npm ci --prefix frontend --no-audit --no-fund
COPY frontend/ frontend/

# Build-time settings (Vite bakes them in). The account picker only works while the API's demo features are on.
ARG VITE_DEMO_MODE=false
ARG VITE_ASSISTANT_ENABLED=false
# Fieldpiece apps in the warranty desk's sidebar (empty = placeholder URL).
ARG VITE_OVERWATCH_URL=
ARG VITE_JOBLINK_URL=
ENV VITE_API_BASE_URL=/api \
    VITE_DEMO_MODE=${VITE_DEMO_MODE} \
    VITE_ASSISTANT_ENABLED=${VITE_ASSISTANT_ENABLED} \
    VITE_OVERWATCH_URL=${VITE_OVERWATCH_URL} \
    VITE_JOBLINK_URL=${VITE_JOBLINK_URL} \
    VITE_SHOW_ENV_TAG=false \
    VITE_SHOW_FORGOT_PASSWORD=false
RUN npm run build --prefix frontend

FROM nginx:1.27-alpine AS runtime
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
