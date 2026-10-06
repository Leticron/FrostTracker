# syntax=docker/dockerfile:1

# ---- base: Node LTS + pnpm (via corepack) --------------------------------------------
FROM node:24.21.0-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# Only the manifests, so dependency layers are cached until they change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/rules/package.json packages/rules/

# ---- build: full install, build the web app ------------------------------------------
FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @fht/web build

# ---- prod-deps: runtime dependencies of the server only --------------------------------
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@fht/server..."

# ---- runtime: no pnpm, no build tools, non-root ----------------------------------------
# The server is TypeScript run directly by Node's built-in type stripping (no build step).
FROM node:24.21.0-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/Leticron/FrostTracker" \
      org.opencontainers.image.description="Self-hosted Frosthaven campaign tracker (code only, no game content)" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist \
    MIGRATIONS_DIR=/app/apps/server/drizzle
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/packages/rules/node_modules ./packages/rules/node_modules
COPY package.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/server/src ./apps/server/src
COPY apps/server/drizzle ./apps/server/drizzle
COPY packages/shared ./packages/shared
COPY packages/rules/package.json ./packages/rules/
COPY packages/rules/src ./packages/rules/src
COPY --from=build /app/apps/web/dist ./apps/web/dist
# npm, npx and corepack aren't needed at runtime.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && mkdir -p /data/assets /data/seed
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/src/index.ts"]
