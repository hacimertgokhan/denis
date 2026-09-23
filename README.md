# Denis Database

Denis is a small, fast in-memory database for key-value data **and** SQL
tables, with real durability: a write-ahead log with group commit, compressed
non-blocking snapshots, crash recovery and verifiable online backups. One
1.6 MB jar, no external services; it runs on a server, a laptop or a
Raspberry Pi.

[![CI](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml/badge.svg)](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml)

- **Fast**: ~1.4 M ops/s pipelined on one machine, sub-millisecond p99;
  reads never touch the disk ([benchmarks](benchmarks/README.md)).
- **Durable**: `fsync=always|everysec|no`, CRC-checked log, torn-write repair,
  checkpoints that never block writers, disk use bounded by the data size.
- **SQL**: joins, GROUP BY/HAVING, ORDER BY/LIMIT, indexes, constraints,
  `EXPLAIN`, bound parameters ([SQL reference](docs/SQL.md)).
- **Cache features**: two layers per key (cache + durable), TTLs, atomic
  counters, `max-memory` with LRU eviction.
- **Safe by default**: listens on localhost, PBKDF2 passwords, login lockout,
  per-group projects, admin roles, limits on connections, lines and results.
- **Easy to run**: one-line installer, `denis init`, Docker (amd64/arm64),
  systemd units, **Denis Studio** desktop app, Node.js and Java clients.

## Quick start

```sh
curl -fsSL https://raw.githubusercontent.com/hacimertgokhan/denis/master/install.sh | sh   # Linux / macOS / Pi
#   Windows: irm https://raw.githubusercontent.com/hacimertgokhan/denis/master/install.ps1 | iex
denis server
```

The installer runs `denis init`, which prints the password of the `admin`
group once. Then, from any client (or `telnet localhost 5142`):

```
MODE json
LIN admin <password>
AUTH CREATE                        -> {"ok":true,"token":"..."}
AUTH <token>
SET greeting hello world -&save    -> durable
GET greeting                       -> {"ok":true,"key":"greeting","data":"hello world"}
SQL CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)
QUERY {"sql":"INSERT INTO users (name) VALUES (?)","params":["Ada"]}
SQL SELECT * FROM users
```

With Docker:

```sh
docker run -d --name denis -p 127.0.0.1:5142:5142 -v denis-data:/data \
  -e DENIS_BOOTSTRAP_GROUP=admin -e DENIS_BOOTSTRAP_GROUP_PASSWORD=change-me \
  ghcr.io/hacimertgokhan/denis
# or: cp .env.example .env && docker compose up -d
```

Build from source: `mvn package` (Java 17+) → `target/denis-<version>.jar`
and a release bundle in `target/`.

## Tools

| | |
| --- | --- |
| [**Denis Studio**](studio/) | Desktop app (Windows, macOS, Linux): connections, live dashboard, key browser/editor, SQL console with EXPLAIN, projects, backups and project export/import |
| [`clients/node`](clients/node) | Node.js client: pooled, pipelined, auto-reconnect, TypeScript types |
| [`java-driver`](java-driver) | Java client (Java 11+): thread-safe pool, pipelining, async API, zero dependencies |
| `denis` CLI | `init`, `server`, `backup create/list/verify/restore`, `db verify/compact`, `cli group …`, `cli token …`, `cli exec` |

## Documentation

- [Operations](docs/OPERATIONS.md): install, configuration, services, IoT tuning, backups, monitoring, upgrading from 0.0.x, security checklist
- [Wire protocol](docs/PROTOCOL.md): every command and reply
- [SQL](docs/SQL.md): language reference and performance tips
- [Architecture](docs/ARCHITECTURE.md): memory and disk layout, write path, checkpoints, recovery, networking
- [Benchmarks](benchmarks/README.md): how performance is measured and tracked
- [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

## Keys in 30 seconds

Every key has a **cache** value (memory only) and optionally a **durable**
value (logged, survives restarts). `SET k v` writes the cache; `SET k v -&save`
also the durable value; `GET` prefers the cache; `HEAVEN` drops all cache
values of a project; `-&ttl=<s>` / `EXPIRE` expire cache values. More:
`EXISTS KEYS MGET INCR DECR TTL PERSIST DBSIZE DUMP IMPORT`.

## Upgrading from 0.0.x

Existing `denis.toml`, `ddb.json` and `database.bin` are picked up: data is
imported once, passwords keep working (re-hashed on next login), text-mode
replies are unchanged. The server now listens on `127.0.0.1` by default. See
[Operations → Upgrading](docs/OPERATIONS.md#upgrading-from-00x) and the
[changelog](CHANGELOG.md).

## License

[Apache License 2.0](LICENSE)
