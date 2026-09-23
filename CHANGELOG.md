# Changelog

All notable changes to Denis Database are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) from 0.3.0 on (`MAJOR.MINOR.PATCH`;
before 1.0.0 a minor bump may contain breaking changes, which are listed).

## [Unreleased]

### Added
- Platform: an Examples tab per database — connecting from Node, Python, curl and Go, keys, tables, QUERY, the users/sessions/counter/cache patterns, MCP, backups and errors, every snippet with the database's own URL.
- `examples/inventory`: Stockroom, a stock-keeping app with accounts,
  sessions, products and movements all kept in Denis through `denis-client`
  (TCP or Denis Cloud), with an end-to-end test.
- Platform: "Forgot your password" with a one-hour mailed link (SMTP through
  `SMTP_URL`, or the server log without it) and a reset page that signs out
  other sessions; bot protection on sign-up and reset requests (honeypot and
  minimum form time checked server-side, optional Cloudflare Turnstile).
- Platform: email through Resend (SMTP fallback) with one formal template;
  six-digit codes confirm the address after sign-up and sign people in
  without a password (`/login/code`); product updates are opt-in with a
  signed one-click unsubscribe and are sent from `/admin/announcements`.
- Platform: database backups as a zip (download for readers, merge or
  replace restore for owners and admins).
- Platform: emailed sign-in code as a second factor with backup codes and
  trusted devices; a mail notice for every sign-in from a new browser.
- Repository: a pre-commit hook that refuses staged live secrets and .env files.
- Platform: softer aurora on the sign-in pages; the architecture diagram no
  longer draws a line through the project boxes.

### Security
- Platform: bound SQL (`QUERY {"sql": ...}`) is classified by its statement, so read-only API keys
  cannot write through it; `PROJECTS`, `WHOAMI`, `BACKUP` and `BACKUPS` are refused by the gateway.
- Platform: backup restore refuses zip bombs (declared-size caps, at most 500 entries), validates column names and types against an allowlist and bounds key and value sizes; the keys browser validates keys, values and patterns before anything reaches the wire.

### Fixed
- Platform: the admin page lists the engine's projects again (`engineProjects()` read the wrong shape).

## [0.7.0] - 2026-09-23

A new storage engine, network layer and SQL engine under the 0.6 protocol.
Every command, reply shape, `ADMIN` command, quota and `QUERY` document of
0.6.1 keeps working (`CompatibilityTest`); data written by 0.3-0.6
(`database.bin` + `database.journal`, SQL tables included) is imported on the
first start and the old files are kept as `*.migrated`.

### Storage
- In-memory keyspaces with one slot per key (cache value, durable value, TTL, LRU clock).
- Segmented write-ahead log with group commit (`fsync=always|everysec|no`), CRC32C per record,
  automatic repair of a torn last record after power loss. Replaces the JSON journal.
- Non-blocking checkpoints to a compressed snapshot; old log segments are deleted, so disk usage
  stays proportional to the data, not to the write history.
- `max-memory` with cache-LRU eviction (or `noeviction`), TTLs, atomic `INCR`/`DECR`.
- Quotas (`maxKeys`, `maxBytes`) are enforced by the engine for keys and table rows.

### Performance (same machine, same tool, see `benchmarks/`)
- Against 0.6.1: cache writes 108k → 1.9M ops/s, reads 120k → 1.5M ops/s, durable writes 47k → 1.3M ops/s,
  unpipelined clients 73k → 198k ops/s, SQL point queries 128k → 218k ops/s.
- Against 0.0.2.9: cache writes 80k → 1.9M ops/s, reads with data on disk 6.5k → 1.5M ops/s,
  concurrent durable writes: 0.0.x failed and corrupted `database.bin`; now 1.3M ops/s without errors.
- SQL point query (1000 rows) 3.3k → 218k ops/s; with a PRIMARY KEY it is an index lookup.
- Jar 15.2 MB → 1.6 MB; container idles at ~35 MB RAM.

### Server
- Non-blocking I/O (1-8 event loops) with a bounded worker pool; pipelined replies are written in
  one system call.
- Limits: `max-clients` (alias `max-connections`), `max-connections-per-ip`, `max-line-size`,
  `client-output-limit`.
- New commands: `HELLO`, `WHOAMI`, `INCR`, `DECR`, `EXPIRE`, `TTL`, `PERSIST`, `DBSIZE`, `DUMP`,
  `IMPORT`, `PROJECTS`, `AUTH DELETE`, `BACKUP`, `BACKUPS`; `QUERY {"sql":..,"params":[..]}` runs
  bound SQL next to the `QUERY { ... }` document.

