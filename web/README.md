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
  Every per-database page and route handler resolves the caller with
  `requestAccess(id, action)` (`src/lib/access.ts`): a stranger gets a 404,
  a member or database account gets exactly what its role allows.
- **Roles**: `owner` (the creator), `admin`, `editor`, `viewer`. Owners and
  admins share a database with other platform users by email
  (`database_members`) or create **database accounts** — a username and
  password that sign in at `/db/<id>/login`, see only that database in a
  workspace of their own (`/db/<id>/…`) and never touch the platform
  session. The role decides what the console, the API and MCP accept; the
  UI only hides what the server would refuse anyway.
- **Command history**: every command that reaches the engine is written to
  `command_log` with its actor (member, database account or API key), source
  (console, API, MCP), result and latency. `LIN`/`AUTH`/`ADMIN` lines are
  redacted and rows older than 30 days are pruned. The History tab pages
  through it with server-side `LIMIT/OFFSET` over the
  `(database_id, created_at)` index.
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

## System administration

Emails listed in `PLATFORM_ADMINS` are system administrators (promoted on
their next request; administrators can promote others from the UI). They get
`/admin` — platform totals next to the engine's own `INFO` and `ADMIN LIST`,
every user (role, suspension, per-user database allowance), every database
(limits pushed to the engine with `ADMIN QUOTA`, deletion), every database
account, the audit trail and the latest commands across all databases — and
the matching `/api/admin/*` routes. Authorization lives in
`src/lib/admin.ts#requireAdminApi` and `src/lib/session.ts#requireAdmin`,
which read the role from the database on every request instead of trusting
the session cookie; a suspended user is signed out on their next request.

## Security

- **Isolation and authorization**: one engine project per database; every
  request is resolved by `requestAccess()` / `requireAdminApi()` from the
  database, never from a cached claim.
- **Credentials**: scrypt password hashes, SHA-256 API key hashes shown once,
  15-minute access JWTs, httpOnly/SameSite/secure cookies.
- **Abuse limits** (`src/lib/rate-limit.ts`, better-auth rules): sign-in and
  sign-up, database-account sign-in (per address and per username), token
  exchange, console commands, management writes and account export/deletion
  are all rate limited; API keys have `PLAN_API_RATE_PER_MINUTE`.
- **Browser**: CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and COOP on every response (`next.config.ts`); a
  CSRF guard in `src/proxy.ts` refuses cross-site state changes on `/api/*`;
  JSON bodies must carry `application/json` and are capped at 256 KB; a
  command line is at most 64 KB.
