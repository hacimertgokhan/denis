# Denis wire protocol (version 2)

Denis speaks a line protocol over TCP (default port `5142`). One command line
in, one reply line out, in order. Lines end with `\n` (`\r\n` is accepted).
Clients may pipeline: send many commands, then read the same number of
replies.

- `telnet localhost 5142` works (text mode is the default).
- Libraries switch to `MODE json` first: then every reply is exactly one JSON
  object per line.
- A line longer than `max-line-size` (default 8 MB) closes the connection.
- Leading whitespace is ignored; trailing whitespace is part of the line (a
  value may end in spaces, and `SET k ` stores an empty value).
- A blank line gets no reply in text mode (pressing Enter in telnet) and a
  `USAGE` error in json mode, so clients always get one reply per line.

## Reply format in `MODE json`

```json
{"ok":true, ...fields}
{"ok":false,"error":"human readable message","code":"MACHINE_CODE"}
```

| code | meaning |
| --- | --- |
| `NOAUTH` | command needs `LIN` first |
| `NOPROJECT` | command needs `AUTH <token>` first (also when the project was deleted by another session) |
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
| `QUOTA` | the project reached its quota; `resource` (`keys`/`bytes`) and `limit` are added |
| `UNKNOWN` | unknown command (`error` ends with `(try HELP)`) |
| `INTERNAL` | unexpected server error |

Fields may be added to replies in later versions; clients must ignore unknown
fields.

## Connection commands (no login needed)

