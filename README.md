# Denis Database

Denis is a small Java key-value server in the spirit of Redis, with a SQL
subset and an MCP server for AI assistants. Keys live in an in-memory cache and
can be persisted to a protobuf file; they are grouped into projects (tokens)
behind a group login. Denis speaks a line protocol over TCP and ships with
Node.js and Java clients, a management CLI, a Docker image and an MCP server.

[![CI](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml/badge.svg)](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/hacimertgokhan/denis?include_prereleases)](https://github.com/hacimertgokhan/denis/releases)

```
                 ┌────────────────────────────────────────────┐
  Node client ──►│  Denis server (TCP :5142)                  │
  Java driver ──►│  LIN group ─► AUTH project ─► GET/SET/SQL  │
  denis cli   ──►│  cache (ConcurrentHashMap)                 │──► database.bin
  MCP server  ──►│  + persisted keys + SQL tables             │    (write-behind, atomic)
  AI assistant   └────────────────────────────────────────────┘
```

## Contents

- [Quick start](#quick-start)
- [Docker](#docker)
- [CLI](#cli)
- [Wire protocol](#wire-protocol)
- [SQL](#sql)
- [AI / MCP](#ai--mcp)
- [Denis Cloud (hosted)](#denis-cloud-hosted)
- [Client libraries](#client-libraries)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Benchmarks](#benchmarks)
- [Versioning and releases](#versioning-and-releases)

## Quick start

Requirements: Java 17+ (Maven to build from source; Node 18+ for the Node
client and the MCP server).

```sh
mvn package                                   # target/denis-0.6.0.jar (+ project bundle zip/tar.gz)
java -jar target/denis-0.6.0.jar cli group create crm -p s3cret
java -jar target/denis-0.6.0.jar server       # listens on 0.0.0.0:5142
```

In a second terminal:

```sh
java -jar target/denis-0.6.0.jar cli exec -g crm -p s3cret --create-project \
  "SET greeting hello world -&save" "GET greeting" \
  "CREATE TABLE users (id INT, name TEXT)" \
  "INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Grace')" \
  "SELECT * FROM users ORDER BY id"
```

```
Ok (Protobuf)
hello world
OK: table created
OK: 2 rows inserted
id | name
---+------
1  | Ada
2  | Grace
(2 row(s))
```

### Install from a release

Download `denis-<version>-project-bundle.zip` / `.tar.gz` from
[Releases](https://github.com/hacimertgokhan/denis/releases), extract, then:

```sh
sh install.sh        # Windows: install.bat
denis --help
denis server
denis cli --help
```

Runtime files are kept next to the installed app: `denis.properties`,
`denis.toml` (groups), `ddb.json` (project tokens), `pawd.dat`,
`database.bin` + `database.journal` (persisted keys and tables), `logs/` and the per-run activity
log in `denis/`. None of them belong in version control.

## Docker

```sh
docker build -t denis .
docker run -d --name denis -p 5142:5142 -v denis-data:/data \
  -e DENIS_BOOTSTRAP_GROUP=crm -e DENIS_BOOTSTRAP_GROUP_PASSWORD=s3cret \
  denis
```

or with Compose (`cp .env.example .env`, edit, then):

```sh
docker compose up -d
docker compose exec denis /app/entrypoint.sh cli status
docker compose exec denis /app/entrypoint.sh cli token create
docker compose exec denis /app/entrypoint.sh cli exec -g crm -p s3cret -t <token> "SELECT * FROM users"
```

Released images are published to `ghcr.io/hacimertgokhan/denis:<version>` and
`:latest`. The image is a multi-stage build (Maven → `eclipse-temurin:17-jre`),
runs as a non-root user, keeps all runtime state in the `/data` volume, has a
`HEALTHCHECK` that sends `PING`, and flushes `database.bin` on `SIGTERM`. Any
CLI command can be run against the same data with
`docker exec denis /app/entrypoint.sh cli ...`.

## CLI

`denis cli` manages local files (groups, tokens, config) and talks to a
running server (status, exec, shell). Remote commands accept
`-H/--host`, `-P/--port`, `-g/--group`, `-p/--password`, `-t/--token`,
`--create-project` and `--json`, or the environment variables `DENIS_HOST`,
`DENIS_PORT`, `DENIS_GROUP`, `DENIS_PASSWORD`, `DENIS_TOKEN`.

```sh
denis cli group create crm            # prints a generated password
denis cli group create crm -p s3cret  # chosen password (stored hashed)
denis cli group list | test crm s3cret | delete crm
denis cli token list | create | delete <token>
denis cli config                      # effective configuration and where each value comes from

denis cli status                      # PING
denis cli status -g crm -p s3cret     # + INFO
denis cli exec -g crm -p s3cret -t <token> "GET greeting" "SELECT COUNT(*) FROM users"
denis cli exec ... --json "INFO"      # raw JSON replies for scripts
denis cli shell -g crm -p s3cret -t <token>   # interactive; .help, .json on, .exit
```

Replies are rendered as tables/lists; exit code is 1 when any command failed.

## Wire protocol

One line in, one line out, UTF-8. `MODE json` switches a connection to exactly
one JSON object per reply (`{"ok":true,...}` / `{"ok":false,"error":...}`),
which is what every client uses. Full reference: [docs/PROTOCOL.md](docs/PROTOCOL.md).

```
PING                          -> PONG (no login needed)
MODE json | MODE text         reply format for this connection
HELP                          every command with usage (JSON array in json mode)
LIN <group> <password>        log in with a group from denis.toml
AUTH CREATE | AUTH <token>    create / select a project (key namespace)
INFO                          version, uptime, connections, key counts, memory

GET <key> [-&from-cache | -&from-protobuff] [-&asa-json]
SET <key> <value> [-&save] [-&cache] [-&protobuff]      -&save persists the key
UPDATE <key> <value>          cache-only overwrite
DEL <key> [-&cache] [-&protobuff]
EXISTS <key>
MGET <key> [<key> ...]
QUERY { a: get("k") { f } ... }   several reads in one round trip, GraphQL-shaped (see docs/PROTOCOL.md)
KEYS [pattern]                glob with * and ?
HEAVEN                        drop the project's cached keys (persisted keys stay)
SAVE                          flush database.bin now
SQL <statement>               see below (the SQL prefix is optional)
EXIT
```

Keys are one word; values may contain spaces but not line breaks, and no word
of a value may start with `-&`.

```json
{"ok":true,"message":"Logged in to group: crm"}
{"ok":true,"message":"Project created","token":"..."}
{"ok":true,"key":"greeting","data":"hello world"}
{"ok":false,"key":"missing","error":"not found"}
{"ok":true,"keys":["greeting","user:1"],"count":2}
```

## SQL

After `AUTH`, Denis accepts a single-table SQL subset. Tables live in memory
with a hash index on every column (`WHERE col = value` is a lookup), are
persisted through the journal and survive restarts.

```sql
CREATE TABLE [IF NOT EXISTS] users (id INT, name TEXT, price REAL);
INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Grace');
SELECT name, price FROM users WHERE price > 10 AND name LIKE 'A%' ORDER BY price DESC LIMIT 20 OFFSET 0;
SELECT COUNT(*) FROM users WHERE name IS NOT NULL;
UPDATE users SET name = 'Grace H.' WHERE id = 2;
DELETE FROM users WHERE id = 1;
SHOW TABLES;
DESCRIBE users;
DROP TABLE [IF EXISTS] users;
```

`WHERE` supports `= != <> < <= > >= LIKE IS NULL IS NOT NULL` joined by
`AND`/`OR`. In json mode results are structured:

```json
{"ok":true,"type":"rows","columns":["name","price"],"rows":[{"name":"Ada","price":12.5}],"count":1}
{"ok":true,"type":"affected","affected":2,"message":"2 rows inserted"}
{"ok":true,"type":"tables","tables":[{"name":"users","columns":[{"name":"id","type":"INT"}],"rows":2}],"count":1}
```

## AI / MCP

[`clients/mcp`](clients/mcp) is an MCP server (`denis-mcp-server`) that gives
an AI assistant a safe, schema-first way to work with Denis: `denis_describe`
returns the tables, columns and keys; `denis_query` runs read-only SQL;
`denis_execute`, `denis_set` and `denis_delete` write (hidden with
`DENIS_READ_ONLY=1`). Results come back as Markdown plus structured content,
errors carry a next step, and resources `denis://schema`, `denis://protocol`
and `denis://table/{name}` expose the same information.

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

The server side is designed for this: every reply in json mode is a
self-describing object, `HELP` lists the commands as data, `SHOW TABLES` /
`DESCRIBE` return the schema, and `docs/PROTOCOL.md` is the reference an agent
can read.

## Denis Cloud (hosted)

[`web/`](web) is the platform behind **denis.hacimertgokhan.com**: sign up,
create up to three databases, use them from a web console, a REST API with
API keys and JWTs, or a hosted MCP endpoint for AI assistants. Storage and key
quotas are enforced by the engine (`ADMIN QUOTA`), daily command budgets and
rate limits by the platform, and usage is charted per database. Deploy the
whole stack (engine + PostgreSQL + web) with `compose.cloud.yaml`; details in
[web/README.md](web/README.md).

The engine side of this is the `ADMIN` command family (main-token
authenticated project create/usage/quota/flush/drop) documented in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Client libraries

- **Node.js** — [`clients/node`](clients/node) (`denis-client` 0.5.0): promise
  based, no dependencies; `DenisClient` pools TCP connections to your own
  server, `DenisCloud` speaks HTTPS to Denis Cloud with an API key — same
  methods: `get/set/del/exists/keys/mget`, `graph` (QUERY),
  `query/execute/tables/describe`, `info`.
- **Java** — [`java-driver`](java-driver) (`denis-driver` 1.2.0): single
  connection, `org.json` only; the same operations.
- **MCP** — [`clients/mcp`](clients/mcp) (`denis-mcp-server` 0.1.0).

All three talk `MODE json` and are exercised against the Docker image in CI.

## Configuration

Every key of `denis.properties` can be set from the environment: upper-case it,
replace `-` with `_` and prefix `DENIS_`. The `ddb-*` keys are also read without
the prefix. Environment beats the external `denis.properties`, which beats the
defaults bundled in the jar. `DENIS_CONFIG` (or `-Ddenis.config=`) points to a
different properties file; `denis cli config` shows the effective values.

| Property | Environment | Default | Meaning |
| --- | --- | --- | --- |
| `ddb-port` | `DDB_PORT` / `DENIS_DDB_PORT` | `5142` | TCP port |
| `bind-address` | `DENIS_BIND_ADDRESS` | `0.0.0.0` | interface to listen on |
| `ddb-address` | `DDB_ADDRESS` | `localhost` | address shown at start-up |
| `ddb-main-token` | `DDB_MAIN_TOKEN` | generated | 128-character main token, written to `denis.properties` on first start when empty |
| `bootstrap-group` | `DENIS_BOOTSTRAP_GROUP` | — | create this login group on start-up if it does not exist |
| `bootstrap-group-password` | `DENIS_BOOTSTRAP_GROUP_PASSWORD` | — | its password (required with the above) |
| `max-connections` | `DENIS_MAX_CONNECTIONS` | `256` | concurrent client connections (one worker thread each) |
| `max-connections-per-ip` | `DENIS_MAX_CONNECTIONS_PER_IP` | `12` | concurrent connections per client address |
| `client-idle-timeout-ms` | `DENIS_CLIENT_IDLE_TIMEOUT_MS` | `0` | close a silent connection after this long; `0` = never |
| `persist-flush-interval-ms` | `DENIS_PERSIST_FLUSH_INTERVAL_MS` | `1000` | how often `database.journal` is fsynced; `0` = on every change |
| `persist-snapshot-interval-ms` | `DENIS_PERSIST_SNAPSHOT_INTERVAL_MS` | `30000` | how often a full `database.bin` snapshot replaces the journal while there are changes |
| `language` | `DENIS_LANGUAGE` | `auto` | `auto` or one of `en tr de fr es da fi el` |
| `send-client-actions` | `DENIS_SEND_CLIENT_ACTIONS` | `true` | log every client command (credentials are masked) |
| `use-delogg` | `DENIS_USE_DELOGG` | `false` | also write client actions to the activity log |
| `open-log-terminal` | `DENIS_OPEN_LOG_TERMINAL` | `false` | open a desktop terminal that tails the activity log |
| — | `DENIS_LOG_LEVEL` | `info` | log4j root level (`debug`, `info`, `warn`, `error`) |

Logs go to stderr and to the rolling file `logs/denis.log`.

## Architecture

```
github.hacimertgokhan
├── Main                         entry point: `server` / `cli` / `--version`
├── denis
│   ├── server/DenisServer       accept loop, connection limits, worker pool, graceful stop
│   ├── server/ServerContext     what all connections share: cache, persistence, projects, groups, counters
│   ├── server/ProjectStore      one project's view: key prefixing, cache + persisted store, KEYS
│   ├── DenisClient              one session: state machine + command handlers, text/json replies
│   ├── sql/SqlQueryEngine       the SQL subset; sql/Table + TableCatalog keep rows parsed and indexed in memory
│   ├── sql/SqlResult            rows / affected / tables / error, rendered as JSON or text
│   ├── project/ProjectRegistry  project tokens (ddb.json), shared and persisted
│   ├── sections/group           login groups in denis.toml (salted SHA-512)
│   └── cli                      picocli commands; RemoteSession + ReplyRenderer for remote commands
├── proto/ProtoDatabase          database.bin snapshot + database.journal append-only log, all in memory
└── readers/DenisProperties      configuration: env > denis.properties > bundled defaults
```

Request path: `DenisServer` accepts a socket → `DenisClient.handleClient` reads
lines → `handleLine` dispatches → `ProjectStore` reads the cache and falls back
to `ProtoDatabase`; persisted writes are appended to `database.journal`
immediately (fsync every second) and a daemon thread periodically writes a
full snapshot to `database.bin.tmp`, renames it over `database.bin` and
starts a fresh journal.

## Benchmarks

[docs/BENCHMARKS.md](docs/BENCHMARKS.md) compares Denis with Redis 7 and
PostgreSQL 16 under identical container limits (harness in [`bench/`](bench)).
In short: as a key-value store Denis matches Redis on latency, large values and
crash durability and reaches about half of Redis's throughput at 64 clients; the
SQL layer's indexed point reads, counts and writes by key are faster than
PostgreSQL in that setup, while range scans with ORDER BY are still 3-5x slower.

## Versioning and releases

Denis follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`,
tags `vX.Y.Z`. Until 1.0.0 a minor release may contain breaking changes, which
are listed under **Breaking** in [CHANGELOG.md](CHANGELOG.md). Client packages
have their own versions (`clients/node`, `clients/mcp`, `java-driver`).

To release: update `CHANGELOG.md` and the version in `pom.xml`, commit, tag
(`git tag v0.6.0 && git push --tags`). The `Release` workflow verifies that the
tag matches `pom.xml`, builds the jar and the bundle, pushes the image to GHCR
and creates the GitHub Release with the changelog section as notes.
Release Drafter keeps a draft of the next version from merged PR labels
(`breaking`, `feature`, `bug`, ...).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `mvn package` runs the unit tests
(protocol, SQL engine, storage engine, a real TCP server on an ephemeral port);
the client integration tests need a running server:

```sh
DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret node --test clients/node/test/*.test.js
DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret node --test clients/mcp/test/*.test.js
cd java-driver && DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret mvn test
```

## License

MIT — see [LICENSE](LICENSE).
