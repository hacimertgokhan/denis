# Denis wire protocol

Denis speaks a line protocol over TCP (default port 5142). One request line in,
one reply line out, UTF-8, `\n` terminated (`\r\n` is accepted). `telnet
localhost 5142` works. This document is the reference for client libraries,
the CLI, the MCP server and for AI agents that talk to Denis directly.

## Session model

```
connect ──► MODE json            (optional; text mode is the default)
        ──► LIN <group> <password>       login group from denis.toml
        ──► AUTH CREATE | AUTH <token>   select a project (key namespace)
        ──► GET / SET / SQL ...          data commands
        ──► EXIT
```

| State | Allowed commands |
| --- | --- |
| connected | `PING`, `MODE`, `HELP`, `EXIT`, `LIN` |
| logged in | + `AUTH`, `INFO` |
| project selected | + every data command below |

A command sent in the wrong state answers an error
(`Please login first using LIN command`, `Please authenticate first using AUTH command`).

## Reply formats

**text** (default): human readable, one line except `HELP`, `INFO` and `KEYS`
which print several. Successful commands print `[Info - <date>]: <message>`,
errors `[Error - <date>]: <message>`, `GET` prints the raw value.

**json** (`MODE json`): exactly one JSON object per reply, always with `ok`:

```json
{"ok":true,"message":"Logged in to group: crm"}
{"ok":false,"error":"Login failed: unknown group or wrong password"}
```

Every field a reply can carry:

| Field | Type | When |
| --- | --- | --- |
| `ok` | boolean | always |
| `message` | string | `ok:true` acknowledgements |
| `error` | string | `ok:false` |
| `key`, `data` | string | `GET` (`data` is the value) |
| `exists` | boolean | `EXISTS` |
| `keys`, `count` | string[], number | `KEYS` |
| `values` | object key→string\|null | `MGET` |
| `token` | string | `AUTH CREATE` |
| `removed` | number | `HEAVEN` |
| `commands` | object[] | `HELP` |
| `type`, `columns`, `rows`, `count`, `affected`, `tables` | see SQL | SQL statements |
| `version`, `uptimeSeconds`, `startedAt`, `connections`, `commandsTotal`, `cacheKeys`, `persistedKeys`, `persistedDirty`, `projects`, `group`, `project`, `memory` | | `INFO` |

## Commands

| Command | Reply (json) | Notes |
| --- | --- | --- |
| `PING` | `{"ok":true,"message":"PONG"}` | text mode prints `PONG`; used by the Docker health check |
| `MODE json` / `MODE text` | `message: "mode json"` | per connection |
| `HELP` | `commands: [{name, usage, description, needsLogin, needsProject}]` | |
| `EXIT` / `QUIT` | `message: "Bye."` | server closes the socket |
| `LIN <group> <password>` | `message: "Logged in to group: crm"` | groups are created with `denis cli group create` or `DENIS_BOOTSTRAP_GROUP` |
| `AUTH CREATE` | `{"ok":true,"message":"Project created","token":"<128 chars>"}` | the token is the only credential for the project; keep it |
| `AUTH <token>` | `message: "Authenticated to project: ..."` | |
| `INFO` | statistics object | needs login |
| `GET <key> [-&from-cache \| -&from-protobuff] [-&asa-json]` | `{"ok":true,"key":"k","data":"v"}` / `{"ok":false,"key":"k","error":"not found"}` | cache first, then the persisted store |
| `SET <key> <value> [-&save] [-&cache] [-&protobuff]` | `message: "Ok (Cache, Protobuf)"` | value may contain spaces; `-&save`/`-&protobuff` also persist |
| `UPDATE <key> <value>` | `message: "Ok."` | cache only |
| `DEL <key> [-&cache] [-&protobuff]` | `message: "Ok (Cache,Protobuf)."` | default: both stores |
| `EXISTS <key>` | `{"ok":true,"key":"k","exists":true}` | |
| `MGET <k1> <k2> ...` | `{"ok":true,"values":{"k1":"v","k2":null}}` | |
| `KEYS [pattern]` | `{"ok":true,"keys":[...],"count":n}` | glob `*` and `?`; sorted; internal `__sql:` keys hidden unless the pattern starts with `__` |
| `HEAVEN` | `{"ok":true,"message":"Ok.","removed":n}` | drops the project's cached keys; persisted keys stay |
| `SAVE` | `message: "Saved."` | flush `database.bin` now |
| `SQL <statement>` or the bare statement | see below | |