### SQL (ANTLR grammar)
- JOIN (index / hash join), GROUP BY, HAVING, DISTINCT, IN, BETWEEN, CASE, arithmetic, scalar and
  aggregate functions, `JSON_EXTRACT`, `?` parameters.
- Typed columns, PRIMARY KEY, UNIQUE, NOT NULL, DEFAULT, CREATE/DROP INDEX, ALTER TABLE ADD COLUMN,
  TRUNCATE, UPSERT/REPLACE, SHOW INDEXES, EXPLAIN. Indexes are ordered (range scans, ORDER BY ... LIMIT).

### Security
- PBKDF2-HMAC-SHA512 group passwords; older hashes are upgraded on the next login.
- Login lockout per address (wrong `ADMIN` tokens count too), admin groups, project ownership,
  constant-time token comparisons; the main token is never logged.
- An empty `ddb-main-token` is generated on first start and written to `denis.properties`.
- Generated passwords are shown once and never written to disk (`pawd.dat` is gone).

### Operations
- `denis init` (with an IoT profile), one-line installers for Linux/macOS/Windows, systemd units.
- Online, SHA-256 verified backups with retention; `denis backup verify|restore`, `denis db verify|compact`.
- Multi-arch Docker image (amd64, arm64) on Alpine.
- Denis Studio, a desktop app (Windows, macOS, Linux) for keys, SQL, projects, groups and backups.
- Java driver 2.1.0 and Node client `denis-client` 1.1.0: connection pools, pipelining, typed replies,
  `admin(mainToken)`, quotas, `graph(document)` and every new command; the 0.3-0.6 APIs keep working.

### Breaking
- `bind-address` defaults to `127.0.0.1`; set `0.0.0.0` to accept remote clients (the Docker image does).
- Data lives in `data/`; relative paths resolve against `DENIS_HOME`.
- `compose.yaml` requires `DENIS_BOOTSTRAP_GROUP_PASSWORD` (no default password).
- The bootstrap group is an admin group (an existing group of that name is promoted).
- Removed: Log4j (java.util.logging now), protobuf, language files, the per-run activity log
  (`use-delogg`, `open-log-terminal`), `pawd.dat`, `start*.sh/bat`, `denis.conf`, the old setup tool.
  `persist-flush-interval-ms`, `persist-snapshot-interval-ms` and `client-idle-timeout-ms` still work
  and map to `fsync`, `checkpoint-interval-seconds` and `client-timeout-seconds`.
- The Java class layout changed again (`StorageEngine`, `Session`); code embedding the server
  classes must be updated.
## [0.6.1] - 2026-09-21

### Added
- `ADMIN <main-token> IMPORT <token> [maxKeys maxBytes]`: register a project
  token issued elsewhere, idempotently. A platform that still holds tokens the
  engine lost (a data-less container restart, an older backup) restores them
  instead of failing with "Cannot auth with". `denis-client` exposes it as
  `admin.import(token, quota)`.

### Fixed
- Platform: a database whose project is missing from the engine is
  re-registered with its limits and the command retried once, for commands
  and usage sampling alike.
- Platform: a static geometric mark and a matching favicon; the navigation
  is one quiet row.

## [0.6.0] - 2026-09-21

### Added
- **`QUERY`: one round trip, many reads.** A GraphQL-shaped document
  (`QUERY { user: get("user:1") { name } orders: table("orders", where: "user_id = 1", limit: 5) { id total } n: count("orders") }`)
  is parsed and resolved inside the engine: `get`, `mget`, `prefix`,
  `keys`, `exists`, `count`, `table`, `sql` (SELECT only), `tables`,
  `describe`. Selections parse stored JSON and keep only the requested
  fields, or become the SELECT list of a table; a failing field is `null`
  with an entry in `errors` while the others resolve
  (`github.hacimertgokhan.denis.query`). Documented in docs/PROTOCOL.md;
  `denis-client` gets `graph(document)` and the hosted MCP server
  `denis_graph`.
- `denis-client` 0.5.0: `DenisCloud`, the same key-value / SQL API over the
  Denis Cloud REST gateway with an API key (optional JWT exchange, `batch()`,
  `usage()`, `whoami()`). The TCP client and the cloud client share the
  `DenisCommands` base.
- Platform: `GET /api/v1/usage` returns usage and limits for the database behind
  an API key or access token.
- Platform: privacy policy (GDPR), terms of service, security page
  with responsible disclosure, cookie page; sign-up consent; account data export
  and deletion from Settings.
- Platform: sitemap, robots, Open Graph image, JSON-LD and page metadata.

