# Codebase Visualizer — single-container deployment.
# The Fastify server serves the built web app and owns /data (SQLite + repo cache).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# native module toolchain (better-sqlite3 fallback when no prebuild matches)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/analyzer/package.json packages/analyzer/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build --workspace @codeviz/web

FROM node:22-bookworm-slim
WORKDIR /app
# git: GitHub repo cloning for analysis
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4400 \
    DATA_DIR=/data \
    REPO_CACHE_DIR=/data/repo-cache \
    STATIC_DIR=/app/apps/web/dist \
    ALLOW_LOCAL_PATHS=false \
    AUTH_REQUIRED=true

VOLUME /data
EXPOSE 4400
CMD ["npm", "run", "start", "--workspace", "@codeviz/server"]
