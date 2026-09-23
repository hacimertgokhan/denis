# Denis wire protocol (version 2)

Denis speaks a line protocol over TCP (default port `5142`). One command line
in, one reply line out, in order. Lines end with `\n` (`\r\n` is accepted).
Clients may pipeline: send many commands, then read the same number of
replies.

- `telnet localhost 5142` works (text mode is the default).
- Libraries switch to `MODE json` first: then every reply is exactly one JSON
  object per line.
- A line longer than `max-line-size` (default 8 MB) closes the connection.

## Reply format in `MODE json`

```json
{"ok":true, ...fields}
{"ok":false,"error":"human readable message","code":"MACHINE_CODE"}
```

| code | meaning |
| --- | --- |
| `NOAUTH` | command needs `LIN` first |
| `NOPROJECT` | command needs `AUTH <token>` first |
| `AUTH` | login failed / project not accessible |
| `LOCKED` | too many failed logins from this address; wait |
| `FORBIDDEN` | admin group required |
| `USAGE` | wrong arguments; `error` holds the usage line |
| `NOTFOUND` | key does not exist (`GET`) |
| `SQL` | SQL error; `data` holds `ERROR: <message>` as in 0.0.x |
| `OOM` | `max-memory` reached and nothing could be evicted |
| `PERSISTENCE` | the log cannot be written (disk full...); durable writes refused |
| `TYPE` | wrong value type (e.g. `INCR` on text) |
| `RESERVED` | key starts with the reserved prefix `__sql:` |
| `BUSY` | worker queue full; retry |
| `LIMIT` | connection/line limit hit (connection is closed) |
| `UNKNOWN` | unknown command |
| `INTERNAL` | unexpected server error |

Fields may be added to replies in later versions; clients must ignore unknown
fields.

## Connection commands (no login needed)

| command | json reply |
| --- | --- |
| `PING` | `{"ok":true,"message":"PONG"}` (text mode: `PONG`) |
| `HELLO` | `{"ok":true,"server":"denis","version":"0.1.0","protocol":2,"features":[...],"loggedIn":false}` |
| `MODE json` / `MODE text` | `{"ok":true,"message":"mode json"}` |
| `LIN <group> <password>` | `{"ok":true,"message":"Logged in to group: g","group":"g","admin":false}` |
| `HELP` | `{"ok":true,"commands":[...]}` |
| `EXIT` / `QUIT` | `{"ok":true,"message":"Bye."}`, then the server closes |

The password is everything after the group name (it may contain spaces).
After `login-max-failures` (default 10) failures an address is locked out for
`login-lockout-seconds`.

## After login

| command | json reply |
| --- | --- |
| `AUTH <token>` | `{"ok":true,"message":"Authenticated to project: <token>"}` |
| `AUTH CREATE` | `{"ok":true,"message":"Project created","token":"<128 chars>"}` — owned by the logged-in group |
| `AUTH DELETE <token>` | `{"ok":true,"message":"Project deleted"}` — drops all its keys and tables |
| `PROJECTS` | `{"ok":true,"projects":[{"token","owner","keys","tables","current"}],"count":n}` |
| `WHOAMI` | `{"ok":true,"group":"g","admin":false,"project":"<token>"\|null}` |
| `INFO` | `{"ok":true,"info":{"server":{},"clients":{},"stats":{},"memory":{},"persistence":{},"keyspace":{},"project":{}}}` |

A project created by a group can only be opened by that group and admin
groups (`enforce-project-ownership=true`). Tokens without an owner (created
by Denis 0.0.x or `denis cli token create`) are open to every group.

### Admin groups only

| command | json reply |
| --- | --- |
| `SAVE` | `{"ok":true,"message":"Snapshot written","bytes":n,"records":n,"millis":n}` |
| `BACKUP` | `{"ok":true,"message":"Backup created","name":"denis-...zip","path":"...","bytes":n,"createdAt":"..."}` |
| `BACKUPS` | `{"ok":true,"backups":[{"name","path","bytes","createdAt"}],"directory":"..."}` |

## After `AUTH <token>`: keys

Every key has two layers: a **cache** value (in memory only) and a **durable**
value (written to the log, survives restarts). Reads prefer the cache value.

