# Changelog

## 0.1.0 (unreleased)

### Storage
- New engine: in-memory keyspaces with one slot per key (cache value, durable value, TTL, LRU clock).
- Segmented write-ahead log with group commit (`fsync=always|everysec|no`), CRC32C per record,
  automatic repair of a torn last record after power loss.
- Non-blocking checkpoints to a compressed snapshot; old log segments are deleted, so disk usage
  stays proportional to the data, not to the write history.
- `max-memory` with cache-LRU eviction (or `noeviction`), TTLs, atomic `INCR`/`DECR`.
- Denis 0.0.x `database.bin` is imported once on first start.

### Performance (same machine, same tool, see `benchmarks/`)
- Cache writes 80k → 1.4M ops/s, reads with data on disk 6.5k → 1.1M ops/s,
  concurrent durable writes: 0.0.x failed and corrupted `database.bin`; now 1.1M ops/s without errors.
- SQL point query (1000 rows) 3.3k → 130k ops/s; with a PRIMARY KEY it is an index lookup.
- Jar 15.2 MB → 1.6 MB; container idles at ~35 MB RAM.

### Server
- Non-blocking I/O with a bounded worker pool; pipelined replies are written in one system call.
- Limits: `max-clients`, `max-connections-per-ip`, `max-line-size`, `client-output-limit`.
- New commands: `HELLO`, `WHOAMI`, `EXISTS`, `KEYS`, `MGET`, `INCR`, `DECR`, `EXPIRE`, `TTL`,
  `PERSIST`, `DBSIZE`, `DUMP`, `IMPORT`, `QUERY` (bound parameters), `PROJECTS`, `AUTH DELETE`,
  `INFO`, `SAVE`, `BACKUP`, `BACKUPS`. Replies of existing commands are unchanged in text mode.

### SQL (ANTLR grammar)
- JOIN (index / hash join), GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, DISTINCT, IN, BETWEEN, LIKE,
  IS NULL, CASE, arithmetic, scalar and aggregate functions, `JSON_EXTRACT`, `?` parameters.
- Typed columns, PRIMARY KEY, UNIQUE, NOT NULL, DEFAULT, CREATE/DROP INDEX, ALTER TABLE ADD COLUMN,
  TRUNCATE, UPSERT/REPLACE, SHOW TABLES/INDEXES, DESCRIBE, EXPLAIN. Tables are durable.

### Security
- PBKDF2-HMAC-SHA512 group passwords; 0.0.x hashes are upgraded on the next login.
- Login lockout per address, admin groups, project ownership, constant-time comparisons.
- Generated passwords are shown once and never written to disk (`pawd.dat` is gone).

### Operations
- `denis init` (with an IoT profile), one-line installers for Linux/macOS/Windows, systemd units.
- Online, SHA-256 verified backups with retention; `denis backup verify|restore`, `denis db verify|compact`.
- Multi-arch Docker image (amd64, arm64) on Alpine.

### Breaking changes
- `bind-address` defaults to `127.0.0.1`; set `0.0.0.0` to accept remote clients (the Docker image does).
- Data lives in `data/`; relative paths resolve against `DENIS_HOME`.
- Removed: per-run activity log (`use-delogg`, `open-log-terminal`), language files, `ddb-main-token`,
  `pawd.dat`, `start*.sh/bat`, `denis.conf`, the old setup tool.
