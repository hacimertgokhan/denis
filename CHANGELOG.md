# Changelog

All notable changes to Denis Database are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) from 0.3.0 on (`MAJOR.MINOR.PATCH`;
before 1.0.0 a minor bump may contain breaking changes, which are listed).

## [Unreleased]

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

[Unreleased]: https://github.com/hacimertgokhan/denis/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/hacimertgokhan/denis/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/hacimertgokhan/denis/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/hacimertgokhan/denis/compare/v0.0.2.9alpha...v0.3.0