### Security
- Platform: CSRF guard for cross-site `/api/*` state changes, JSON-only bodies
  capped at 256 KB, 64 KB command lines, CSP/HSTS/frame/referrer/permissions
  headers, rate limits on database-account sign-in, token exchange, console
  commands, management writes and account export/deletion; better-auth rate
  limiting on in every environment; password length bounded at 128.

## [0.5.0] - 2026-09-21

### Added
- **Denis Cloud** (`web/`): a hosted-database platform on Next.js 16 with
  better-auth, Drizzle/PostgreSQL and shadcn/ui. Accounts, up to three
  databases each, a web console, table and key browsers, usage charts and
  quotas, per-database API keys with JWT exchange, a REST API
  (`/api/v1/exec`) and a hosted MCP endpoint (`/api/mcp`). Deployed with
  `compose.cloud.yaml`; see `web/README.md`.
- **Server: per-project usage accounting, quotas and `ADMIN` commands.** The
  server counts keys and characters per project (cache and persisted store),
  stores optional limits in `ddb.json` and refuses writes that would exceed
  them with `{"ok":false,"code":"QUOTA","resource":"keys|bytes","limit":n}`.
  The main token authenticates `ADMIN LIST | CREATE [maxKeys maxBytes] |
  USAGE | QUOTA | FLUSH | DROP`. `INFO` reports the project's usage and quota.
- Node client 0.4.0: `admin(mainToken)` with `list/create/usage/quota/flush/drop`.

## [0.4.0] - 2026-09-21

The three improvements the 0.3.1 benchmark asked for.

### Added
- **Append-only journal** (`database.journal`): every persisted change is
  appended and handed to the OS at once, fsynced every
  `persist-flush-interval-ms` (1 s) and replayed at start-up. A killed process
  loses nothing; a power loss loses at most one fsync window — the same
  guarantee as Redis `appendfsync everysec`. Full `database.bin` snapshots now
  happen every `persist-snapshot-interval-ms` (30 s) while dirty, on `SAVE` and
  on shutdown, instead of every second; an interrupted snapshot is recovered
  from `database.journal.old`.
- **In-memory SQL tables with a hash index on every column** (`Table`,
  `TableCatalog`): rows are kept parsed and `WHERE col = value` in an AND-only
  clause is an index lookup for SELECT, UPDATE and DELETE; `COUNT(*)` without
  WHERE is O(1). Tables are built
  from the store on first use and shared by all connections. Raw key commands
  on `__sql:` keys invalidate the loaded table.
- **Reply batching**: replies to pipelined commands are flushed in one write
  when the client has more input queued.

### Changed
- Log4j 2.25.5, protobuf 4.33.0 (Dependabot).
- `persist-flush-interval-ms=0` now means "fsync the journal on every change"
  (the snapshot is written on `SAVE`/shutdown) instead of rewriting the whole
  file per change.

## [0.3.1] - 2026-09-21

### Fixed
- **Server accepted only 4 concurrent connections.** The worker pool used an
  unbounded queue, so `ThreadPoolExecutor` never grew past its core threads and
  every further connection waited for a free worker (the handshake hung).
  Found by the new benchmark suite; the pool now uses a `SynchronousQueue` and
  grows to `max-connections`. The server test now opens 12 clients at once.

### Added
- `bench/`: reproducible benchmarks against Redis 7 (key-value) and
  PostgreSQL 16 (SQL) with identical container limits; results and analysis in
  `docs/BENCHMARKS.md`.
- Node client 0.3.0: **pipelining** (default on) — several commands in flight
  per connection, replies matched in order; `pipeline: false` restores one
  command per connection. Roughly 4-5x more throughput at high concurrency.

## [0.3.0] - 2026-09-21

The first release under Semantic Versioning (the previous tag was
`v0.0.2.9alpha`). The server core was rewritten around an in-memory storage
engine, the wire protocol gained structured replies, the CLI was redone, and an
MCP server lets AI assistants inspect and query the database.

### Added
- **Protocol commands**: `EXISTS`, `KEYS [pattern]`, `MGET`, `INFO`, `SAVE`,
  `HELP` (machine-readable in json mode). See `docs/PROTOCOL.md`.
- **SQL**: `SHOW TABLES`, `DESCRIBE <table>`, `COUNT(*)`, `ORDER BY`,
  `LIMIT`/`OFFSET`, multi-row `INSERT`, `CREATE TABLE IF NOT EXISTS`,
  `DROP TABLE IF EXISTS`, `WHERE` with `!= <> < <= > >= LIKE IS NULL IS NOT NULL`
  and `AND`/`OR`. Tables are now **persisted** to `database.bin` and survive a
  restart.