### Value rules

- Keys are one word (no whitespace).
- Values may contain spaces, quotes and Unicode, but not line breaks.
- No word of a value may start with `-&` — that marks a flag.
- Values are stored as text. Clients that want structure store JSON text.

## SQL

Tables live in the project's `__sql:` key namespace and are persisted. Prefix
with `SQL ` or send the statement directly; a trailing `;` is fine.

```
CREATE TABLE [IF NOT EXISTS] t (col TYPE, ...)
INSERT INTO t (cols) VALUES (vals) [, (vals) ...]
SELECT cols | * | COUNT(*) FROM t [WHERE cond] [ORDER BY col [ASC|DESC]] [LIMIT n [OFFSET m]]
UPDATE t SET col = v [, ...] [WHERE cond]
DELETE FROM t [WHERE cond]
DROP TABLE [IF EXISTS] t
SHOW TABLES
DESCRIBE t
```

- `cond`: comparisons joined by `AND` / `OR` (`AND` binds tighter; no
  parentheses). Operators: `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`, `LIKE`
  (`%`, `_`, case-insensitive), `IS NULL`, `IS NOT NULL`.
- Literals: `'text'` or `"text"`, integers, decimals, `true`/`false`, `NULL`.
- Types in `CREATE TABLE` are informational; numbers compare numerically,
  everything else as text.
- One table per statement: no joins, subqueries, GROUP BY or aggregates other
  than `COUNT(*)`.
- Every column has a hash index: `WHERE col = value` (alone or inside an
  AND-only clause) is a lookup; other operators scan the table in memory.

Replies in json mode:

```json
{"ok":true,"type":"rows","columns":["id","name"],"rows":[{"id":1,"name":"Ada"}],"count":1}
{"ok":true,"type":"affected","affected":2,"message":"2 rows inserted"}
{"ok":true,"type":"tables","tables":[{"name":"users","columns":[{"name":"id","type":"INT"}],"rows":1}],"count":1}
{"ok":false,"error":"Table not found: users"}
```

In text mode: a JSON array for rows/tables, `OK: <message>` and `ERROR: <message>`.

## Errors

| Error | Cause |
| --- | --- |
| `Please login first using LIN command` | data command before `LIN` |
| `Login failed: unknown group or wrong password` | |
| `Please authenticate first using AUTH command` | data command before `AUTH` |
| `Cannot auth with: <token>` | unknown token |
| `USAGE: ...` | missing arguments |
| `not found` (with `key`) | `GET` of a missing key |
| `Unknown command: X (try HELP)` | |
| `Table not found: t`, `Column not found: c`, `Table already exists: t`, `Unsupported SQL query`, `Unsupported WHERE clause: ...` | SQL |
| `internal error: ...` | a bug; the connection stays open |
| `line too long` | a request above 1 MiB; the connection is closed |

## Limits and behaviour

- Per-IP connection limit (`max-connections-per-ip`, default 12) and a global
  one (`max-connections`, default 256): excess connections are closed without
  a reply.
- Optional idle timeout (`client-idle-timeout-ms`).
- Persisted writes go to `database.journal` immediately and are fsynced every
  `persist-flush-interval-ms` (default 1 s; `0` = every change). A full
  `database.bin` snapshot is written every `persist-snapshot-interval-ms`
  (30 s) while there are changes, on `SAVE` and on shutdown.
