# Denis Cloud — the web platform

The hosted-database layer for Denis (`denis.hacimertgokhan.com`): accounts,
up to three databases per user, a web console, per-database API keys with
JWT exchange, usage metering with quotas and charts, and a hosted MCP endpoint
so AI assistants can inspect and query a database.

Stack: Next.js 16 (App Router, Turbopack), TypeScript, Tailwind v4, shadcn/ui,
better-auth, Drizzle ORM on PostgreSQL, `@modelcontextprotocol/sdk`, the
`denis-client` package from `../clients/node`.

## How it fits together

```
browser ──(session cookie)──► web console ─┐
app     ──(API key / JWT)───► /api/v1/exec ─┼─► gateway ─► Denis engine (one project per database)
AI      ──(API key)─────────► /api/mcp ─────┘   ownership · scope · daily budget · rate limit · metering
```

- The platform is the **only client** of the Denis server. It logs in with one
  group (`DENIS_GROUP`/`DENIS_PASSWORD`) and administers projects with the
  server's main token (`DENIS_MAIN_TOKEN` → `ADMIN CREATE | QUOTA | USAGE |
  FLUSH | DROP`). Users never receive a Denis token; they get platform API keys.
- A **database** row maps a user to a Denis project token plus its limits.
  Every per-database page and route handler loads it with
  `getOwnedDatabase(userId, id)`, so another user gets a 404.
- **Quotas**: storage (keys and bytes) is enforced by the engine itself
  (`ADMIN QUOTA` at creation, the engine answers `code: "QUOTA"`); the daily
  command budget and the per-key rate limit are enforced by the gateway
  (`src/lib/databases.ts#runCommand`). Usage is sampled from `ADMIN USAGE` and
  stored per hour in `usage_samples` for the charts.
- **API keys** (`dk_…`) are shown once and stored as SHA-256; scope `read`
  or `write`. `POST /api/v1/token` exchanges a key for a short-lived access
  JWT (`JWT_SECRET`) and a refresh JWT (`JWT_REFRESH_SECRET`); revoking the
  key invalidates both.
- **MCP**: `POST /api/mcp` is a stateless Streamable HTTP server built per
  request with the caller's key (`src/lib/mcp/server.ts`). Tools:
  `denis_describe`, `denis_query`, `denis_get`, `denis_mget`, `denis_keys`,
  `denis_usage` and, for write keys, `denis_execute`, `denis_set`,
  `denis_delete`.

## Run it locally

```sh
# 1. a Denis server the platform can administer (any port; 5160 below)
docker run -d --name denis-dev -p 5160:5142 \
  -e DENIS_BOOTSTRAP_GROUP=platform -e DENIS_BOOTSTRAP_GROUP_PASSWORD=platform \
  -e DDB_MAIN_TOKEN=$(head -c 96 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 128) \
  -e DENIS_MAX_CONNECTIONS_PER_IP=256 denis:local
# 2. Postgres for the platform
docker run -d --name denis-platform-db -p 5441:5432 \
  -e POSTGRES_USER=denis -e POSTGRES_PASSWORD=denis -e POSTGRES_DB=denis_platform postgres:16-alpine
# 3. configure, migrate, run
cp .env.example .env            # set DENIS_MAIN_TOKEN to the token from step 1, DATABASE_URL to step 2
npm install
npx drizzle-kit push            # creates the tables
npm run dev                     # http://localhost:3000
```

`node scripts/smoke.mjs http://localhost:3000` runs an end-to-end check
(register → databases → console → API keys → REST → JWT → MCP → delete).

## Deploy (docker compose)

From the repository root:

```sh
cp web/.env.example .env.cloud     # fill every secret: openssl rand -base64 48
docker compose -f compose.cloud.yaml --env-file .env.cloud up -d --build
```

`compose.cloud.yaml` starts the Denis engine, Postgres and the web app on a
private network and publishes only the web app (`WEB_PORT`, default 3000);
the web container applies the schema on start (`DB_PUSH=1`). Terminate TLS in
front of it (Caddy: `denis.hacimertgokhan.com { reverse_proxy web:3000 }`).

## Environment

See [`.env.example`](.env.example). Required: `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (must differ),
`DENIS_GROUP`, `DENIS_PASSWORD`, `DENIS_MAIN_TOKEN` (128 chars),
`NEXT_PUBLIC_APP_URL`. Plan limits: `PLAN_MAX_DATABASES`,
`PLAN_DB_MAX_BYTES`, `PLAN_DB_MAX_KEYS`, `PLAN_DB_OPS_PER_DAY`,
`PLAN_API_RATE_PER_MINUTE`.

## Layout

```
src/app
  page.tsx                 landing (own palette in .landing, see globals.css)
  (auth)/login, register   better-auth email/password (+ GitHub when configured)
  (app)/                   signed-in shell: sidebar + header
    dashboard, databases, databases/[id]/{console,tables,keys,connect,settings}, usage, settings
  api/auth/[...all]        better-auth handler
  api/v1/databases…        session-authenticated management API
  api/v1/exec, token       API-key / JWT access for applications
  api/mcp                  hosted MCP endpoint
src/lib
  env.ts                   validated environment + plan()
  db/schema.ts             Drizzle schema (auth tables, databases, api_keys, usage_samples, audit_log)
  denis/client.ts          gateway to the engine: pooled clients, admin(), command classification
  databases.ts             create/delete/reset, usage sampling, metering, runCommand()
  api-keys.ts              keys, JWTs, rate limit
  mcp/server.ts            MCP tools over the gateway
src/components/app         shell, console, browsers, charts, dialogs
src/components/landing     nav, console demo, footer
```