- **Structured SQL replies** in json mode:
  `{"type":"rows","columns":[..],"rows":[..],"count":n}`,
  `{"type":"affected","affected":n,"message":".."}`,
  `{"type":"tables","tables":[..]}`.
- **MCP server** (`clients/mcp`, `denis-mcp-server`): tools `denis_describe`,
  `denis_query`, `denis_execute`, `denis_get`, `denis_set`, `denis_delete`,
  `denis_keys`, `denis_mget`, `denis_info`; resources `denis://schema`,
  `denis://protocol`, `denis://table/{name}`; prompt `denis_analyze`;
  `DENIS_READ_ONLY=1` hides every writing tool.
- **CLI** (`denis cli`): `status`, `exec "<command>" ...`, `shell`, `config`,
  `group delete`, `token create|list|delete`; every remote command takes
  `--host/--port/--group/--password/--token` or the `DENIS_*` environment
  variables and `--json` for raw replies. Results render as tables.
- **Configuration**: `bind-address`, `max-connections`,
  `client-idle-timeout-ms`, `persist-flush-interval-ms`, `DENIS_LOG_LEVEL`.
- Node client 0.2.0: `exists`, `keys`, `mget`, `info`, `save`, `help`, `query`,
  `execute`, `tables`, `describe`; TypeScript typings for all replies.
- Java driver 1.2.0: `exists`, `keys`, `mget`, `info`, `save`, `query`,
  `execute`, `tables`.
- Release workflow: a `v*` tag builds the jar and bundle, publishes
  `ghcr.io/<owner>/denis:<version>` and creates the GitHub Release from this
  changelog. `docs/PROTOCOL.md` documents the wire protocol.

### Changed
- **Storage engine**: `database.bin` is loaded once and kept in memory; writes
  mark it dirty and a background thread flushes atomically (temp file + rename)
  every `persist-flush-interval-ms` (default 1 s, `0` = synchronous). Before,
  every `GET` parsed the whole file and every `SET -&save` rewrote it without
  locking. Old files are migrated to the new key layout on first load.
- The cache is warmed with every persisted key at start-up; `AUTH` no longer
  reads the file.
- Project tokens (`ddb.json`) are loaded once and shared by all connections; a
  token created on one connection is usable on every other one immediately.
- Connection handling moved to `DenisServer`: bounded worker pool
  (`max-connections`), atomic per-IP accounting, `TCP_NODELAY`, optional idle
  timeout, graceful shutdown that flushes the store. UTF-8 is used explicitly on
  the socket.
- An exception inside a command now answers `{"ok":false,"error":"internal
  error: ..."}` instead of dropping the connection.
- Logging: root level `info` (was `debug`), console output on **stderr**, a
  rolling `logs/denis.log`; the CLI logs at `warn` so stdout stays parseable.
- Log messages and code comments are in English.
- Dependencies: removed unused Netty, Jackson and commons-exec; Log4j 2.24.3,
  picocli 4.7.6, org.json 20250107.
- Dockerfile: OCI labels with the version, `STOPSIGNAL SIGTERM`,
  `-XX:+ExitOnOutOfMemoryError`; Compose: `init`, `stop_grace_period`, all
  connection/persistence settings exposed as variables.

### Removed
- Dead code: `Telnet`/`ProtocolHandler`, `ConnectionInfo`,
  `ThreadPoolCalculator`, `Authories`, `pointers.Token`,
  `SecureHardwareTokenGenerator`, `MacAnalyzer`, `ReadProtoFile`,
  `Access`/`Accessibility`, the legacy interactive `--access`/`--opt` shell.
- Properties `max-token-size`, `mac-address`, `use-token`,
  `change-token-on-every-new-client-session`,
  `ask-token-on-every-new-client-session` (never read by the server).

### Breaking
- In json mode `SQL` replies no longer carry the result as a string in
  `data`; use the structured fields above. Text mode is unchanged.
- The Node client's `sql()` returns the structured result object; use
  `query()` / `execute()` for rows / affected counts. The Java driver's `sql()`
  returns a `JSONObject`.
- The Java class layout changed (`ServerContext`, `ProjectStore`,
  `DenisServer`, `ProjectRegistry`); anything embedding the server classes
  directly must be updated.

[Unreleased]: https://github.com/hacimertgokhan/denis/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/hacimertgokhan/denis/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/hacimertgokhan/denis/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/hacimertgokhan/denis/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/hacimertgokhan/denis/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/hacimertgokhan/denis/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/hacimertgokhan/denis/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/hacimertgokhan/denis/compare/v0.0.2.9alpha...v0.3.0