| command | json reply |
| --- | --- |
| `PING` | `{"ok":true,"message":"PONG"}` (text mode: `PONG`) |
| `HELLO` | `{"ok":true,"server":"denis","version":"0.7.0","protocol":2,"features":[...],"loggedIn":false}` |
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
| `INFO` | `{"ok":true,"version",...,"project":{"cachedKeys","cachedBytes","persistedKeys","persistedBytes","quota":{}},"info":{"server":{},"clients":{},"stats":{},"memory":{},"persistence":{},"keyspace":{},"project":{}}}` (see [compatibility](#compatibility-with-03-06)) |
| `SAVE` | `{"ok":true,"message":"Saved.","bytes":n,"records":n,"millis":n}` — writes a checkpoint now |

A project created by a group can only be opened by that group and admin
groups (`enforce-project-ownership=true`). Tokens without an owner (created
by Denis 0.0.x or `denis cli token create`) are open to every group.

### Admin groups only

| command | json reply |
| --- | --- |
| `BACKUP` | `{"ok":true,"message":"Backup created","name":"denis-...zip","path":"...","bytes":n,"createdAt":"..."}` |
| `BACKUPS` | `{"ok":true,"backups":[{"name","path","bytes","createdAt"}],"directory":"..."}` |

## After `AUTH <token>`: keys

Every key has two layers: a **cache** value (in memory only) and a **durable**
value (written to the log, survives restarts). Reads prefer the cache value.

| command | notes | json reply |
| --- | --- | --- |
| `SET <key> <value> [-&save] [-&cache] [-&ttl=<s>]` | always sets the cache value; `-&save` (alias `-&protobuff`) also the durable one; `-&ttl` expires the cache value | `{"ok":true,"message":"Ok (Cache)"}` |
| `GET <key> [-&from-protobuff] [-&asa-json]` | `-&from-protobuff` prefers the durable value; `-&from-cache` is accepted and behaves like the default (as in 0.0.x) | `{"ok":true,"key":"k","data":"v"}` / `{"ok":false,"key":"k","error":"not found","code":"NOTFOUND"}` |
| `DEL <key> [-&cache \| -&protobuff]` | default both layers | `{"ok":true,"message":"...","deleted":true}` |
| `UPDATE <key> <value>` | cache only | `{"ok":true,"message":"Ok."}` |
| `EXISTS <key>` | | `{"ok":true,"key":"k","exists":true,"cache":true,"persistent":false}` |
| `KEYS [pattern] [-&cache \| -&protobuff] [-&limit=<n>]` | glob: `*`, `?`, `[a-z]` | `{"ok":true,"keys":[...],"count":n,"truncated":false}` |
| `MGET <key> [<key> ...]` | | `{"ok":true,"data":{"k1":"v","k2":null},"values":{...same}}` |
| `INCR <key> [delta] [-&save]`, `DECR ...` | atomic; missing key counts as 0 | `{"ok":true,"key":"k","data":"42","value":42}` |
| `EXPIRE <key> <seconds>` | cache value only | `{"ok":true,"key":"k","data":"1","updated":true}` |
| `TTL <key>` | -1 no TTL, -2 no cache value | `{"ok":true,"key":"k","data":"57","ttl":57,"ttlMillis":56420}` |
| `PERSIST <key>` | remove the TTL | like `EXPIRE` |
| `DBSIZE` | | `{"ok":true,"keys":n,"cache":n,"persistent":n,"tables":n,"data":"n"}` |
| `HEAVEN` | drop every cache value of the project | `{"ok":true,"message":"Ok.","removed":n}` |
| `QUERY { ... }` | several reads in one round trip, see [QUERY](#query-one-round-trip-many-reads) | `{"ok":true,"data":{...},"errors":[...]}` |

Keys are one word. Values may contain spaces but not line breaks, and no word
of a value may start with `-&`. For arbitrary binary or multi-line data,
encode it (JSON/base64) on the client.

## Backup / transfer of one project

`DUMP` returns everything of the current project:

```json
{"ok":true,"format":1,"server":"denis","version":"0.7.0","createdAt":"...",
 "cache":{"k":"v"},"persistent":{"k":"v"},"ttl":{"k":57000},
 "tables":{"users":{"columns":[{"name":"id","type":"INTEGER","primaryKey":true,"notNull":true}],
                    "indexes":[{"name":"idx","column":"name","unique":false}],
                    "rows":[[1,"Ada"]]}}}
```

`IMPORT <json>` takes the same object (without `ok`) and merges it into the
current project; with `"replace":true` existing tables of the same name are
replaced. With `"append":true` the rows of a table are added to an existing
table with the same number of columns — so a table larger than one line is
sent as a first line that creates it and further `append` lines. Large
projects can be imported in several `IMPORT` lines.
Reply: `{"ok":true,"message":"Imported","imported":{"persistent":n,"cache":n,"tables":n,"rows":n}}`.

## SQL

`SQL <statement>` (or a statement typed directly: `SELECT ...`, `INSERT ...`,
`CREATE ...`, `UPDATE ... SET ...`, `DELETE ...`, `DROP ...`, `ALTER ...`,
`SHOW ...`, `DESCRIBE ...`, `EXPLAIN ...`, `TRUNCATE ...`). A trailing `;` is fine.

`QUERY {"sql":"SELECT * FROM t WHERE id = ?","params":[1]}` runs a statement
with bound parameters — use this from applications, it is immune to SQL
injection and lets the server cache the parsed statement. (`QUERY` followed by
a JSON object is bound SQL; anything else is a [QUERY document](#query-one-round-trip-many-reads).)

Result set:

```json
{"ok":true,"type":"rows","columns":["id","name"],"rows":[{"id":1,"name":"Ada"}],"count":1,"data":"[{\"id\":1,\"name\":\"Ada\"}]"}
```

Change:

```json
{"ok":true,"type":"affected","affected":1,"message":"1 row inserted","lastRowId":1,"data":"OK: 1 row inserted"}
```

`SHOW TABLES` / `DESCRIBE t`:

```json
{"ok":true,"type":"tables","tables":[{"name":"users","columns":[{"name":"id","type":"INTEGER","primaryKey":true}],"rows":1,"indexes":[],"bytes":24}],"count":1,"data":"..."}
```

Error: `{"ok":false,"error":"Table not found: t","code":"SQL","data":"ERROR: Table not found: t"}`.

`data` is the Denis 0.0.x text result and is what text mode prints. See
[SQL.md](SQL.md) for the language.

## QUERY: one round trip, many reads

`QUERY` takes a GraphQL-shaped document on the same line and resolves every
field on the server. A page that needs a user, their cart and their last
orders costs one command instead of five, and the reply carries only the
fields that were asked for.

```
QUERY { user: get("user:1") { name address { city } } cart: prefix("cart:1:") { sku qty } orders: table("orders", where: "user_id = 1", order: "total desc", limit: 5) { id total } n: count("orders") }
{"ok":true,"data":{"user":{"name":"Ada","address":{"city":"London"}},"cart":{"cart:1:a":{"sku":"pen","qty":2}},"orders":[{"id":2,"total":40},{"id":1,"total":36}],"n":3}}
```

Grammar (whitespace and commas between fields are free):

```
document  := '{' field* '}'
field     := [alias ':'] resolver ['(' args ')'] [selection]
args      := arg (',' arg)*            arg := [name ':'] value
value     := "string" | number | true | false | null | identifier
selection := '{' ( [alias ':'] name [selection] )* '}'
```

Resolvers, all read-only:

| Resolver | Result | Selection |
| --- | --- | --- |
| `get(key)` | the value, or `null` | parses the value as JSON and keeps the selected fields (nested selections allowed) |
| `mget(k1, k2, ...)` | `{ key: value }` | applied to every value |
| `prefix("cart:1:")` | `{ key: value }` for every key with that prefix | applied to every value |
| `keys(pattern)` | `[key]` | — |
| `exists(key)` | boolean | — |
| `count(table)` | number of rows | — |
| `table(name, where: "...", order: "col desc", limit: n, offset: n)` | rows | becomes the `SELECT` list; without one, `*` |
| `sql("SELECT ...")` | rows (also `SHOW TABLES`, `DESCRIBE`) | projects columns |
| `tables()` | `[{ name, columns, rows }]` | — |
| `describe(table)` | `{ name, columns, rows }` | — |

A field that fails (unknown table, a value that is not JSON, a write inside
`sql()`) comes back as `null` and is listed in `errors` as `{ path, error }`;
the other fields still resolve. A syntax error fails the whole command with
`ok:false`, `code: "USAGE"`, `error: "syntax: ..."` and the character `offset`. A document
selects at most 64 top-level fields. The reply is JSON in text mode too.

## ADMIN

`ADMIN <main-token> <action> ...` needs no login: the main token
(`ddb-main-token` in `denis.properties` / `DDB_MAIN_TOKEN`) is the credential.
It is meant for provisioning (Denis Cloud) and should never reach end users.
A wrong token answers `{"ok":false,"error":"ADMIN refused: wrong main token","code":"AUTH"}`
and counts as a failed login for the address.

| action | json reply | notes |
| --- | --- | --- |
| `LIST` | `{"ok":true,"projects":[{"token","usage","quota"}],"count":n}` | |
| `CREATE [maxKeys maxBytes]` | `{"ok":true,"token":"..."}` | a new project, optionally with limits |
| `IMPORT <token> [maxKeys maxBytes]` | `{"ok":true,"token":"...","added":true}` | register a token issued elsewhere (restore after the registry was lost); idempotent, `added:false` when it existed |
| `USAGE <token>` | `{"ok":true,"token","usage":{"cachedKeys","cachedBytes","persistedKeys","persistedBytes"},"quota":{"maxKeys","maxBytes"}}` | |
| `QUOTA <token> <maxKeys> <maxBytes>` | the usage object | `0` = unlimited |
| `FLUSH <token>` | `{"ok":true,"message":...}` | delete every key and table, keep the project |
| `DROP <token>` | `{"ok":true,"message":...}` | delete the project and its data |

### Quotas

A quota limits the number of keys and their size (characters of key + value)
of one project; the cache and the durable layer are counted separately, table
rows count against the durable layer. A write that would exceed it is refused:

```json
{"ok":false,"error":"quota exceeded: keys (limit 3)","code":"QUOTA","resource":"keys","limit":3}
```

Overwriting a key with a value of the same size never fails. `INFO` reports
the current project's usage and quota under `project`.

## Compatibility with 0.3-0.6

json replies keep the fields clients of 0.3-0.6 read: `MGET` has `values`
next to `data`, `HEAVEN` has `removed`, `INFO` has `version`, `uptimeSeconds`,
`startedAt`, `connections`, `commandsTotal`, `cacheKeys`, `persistedKeys`,
`projects` (tokens registered in `ddb.json`; `info.keyspace.projects` counts the
projects loaded in memory), `group`, `memory` at the top level next to `info`, `HELP` lists
`{name, usage, description, needsLogin, needsProject}` and unknown commands end
with `(try HELP)`.

## Text mode (compatibility)

Text mode replies are the lines Denis 0.0.x sent: `[Info - <date>]: <message>`,
`[Error - <date>]: <message>`, raw values for `GET`, `USAGE: ...` lines and
`err: <key> not found in cache or protobuff`. New commands answer with their
JSON body (without `ok`) or a bare number in text mode.
