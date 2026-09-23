# Denis Database

Denis is a small, fast in-memory database for key-value data **and** SQL
tables, with real durability: a write-ahead log with group commit, compressed
non-blocking snapshots, crash recovery and verifiable online backups. One
1.6 MB jar, no external services; it runs on a server, a laptop or a
Raspberry Pi. It ships with Node.js and Java clients, a desktop app, a
management CLI, a Docker image, an MCP server for AI assistants and a hosted
platform (Denis Cloud).

[![CI](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml/badge.svg)](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/hacimertgokhan/denis?include_prereleases)](https://github.com/hacimertgokhan/denis/releases)

- **Fast**: ~1.5–1.9 M ops/s pipelined on one machine, sub-millisecond p99;
  reads never touch the disk ([benchmarks](benchmarks/README.md)).
- **Durable**: `fsync=always|everysec|no`, CRC-checked log, torn-write repair,
  checkpoints that never block writers, disk use bounded by the data size.
- **SQL**: joins, GROUP BY/HAVING, ORDER BY/LIMIT, indexes, constraints,
  `EXPLAIN`, bound parameters ([SQL reference](docs/SQL.md)), plus `QUERY { ... }`
  documents that read keys and tables in one round trip.
- **Cache features**: two layers per key (cache + durable), TTLs, atomic
  counters, `max-memory` with LRU eviction.
- **Multi-tenant**: projects (tokens) behind group logins, per-project quotas,
  `ADMIN` commands for provisioning.
- **Safe by default**: listens on localhost, PBKDF2 passwords, login lockout,
  per-group projects, admin roles, limits on connections, lines and results.
- **Easy to run**: one-line installer, `denis init`, Docker (amd64/arm64),
  systemd units, **Denis Studio** desktop app.

```
                 ┌──────────────────────────────────────────────┐
  Node client ──►│  Denis server (TCP :5142, non-blocking I/O)  │
  Java driver ──►│  LIN group ─► AUTH project ─► GET/SET/SQL    │
  Denis Studio ─►│  keyspaces in memory: cache + durable values │──► data/wal/     (group commit)
  denis cli   ──►│  SQL tables with ordered indexes             │──► data/snapshot.dat
  MCP server  ──►│  ADMIN: projects, quotas                     │──► data/backups/
  Denis Cloud    └──────────────────────────────────────────────┘
```

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
QUERY { greeting: get("greeting") n: count("users") }
```

Or with the CLI against the running server:

```sh
denis cli exec -g admin -p <password> --create-project \
  "SET greeting hello world -&save" "GET greeting" \
  "CREATE TABLE users (id INT PRIMARY KEY, name TEXT)" \
  "INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Grace')" \
  "SELECT * FROM users ORDER BY id"
```

### Docker

```sh
docker run -d --name denis -p 127.0.0.1:5142:5142 -v denis-data:/data \
  -e DENIS_BOOTSTRAP_GROUP=admin -e DENIS_BOOTSTRAP_GROUP_PASSWORD=change-me \
  ghcr.io/hacimertgokhan/denis
# or: cp .env.example .env && docker compose up -d
docker exec denis /app/entrypoint.sh cli status
```

Released images are published to `ghcr.io/hacimertgokhan/denis:<version>` and
`:latest` (amd64, arm64). The image runs as a non-root user on Alpine, keeps
all runtime state in the `/data` volume, has a `HEALTHCHECK` that sends `PING`
and checkpoints on `SIGTERM`. Any CLI command runs against the same data with
`docker exec denis /app/entrypoint.sh cli ...`.

### From source

`mvn package` (Java 17+) → `target/denis-<version>.jar` and release bundles
(`.zip`, `.tar.gz`) in `target/`.

## Tools

| | |
| --- | --- |
| [**Denis Studio**](studio/) | Desktop app (Windows, macOS, Linux): connections, live dashboard, key browser/editor, SQL console with EXPLAIN, projects, backups and project export/import |
| [`clients/node`](clients/node) | Node.js client (`denis-client`): pooled, pipelined, auto-reconnect, TypeScript types; `DenisCloud` for the hosted REST gateway |
| [`java-driver`](java-driver) | Java client (Java 11+): thread-safe pool, pipelining, async API |
| [`clients/mcp`](clients/mcp) | MCP server for AI assistants |
| [`web/`](web) | Denis Cloud, the hosted platform (`compose.cloud.yaml`) |
| [`examples/`](examples) | Stockroom, an inventory app built on Denis |
| `denis` CLI | `init`, `server`, `backup create/list/verify/restore`, `db verify/compact`, `cli group …`, `cli token …`, `cli status/exec/shell/config` |

## CLI

`denis cli` manages local files (groups, tokens, config) and talks to a
running server (status, exec, shell). Remote commands accept
`-H/--host`, `-P/--port`, `-g/--group`, `-p/--password`, `-t/--token`,
`--create-project` and `--json`, or the environment variables `DENIS_HOST`,
`DENIS_PORT`, `DENIS_GROUP`, `DENIS_PASSWORD`, `DENIS_TOKEN`.

```sh
denis cli group create crm            # prints a generated password once
denis cli group list | test crm s3cret | delete crm
denis cli token list | create | delete <token>
denis cli config                      # effective configuration and where each value comes from

denis cli status -g crm -p s3cret     # PING + INFO
denis cli exec -g crm -p s3cret -t <token> "GET greeting" "SELECT COUNT(*) FROM users"
denis cli exec ... --json "INFO"      # raw JSON replies for scripts
denis cli shell -g crm -p s3cret -t <token>   # interactive; .help, .json on, .exit
```

Replies are rendered as tables/lists; the exit code is 1 when any command failed.

## Keys in 30 seconds

Every key has a **cache** value (memory only) and optionally a **durable**
value (logged, survives restarts). `SET k v` writes the cache; `SET k v -&save`
also the durable value; `GET` prefers the cache; `HEAVEN` drops all cache
values of a project; `-&ttl=<s>` / `EXPIRE` expire cache values. More:
`EXISTS KEYS MGET INCR DECR TTL PERSIST DBSIZE DUMP IMPORT`.

One line in, one line out, UTF-8. `MODE json` switches a connection to exactly
one JSON object per reply (`{"ok":true,...}` / `{"ok":false,"code":...,"error":...}`),
which is what every client uses; text-mode replies of 0.0.x are unchanged.
Full reference: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## AI / MCP

[`clients/mcp`](clients/mcp) is an MCP server (`denis-mcp-server`) that gives
an AI assistant a safe, schema-first way to work with Denis: `denis_describe`
returns the tables, columns and keys; `denis_query` runs read-only SQL;
`denis_execute`, `denis_set` and `denis_delete` write (hidden with
`DENIS_READ_ONLY=1`). Resources `denis://schema`, `denis://protocol` and
`denis://table/{name}` expose the same information.

```json
{
  "mcpServers": {
    "denis": {
      "command": "node",
      "args": ["/path/to/denis/clients/mcp/src/index.js"],
      "env": { "DENIS_GROUP": "crm", "DENIS_PASSWORD": "s3cret", "DENIS_TOKEN": "<project token>" }
    }
  }
}
```

## Denis Cloud (hosted)

[`web/`](web) is the platform behind **denis.hacimertgokhan.com**: sign up,
create databases, use them from a web console, a REST API with API keys and
JWTs, or a hosted MCP endpoint. Storage and key quotas are enforced by the
engine (`ADMIN QUOTA`), command budgets and rate limits by the platform.
Deploy the whole stack (engine + PostgreSQL + web) with `compose.cloud.yaml`;
details in [web/README.md](web/README.md). The engine side is the `ADMIN`
command family (main-token authenticated project create/import/usage/quota/flush/drop)
documented in [docs/PROTOCOL.md](docs/PROTOCOL.md#admin).

## Configuration

`denis.properties` (created by `denis init`, documented key by key) is read
from `DENIS_HOME`. Every key can also be set from the environment: upper-case
it, replace `-` with `_` and prefix `DENIS_` (`ddb-*` keys also without the
prefix). Environment beats the file, which beats the bundled defaults;
`denis cli config` shows the effective values. The most used keys:

| Property | Default | Meaning |
| --- | --- | --- |
| `bind-address` | `127.0.0.1` | interface to listen on (`0.0.0.0` for remote clients) |
| `ddb-port` | `5142` | TCP port |
| `ddb-main-token` | generated | main token for `ADMIN` commands, written to `denis.properties` on first start when empty |
| `fsync` | `everysec` | `always`, `everysec` or `no` |
| `max-memory` | `0` | e.g. `256mb`; evicts cache values (never durable ones) |
| `max-clients` / `max-connections-per-ip` | `10000` / `64` | connection limits |
| `backup-interval-minutes` / `backup-retention` | `0` / `7` | automatic online backups |
| `bootstrap-group` / `bootstrap-group-password` | — | admin group created on start-up (containers) |

The 0.3-0.6 keys `max-connections`, `client-idle-timeout-ms`,
`persist-flush-interval-ms` and `persist-snapshot-interval-ms` still work.
All keys: [Operations](docs/OPERATIONS.md).

## Documentation

- [Operations](docs/OPERATIONS.md): install, configuration, services, IoT tuning, backups, monitoring, upgrading, security checklist
- [Wire protocol](docs/PROTOCOL.md): every command and reply
- [SQL](docs/SQL.md): language reference and performance tips
- [Architecture](docs/ARCHITECTURE.md): memory and disk layout, write path, checkpoints, recovery, networking
- [Benchmarks](benchmarks/README.md): how performance is measured and tracked between versions;
  [docs/BENCHMARKS.md](docs/BENCHMARKS.md): comparison with Redis 7 and PostgreSQL 16 (harness in [`bench/`](bench))
- [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

## Upgrading

From 0.3-0.6 or 0.0.x: existing `denis.toml`, `ddb.json` (tokens and quotas)
and `database.bin` + `database.journal` are picked up. Data, SQL tables
included, is imported once into the new log and the old files are kept as
`*.migrated`; passwords keep working (re-hashed on next login); json replies
only gained fields. The server now listens on `127.0.0.1` by default. See
[Operations → Upgrading](docs/OPERATIONS.md#upgrading) and the
[changelog](CHANGELOG.md).

## Versioning and releases

Denis follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`,
tags `vX.Y.Z`. Until 1.0.0 a minor release may contain breaking changes, which
are listed under **Breaking** in [CHANGELOG.md](CHANGELOG.md). Client packages
have their own versions (`clients/node`, `clients/mcp`, `java-driver`).
Releasing is described in [CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## License

[Apache License 2.0](LICENSE)