| command | notes | json reply |
| --- | --- | --- |
| `SET <key> <value> [-&save] [-&cache] [-&ttl=<s>]` | always sets the cache value; `-&save` (alias `-&protobuff`) also the durable one; `-&ttl` expires the cache value | `{"ok":true,"message":"Ok (Cache)"}` |
| `GET <key> [-&from-protobuff] [-&asa-json]` | `-&from-protobuff` prefers the durable value | `{"ok":true,"key":"k","data":"v"}` / `{"ok":false,"key":"k","error":"not found","code":"NOTFOUND"}` |
| `DEL <key> [-&cache \| -&protobuff]` | default both layers | `{"ok":true,"message":"...","deleted":true}` |
| `UPDATE <key> <value>` | cache only | `{"ok":true,"message":"Ok."}` |
| `EXISTS <key>` | | `{"ok":true,"key":"k","exists":true,"cache":true,"persistent":false}` |
| `KEYS [pattern] [-&cache \| -&protobuff] [-&limit=<n>]` | glob: `*`, `?`, `[a-z]` | `{"ok":true,"keys":[...],"count":n,"truncated":false}` |
| `MGET <key> [<key> ...]` | | `{"ok":true,"data":{"k1":"v","k2":null}}` |
| `INCR <key> [delta] [-&save]`, `DECR ...` | atomic; missing key counts as 0 | `{"ok":true,"key":"k","data":"42","value":42}` |
| `EXPIRE <key> <seconds>` | cache value only | `{"ok":true,"key":"k","data":"1","updated":true}` |
| `TTL <key>` | -1 no TTL, -2 no cache value | `{"ok":true,"key":"k","data":"57","ttl":57,"ttlMillis":56420}` |
| `PERSIST <key>` | remove the TTL | like `EXPIRE` |
| `DBSIZE` | | `{"ok":true,"keys":n,"cache":n,"persistent":n,"tables":n,"data":"n"}` |
| `HEAVEN` | drop every cache value of the project | `{"ok":true,"message":"Ok."}` |

Keys are one word. Values may contain spaces but not line breaks, and no word
of a value may start with `-&`. For arbitrary binary or multi-line data,
encode it (JSON/base64) on the client.

## Backup / transfer of one project

`DUMP` returns everything of the current project:

```json
{"ok":true,"format":1,"server":"denis","version":"0.1.0","createdAt":"...",
 "cache":{"k":"v"},"persistent":{"k":"v"},"ttl":{"k":57000},
 "tables":{"users":{"columns":[{"name":"id","type":"INTEGER","primaryKey":true,"notNull":true}],
                    "indexes":[{"name":"idx","column":"name","unique":false}],
                    "rows":[[1,"Ada"]]}}}
```

`IMPORT <json>` takes the same object (without `ok`) and merges it into the
current project; with `"replace":true` existing tables of the same name are
replaced. Large projects can be imported in several `IMPORT` lines.
Reply: `{"ok":true,"message":"Imported","imported":{"persistent":n,"cache":n,"tables":n,"rows":n}}`.

## SQL

`SQL <statement>` (or a statement typed directly: `SELECT ...`, `INSERT ...`,
`CREATE ...`, `UPDATE ... SET ...`, `DELETE ...`, `DROP ...`, `ALTER ...`,
`SHOW ...`, `DESCRIBE ...`, `EXPLAIN ...`, `TRUNCATE ...`).

`QUERY {"sql":"SELECT * FROM t WHERE id = ?","params":[1]}` runs a statement
with bound parameters — use this from applications, it is immune to SQL
injection and lets the server cache the parsed statement.

Result set:

```json
{"ok":true,"columns":["id","name"],"rows":[[1,"Ada"]],"count":1,"data":"[{\"id\":1,\"name\":\"Ada\"}]"}
```

Change:

```json
{"ok":true,"message":"1 row inserted","affected":1,"lastRowId":1,"data":"OK: 1 row inserted"}
```

Error: `{"ok":false,"error":"Table not found: t","code":"SQL","data":"ERROR: Table not found: t"}`.

`data` is the Denis 0.0.x text result and is what text mode prints. See
[SQL.md](SQL.md) for the language.

## Text mode (compatibility)

Text mode replies are the lines Denis 0.0.x sent: `[Info - <date>]: <message>`,
`[Error - <date>]: <message>`, raw values for `GET`, `USAGE: ...` lines and
`err: <key> not found in cache or protobuff`. New commands answer with their
JSON body (without `ok`) or a bare number in text mode.
