# syntax=docker/dockerfile:1.7
#
# Denis Cloud (web platform) — built from the repository root so the linked
# Node client (clients/node) is available:
#   docker build -f web/Dockerfile -t denis-web .
#
# Runtime: Next.js standalone output, Node 22, non-root. Configuration comes
# from the environment (see web/.env.example); the Postgres schema is applied
# with `npm run db:push` (drizzle-kit) or the entrypoint's DB_PUSH=1.

FROM node:22-alpine AS deps
WORKDIR /repo
COPY clients/node ./clients/node
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/clients/node ./clients/node
COPY --from=deps /repo/web/node_modules ./web/node_modules
COPY web ./web
# Build-time placeholders: env() is validated at runtime, but the build evaluates
# the modules that read it.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-placeholder-secret-0000000000 \
    JWT_SECRET=build-placeholder-jwt-secret-0000000000 \
    JWT_REFRESH_SECRET=build-placeholder-refresh-secret-0000000000 \
    DENIS_GROUP=build DENIS_PASSWORD=build \
    DENIS_MAIN_TOKEN=00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
RUN cd web && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S denis && adduser -S denis -G denis
# standalone output keeps the monorepo layout (repo root = outputFileTracingRoot)
COPY --from=build --chown=denis:denis /repo/web/.next/standalone ./
COPY --from=build --chown=denis:denis /repo/web/.next/static ./web/.next/static
COPY --from=build --chown=denis:denis /repo/web/public ./web/public
# drizzle-kit for `DB_PUSH=1` (schema push at start-up), installed apart from the app
COPY --chown=denis:denis web/drizzle.config.ts ./migrate/drizzle.config.ts
COPY --chown=denis:denis web/src/lib/db/schema.ts ./migrate/src/lib/db/schema.ts
COPY --chown=denis:denis web/docker/migrate-package.json ./migrate/package.json
RUN cd migrate && npm install --no-audit --no-fund --omit=dev && npm cache clean --force
COPY --chown=denis:denis web/docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
USER denis
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