- **Sign-up and password reset**: a honeypot field and a minimum time on
  the form are checked server-side (`src/lib/auth.ts#humanCheck`, headers
  `x-form-started` / `x-form-website`); Cloudflare Turnstile is added when
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` are set. "Forgot
  your password" mails a one-hour link through `SMTP_URL` (`src/lib/mail.ts`;
  without SMTP the link is printed to the server log); a reset signs out
  every other session.
- **Email** (`src/lib/mail.ts`): one template for every message (wordmark,
  text, footer with sender, reason and legal links). Transactional mail —
  six-digit codes to confirm an address after sign-up or to sign in without
  a password (better-auth `emailOTP`, hashed, 10 min, 5 attempts), password
  reset links — never carries an unsubscribe link. Product updates go only
  to accounts that opted in at sign-up or in Settings, with a signed
  one-click unsubscribe (`/api/mail/unsubscribe`, RFC 8058 headers), and
  are composed, previewed, test-sent and sent from `/admin/announcements`.
  Provider: Resend (`RESEND_API_KEY`, from `MAIL_FROM`), SMTP as fallback,
  the server log when neither is set. Secrets stay in `.env`; a pre-commit
  hook (`.githooks/pre-commit`, enabled with
  `git config core.hooksPath .githooks`) refuses staged live keys and .env files.
- **Backups** (`src/lib/backup.ts`): `GET /api/v1/databases/<id>/backup`
  downloads the whole database as a zip (`manifest.json`, `keys.json`,
  `tables/<name>.json`) for anyone who can read it; `POST` (multipart
  `file` + `mode=merge|replace`) restores one for owners and admins, replaying
  it as SET and INSERT through the gateway so quotas apply. Both in the
  database's Settings tab.
- **Account security**: an emailed six-digit code as second factor (Settings
  -> Sign-in code; better-auth `twoFactor` with backup codes, trusted
  devices) and a notice by mail whenever a browser the account has not used
  before opens a session (`databaseHooks.session.create.after`).
- **Data rights**: `GET /api/v1/me/export` (everything about the user as
  JSON) and `DELETE /api/v1/me` (account, databases, keys, sessions) from
  Settings → Your data. Command history is pruned after 30 days, the audit
  log after a year.
- Public policy pages: `/privacy` (GDPR), `/terms`,
  `/security` (with responsible disclosure), `/cookies`. The legal identity
  comes from `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`, `LEGAL_ADDRESS`.

## SEO

Site-wide metadata (`src/app/layout.tsx`: Open Graph, Twitter card, robots,
canonical), a generated share image (`src/app/opengraph-image.tsx`),
`sitemap.xml` and `robots.txt` (`src/app/sitemap.ts`, `robots.ts`), JSON-LD
(SoftwareApplication + FAQPage) on the landing, and `noindex` on every
signed-in area. English is the only language.

## Environment

See [`.env.example`](.env.example). Required: `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (must differ),
`DENIS_GROUP`, `DENIS_PASSWORD`, `DENIS_MAIN_TOKEN` (128 chars),
`NEXT_PUBLIC_APP_URL`. Plan limits: `PLAN_MAX_DATABASES`,
`PLAN_DB_MAX_BYTES`, `PLAN_DB_MAX_KEYS`, `PLAN_DB_OPS_PER_DAY`,
`PLAN_API_RATE_PER_MINUTE`. Administrators: `PLATFORM_ADMINS` (comma-separated
emails). Legal pages: `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`, `LEGAL_ADDRESS`. Mail:
`RESEND_API_KEY`, `SMTP_URL`, `MAIL_FROM`. Bot check: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET_KEY` (optional).

## Layout

```
src/app
  page.tsx                 landing (ruled frame with beams: components/landing/frame.tsx, .lf-* in globals.css)
  (legal)/privacy, terms, security, cookies   policy pages
  sitemap.ts, robots.ts, opengraph-image.tsx  SEO
  (auth)/login, login/code, register, verify-email, forgot-password, reset-password
                           better-auth email/password, email codes (+ GitHub when configured)
  (app)/                   signed-in shell: sidebar + header
    dashboard, databases, databases/[id]/{console,tables,keys,history,connect,access,settings}, usage, settings
    admin/{users,databases,accounts,activity,announcements}   system administration (PLATFORM_ADMINS)
  db/[id]/login, db/[id]/…  the workspace a database account sees (own session cookie per database)
  api/auth/[...all]        better-auth handler
  api/v1/databases…        management API for platform users and database accounts (members, accounts, history…)
  api/db/[id]/login|logout database-account sign-in
  api/admin/…              system administration
  api/v1/exec, token       API-key / JWT access for applications
  api/mcp                  hosted MCP endpoint
src/lib
  env.ts                   validated environment + plan()
  db/schema.ts             Drizzle schema (auth tables, databases, api_keys, usage_samples, audit_log,
                           database_members, database_accounts, command_log)
  access.ts                roles, members, database accounts, requestAccess()
  admin.ts                 system administration queries and guards
  denis/client.ts          gateway to the engine: pooled clients, admin(), command classification
  databases.ts             create/delete/reset, usage sampling, metering, runCommand()
  api-keys.ts              keys, JWTs, rate limit
  mcp/server.ts            MCP tools over the gateway
src/components/app         shell (left + right sidebar), console, browsers, data-table, admin views, dialogs
src/content/updates.ts     product updates shown in the right sidebar
src/components/landing     nav, console demo, footer
```
