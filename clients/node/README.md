# denis-client (Node.js)

A Node.js client for [Denis Database](https://github.com/hacimertgokhan/denis), a key-value store with a SQL layer. Two transports, one API:

- **`DenisClient`** talks TCP to a server you run: a **pipelined, multiplexed pool** (commands go to the least busy connection without waiting for earlier replies; commands issued in the same tick share one socket write), **reconnect** with backoff that re-runs the login handshake, **SQL with bound parameters**, **dump/import**, and project administration with the main token.
- **`DenisCloud`** talks HTTPS to a database on Denis Cloud with an API key.

Both extend `DenisCommands`, so code written against one works with the other. Plain CommonJS with TypeScript definitions, **no dependencies**, Node 18+. Speaks Denis wire protocol 2.

```sh
npm install denis-client        # or: npm install github:hacimertgokhan/denis#master:clients/node
```

## Quick start

```js
const { DenisClient } = require("denis-client");

const denis = new DenisClient({
  host: "127.0.0.1",
  port: 5142,
  group: "crm",                     // LIN <group> <password>
  password: "s3cret phrase",        // may contain spaces
  token: process.env.DENIS_TOKEN,   // AUTH <token>, or createProject: true
});

await denis.set("greeting", "hello world");                   // cache only
await denis.set("user:1", { id: 1, name: "Ada" }, { persist: true }); // also the durable store
await denis.set("session:9", "abc", { ttl: 60 });             // cache value expires in 60 s
await denis.get("greeting");                                  // "hello world"
await denis.getJSON("user:1");                                // { id: 1, name: "Ada" }
await denis.get("missing");                                   // null
await denis.incr("visits");                                   // 1

await denis.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");     // 0 (affected rows)
await denis.execute("INSERT INTO users (id, name) VALUES (?, ?)", [1, "Ada"]);      // 1
await denis.query("SELECT * FROM users WHERE id = ?", [1]);   // [{ id: 1, name: "Ada" }]
await denis.sql("SELECT id FROM users");                      // { type: "rows", columns: ["id"], rows: [{ id: 1 }], count: 1 }
await denis.tables();                                         // [{ name: "users", columns: [...], rows: 1 }]

await denis.close();
```

## Denis Cloud

A hosted database is reached through its REST gateway, never over TCP. Create an API key in the database's **Connect** tab:

```js
const { DenisCloud } = require("denis-client");

const denis = new DenisCloud({ apiKey: process.env.DENIS_API_KEY });
await denis.set("greeting", "hello world", { persist: true });
await denis.get("greeting");                                     // "hello world"
await denis.query("SELECT name FROM products WHERE price > 10"); // [{ name: "Book" }]
await denis.batch(["GET greeting", "EXISTS nope"]);              // up to 50 commands in one request
await denis.usage();   // { usage: {persistedKeys, persistedBytes, opsToday, ...}, limits: {maxKeys, maxBytes, opsPerDay} }
await denis.whoami();  // { database: { id, name }, scope: "read" | "write", via }
```

Options: `apiKey` (or `accessToken`), `url` (default the public platform; `http://localhost:3000` for a local one), `useJwt: true` to exchange the key for short-lived access tokens that are refreshed automatically, `timeout` (ms per request), `fetch`, and `importChunkBytes` (default 48 KiB, below the gateway's 64 KB command limit).

Every method of the [shared API](#api) works over the gateway. A read-scoped key can only run read commands: writes fail with `ESERVER` and `err.serverCode === "READ_ONLY"`; a spent daily budget or a rate limit answers `ELIMIT`. `pipeline()`, `use()`, `admin()`, `createProject()`, `deleteProject()`, `projects()`, `backup()`/`backups()` are TCP-only: the platform manages projects itself.

## TCP options

| option | default | |
| --- | --- | --- |
| `host`, `port` | `127.0.0.1`, `5142` | |
| `group`, `password` | none | Login with `LIN`. Leave `group` out to skip login; only `PING`/`HELLO`/`HELP`/`ADMIN` work then. |
| `token` | none | The project to `AUTH` with. |
| `createProject` | `false` | With no `token`, the first connection runs `AUTH CREATE` and the other connections join that project. Read the token from `client.token`. |
| `poolSize` | `4` | Most TCP connections kept open. They are opened on demand: the first command opens one, another opens whenever every open connection is busy. `connect()` opens them all at once. |
| `pipeline` | `true` | `false` keeps one command in flight per connection (the same as `maxPending: 1`). |
| `connectTimeout` | `5000` | ms |
| `commandTimeout` | `10000` | ms per command, counted from the moment it is issued. `0` disables it. |
| `reconnect` | `{ retries: 5, minDelay: 100, maxDelay: 5000 }` | Pass `false` to turn off background reconnects. See [Reconnect](#reconnect). |
| `maxPending` | `10000` | How many commands one connection may have in flight. Beyond that, new commands wait in the client. |
| `importChunkBytes` | `1048576` | `import()` splits dumps larger than this. |

## API

Every method returns a promise. "TCP" marks methods only `DenisClient` has.

### Key-value

| method | wire command | resolves to |
| --- | --- | --- |
| `ping()` | `PING` | `true`, or `false` when the server answered `ok:false` |
| `hello()` | `HELLO` | `{ server, version, protocol, features, loggedIn }` |
| `get(key, { source })` | `GET key [-&from-cache\|-&from-protobuff]` | string, or `null` if the key is missing. `source: "protobuf"` prefers the durable value. |
| `getJSON(key, opts)` | `GET` | the value passed through `JSON.parse`, or `null` |
| `set(key, value, { persist, ttl })` | `SET key value [-&cache -&save] [-&ttl=s]` | `true`. Non-string values are `JSON.stringify`-ed. |
| `update(key, value)` | `UPDATE key value` | `true` (writes the cache only) |
| `del(key, { cache, protobuf })` | `DEL key [-&cache\|-&protobuff]` | whether the key existed (`true` when the server does not say). Both layers by default. |
| `exists(key)` | `EXISTS` | boolean |
| `keys(pattern = "*", { layer, limit })` | `KEYS` | `string[]`, sorted. Glob syntax: `*`, `?`, `[a-z]`. `layer` is `"any"`, `"cache"` or `"persistent"`. |
| `mget(keys)` | `MGET` | `{ key: value \| null }` (`{}` for an empty array) |
| `incr(key, delta = 1, { persist })` | `INCR` | the new number. A missing key counts as 0. |
| `decr(key, delta = 1, { persist })` | `DECR` | the new number |
| `expire(key, seconds)` | `EXPIRE` | whether a cache value got the TTL |
| `ttl(key)` | `TTL` | seconds left. `-1` means no TTL, `-2` means no cache value. |
| `persist(key)` | `PERSIST` | whether a TTL was removed |
| `dbsize()` | `DBSIZE` | `{ keys, cache, persistent, tables }` |
| `clear()` | `HEAVEN` | `true`. Drops every **cache** value of the project; durable values stay. |

Every key has two layers. The **cache** value lives in memory only. The **durable** value is written with `persist: true` and survives restarts. Reads prefer the cache value. A `ttl` expires only the cache value, so a key written with both `persist` and `ttl` falls back to its durable value once the TTL passes.

Keys are one word, with no whitespace. Values can contain spaces, quotes and any Unicode, including empty strings and leading or trailing spaces. They cannot contain line breaks, and no word in them may start with `-&`, the flag marker. To store arbitrary text, `JSON.stringify` or base64-encode it first. Invalid input is rejected locally with `EINVAL` and never reaches the server.

### SQL

| method | resolves to |
| --- | --- |
| `sql(statement, params?)` | the structured result: `{ type: "rows", columns, rows, count }`, `{ type: "affected", affected, message, lastRowId }` or `{ type: "tables", tables, count }` |
| `query(sql, params?)` | the row objects of a `SELECT` (`[{ id: 1, name: "Ada" }]`) |
| `queryObjects(sql, params?)` | alias of `query()` |
| `execute(sql, params?)` | the affected row count of `INSERT`/`UPDATE`/`DELETE`/DDL |
| `tables()` | `SHOW TABLES`: `[{ name, columns: [{ name, type, ... }], rows }]` |
| `describe(table)` | `DESCRIBE`: `{ name, columns, rows }`, or `null` when the table does not exist |

Without `params` the statement goes out as `SQL <statement>` and must be one line. With `params` (an array, even an empty one) it goes out as `QUERY {"sql": ..., "params": [...]}`: the parameters are bound by the server and cannot inject SQL, and the SQL text may span several lines. Parameters can be strings, numbers, booleans, `null`, `bigint` or `Date` (sent as an ISO string).

```js
const rows = await denis.query("SELECT id, name FROM users WHERE name LIKE ?", ["A%"]);
const { affected, lastRowId } = await denis.sql("INSERT INTO users (name) VALUES (?)", ["Grace"]);
```

`query()` on a statement that returns no rows (and `execute()` on one that does) rejects with `EPROTO`. A failing statement rejects with `ESERVER` and `serverCode: "SQL"`. See [docs/SQL.md](../../docs/SQL.md) for the language.

### One round trip, many reads: `graph()`

`QUERY` also takes a GraphQL-shaped document and resolves every field on the server, so a page that needs a user, their cart and their last orders costs one command instead of five:

```js
const { data, errors } = await denis.graph(`{
  user:   get("user:1") { name email address { city } }
  cart:   prefix("cart:1:") { sku qty }
  orders: table("orders", where: "user_id = 1", order: "total desc", limit: 5) { id total }
  n:      count("orders")
}`);
```

Resolvers (all read-only): `get(key)`, `mget(k1, k2, ...)`, `prefix(p)`, `keys(pattern)`, `exists(key)`, `count(table)`, `table(name, where:, order:, limit:, offset:)`, `sql("SELECT ...")`, `tables()`, `describe(table)`. A field that fails comes back as `null` with an entry in `errors` (`{ path, error }`) while the others still resolve. Line breaks in the document are sent as spaces. `queryGraph()` is an alias.

### Projects and server

| method | resolves to |
| --- | --- |
| `client.token` | TCP. The current project token (a getter). |
| `whoami()` | TCP: `{ group, admin, project }`. Denis Cloud: `{ database, scope, via }`. |
| `projects()` | TCP. `[{ token, owner, keys, tables, current }]`: the projects the logged-in group can open |
| `createProject()` | TCP. A new token. The client stays on its current project. |
| `use(token)` | TCP. `true`. Runs `AUTH` on every pooled connection; later connections use the new token too. |
| `deleteProject(token)` | TCP. `true`. After deleting the current project, the client has no project until the next `use()`. |
| `info()` | the `INFO` object: `version`, `uptimeSeconds`, `startedAt`, `connections`, `commandsTotal`, `cacheKeys`, `persistedKeys`, `projects`, `group`, `project` (usage and quota), `memory`, and the detailed sections under `info` (`server`, `clients`, `stats`, `memory`, `persistence`, `keyspace`, `project`) |
| `help()` | `[{ name, usage, description, needsLogin, needsProject }]` |
| `save()` | `true`: the persisted store is flushed now. `command("SAVE")` returns the details (`bytes`, `records`, `millis`). |
| `backup()` | TCP, admin group: `{ message, name, path, bytes, createdAt }` |
| `backups()` | TCP, admin group: `{ backups: [{ name, path, bytes, createdAt }], directory }` |
| `command(line, { timeout })` | the raw parsed reply of any protocol line. Never throws on `ok:false`. |
| `batch(lines)` | the raw replies of several lines, in order (TCP: one write on one connection; Denis Cloud: one request, at most 50) |
| `connect()` | TCP. The client, once the whole pool is open. |
| `close()` | resolves once every connection has closed |

`dump`, `save`, `backup` and `command` accept `{ timeout }` for long-running calls (TCP).

### Administration with the main token: `admin()`

TCP only, no login needed: the server's main token (`ddb-main-token` / `DENIS_DDB_MAIN_TOKEN`) authenticates `ADMIN` commands.

```js
const admin = denis.admin(process.env.DENIS_MAIN_TOKEN);
const { token } = await admin.create({ maxKeys: 50000, maxBytes: 10 * 1024 * 1024 });
await admin.usage(token);    // { token, usage: {cachedKeys, cachedBytes, persistedKeys, persistedBytes}, quota: {maxKeys, maxBytes} }
await admin.quota(token, 100000, 0);   // 0 = unlimited
await admin.list();          // [{ token, usage, quota }]
await admin.import(token, { maxKeys: 50000, maxBytes: 0 }); // register a token the engine lost; idempotent -> { token, added }
await admin.flush(token);    // true: every key and table deleted, the project kept
await admin.drop(token);     // true: the project and its data deleted
```

A wrong main token rejects with `ESERVER` and the message `ADMIN refused: wrong main token`. Writes over a quota reject with `ESERVER`, `serverCode: "QUOTA"` and `err.reply.resource` / `err.reply.limit`.

### Backup and transfer: `dump()` / `import()`

`dump()` returns the whole current project: cache and durable values, TTLs, and tables with their schemas and rows. `import()` merges such an object into the current project.

```js
const fs = require("node:fs/promises");

const dump = await denis.dump({ timeout: 60000 });
await fs.writeFile("crm-backup.json", JSON.stringify(dump));

const target = await denis.createProject();
await denis.use(target);
const imported = await denis.import(await fs.readFile("crm-backup.json", "utf8"), { replace: true });
// -> { persistent, cache, tables, rows }
```

`import(data, { replace, timeout, chunkBytes })` takes the dump object or its JSON text. With `replace: true`, existing tables of the same name are replaced; without it, importing a table that already exists fails with `serverCode: "SQL"`.

Dumps larger than `importChunkBytes` are split into several `IMPORT` lines, sent one after another: durable keys in chunks, cache keys in chunks (each with its TTL), and each table on a line of its own. A table larger than one line is created by its first line and continued with `"append": true` lines. If one `IMPORT` line fails, the error carries `err.imported` with the totals of the lines that did succeed.

## Pipelining

Denis answers the commands on a connection in order. So the client writes every command immediately, to the connection with the fewest replies outstanding, and matches each reply to a FIFO of pending promises. You get pipelining without doing anything:

```js
// 10 000 SETs in flight over the pool, a few socket writes in total
await Promise.all(items.map((item) => denis.set(`item:${item.id}`, item)));
```

Concurrent commands can land on different connections. If one command depends on another, `await` the first one, or use an explicit pipeline, which keeps its commands together:

```js
const [ok, value, visits, broken] = await denis
  .pipeline()
  .set("a", "1")
  .get("a")
  .incr("visits")
  .incr("a b")        // invalid key: this slot holds a DenisError(EINVAL)
  .exec();
```

A pipeline has the same command methods as the client (all but `use`, `import`, `admin`, `batch`, `connect` and `close`). `exec()` sends the whole batch in **one write on one connection**. It always resolves to an array with one entry per command, in order: the command's result, or a `DenisError` instance if that command failed. Check the entries with `instanceof DenisError`. After `exec()` the pipeline is empty and can be reused.

Back-pressure: once a connection has `maxPending` commands in flight, new commands wait in the client until a connection has room. A command that waits longer than `commandTimeout` rejects with `ETIMEOUT`.

Numbers from `node bench.js` on one machine (Windows, loopback, pool of 4, 32-byte values): about 16k ops/s sequential (`await` each), about 1M ops/s for concurrent SET/GET, about 850k ops/s with `pipeline()` batches of 1000.

## Errors

Every failure is a `DenisError` with a `code`, and with `reply` (the server's reply) when there was one:

| code | source |
| --- | --- |
| `ESERVER` | the server answered `ok:false`. `err.serverCode` (= `err.reply.code`) holds the server's code: `SQL`, `NOTFOUND`, `QUOTA`, `TYPE`, `RESERVED`, `NOPROJECT`, `FORBIDDEN`, `BUSY`, `LIMIT`, `OOM`, `UNKNOWN`, ... (see [PROTOCOL.md](../../docs/PROTOCOL.md)); Denis Cloud adds `READ_ONLY` and friends |
| `EAUTH` | `LIN` or `AUTH` was refused (wrong group or password, unknown or foreign token, locked out); `serverCode` is `AUTH`, `LOCKED`, ... Denis Cloud: HTTP 401 |
| `ELIMIT` | Denis Cloud: rate limit or daily command budget (HTTP 429) |
| `ECONN` | could not connect, or gave up reconnecting |
| `ETIMEOUT` | no reply within `commandTimeout`, or the connect timed out |
| `ECLOSED` | the connection closed before the reply arrived, or the client is closed |
| `EINVAL` | invalid argument, rejected before sending |
| `EPROTO` | the server does not speak protocol 2 (`MODE json` refused), or a result of the wrong kind (`query()` on a statement without rows) |

```js
try {
  await denis.query("SELECT * FROM nope");
} catch (err) {
  if (err instanceof DenisError && err.serverCode === "SQL") console.error(err.message, err.reply);
}
```

`get()` returns `null` for a missing key and `describe()` returns `null` for a missing table instead of throwing. `serverCode: "BUSY"` means the server's worker queue is full; the command is safe to retry.

## Reconnect

When a pooled connection drops, three things happen:

1. Commands **in flight on it reject with `ECLOSED`**. They are **not** replayed, because the server may already have executed them (for example an `INCR`).
2. The connection is re-opened in the background, with exponential backoff and jitter: `minDelay · 2^(attempt-1)`, capped at `maxDelay`. It then repeats the handshake: `MODE json`, `LIN`, and `AUTH` with the *current* token.
3. New commands go to the other connections, or wait for the reconnect (up to `commandTimeout`).

After `retries` failed attempts the client emits `"error"` and gives up on that connection. If no connection is left, waiting commands reject with the last error (`ECONN`). The next command after that tries to open the pool again.

When a command times out, its connection is destroyed and re-opened the same way. A timeout means the server is stuck or unreachable, so the remaining replies on that connection can't be trusted.

A handshake refusal that retrying won't fix (for example `EAUTH`: a wrong password or an unknown token) stops the retries at once and emits `"error"`. Refusals with `serverCode` `LIMIT`, `BUSY`, `LOCKED` or `INTERNAL` are retried.

With `reconnect: false`, nothing reconnects in the background. A dropped connection is simply re-opened the next time a command needs it.

```js
denis.on("reconnect", ({ attempt, delay, error }) => console.warn(`reconnect #${attempt} in ${delay} ms: ${error.message}`));
denis.on("connect", ({ slot }) => console.info(`connection ${slot} ready`));
denis.on("error", (err) => console.error("denis unavailable:", err.code, err.message));
denis.on("close", () => console.info("client closed"));
```

`"error"` is only emitted when a listener is attached, so an unhandled `"error"` event never crashes the process. Failures always reach the rejected command promises as well.

`close()` sends `EXIT` on every connection after the commands already in flight, and resolves once all sockets are closed. Commands issued after `close()` reject with `ECLOSED`.

## Lower level

`DenisConnection` is a single TCP session: framing, the reply FIFO and the handshake.

```js
const { DenisConnection } = require("denis-client");
const conn = new DenisConnection({ port: 5142, group: "crm", password: "s3cret", token });
await conn.connect();
await conn.handshake();          // MODE json + LIN + AUTH, in one write
await conn.raw("DBSIZE");        // { ok: true, keys: 3, ... }
await conn.quit();
```

`DenisCommands` is the shared API. A subclass that implements `command(line)` (resolving with the parsed reply object) gets every method of the [shared API](#api), which is how `DenisCloud` is built.

## How it talks to the server

On each connection, the client sends `MODE json`, `LIN <group> <password>` and `AUTH <token>` together. After that, every reply is exactly one JSON object per line: `{"ok":true,...}` or `{"ok":false,"error":"...","code":"..."}`.

Replies are split into lines at the byte level, so a multi-byte UTF-8 character that arrives split across two TCP chunks stays intact.

Servers before 0.7 trimmed each command line. For that reason, `set()` appends the no-op flag `-&cache` to empty values and to values that end in whitespace, which keeps them intact. The full protocol is in [docs/PROTOCOL.md](../../docs/PROTOCOL.md).

## Migrating from 0.5 / 1.0

1.1 merges the released 0.5 client (`DenisCommands`, `DenisCloud`, structured SQL, `admin()`) with the unreleased 1.0 rewrite (pipelined pool, reconnect, `pipeline()`, bound parameters, dump/import). Where the two disagreed, 0.5 won, because it is released.

**From 0.5** everything keeps working, with these differences:

- `del()` resolves to whether the key existed (`false` for a missing key) instead of always `true`. It still resolves to `true` when the server does not report it.
- `mget([])` resolves to `{}` instead of rejecting with `EINVAL`.
- `sql()`, `query()` and `execute()` accept bound parameters as a second argument; the `affected` result carries `lastRowId`, and every SQL result may carry `data` (the server's legacy text).
- `set(key, value, { persist: true })` still sends `-&cache -&save`; `{ ttl }` is new.
- The pool still opens connections on demand and sends each command to the least loaded one, but dropped connections are now re-opened in the background with backoff (see [Reconnect](#reconnect)), and `connect()` opens the whole pool instead of one connection. `pipeline: false` is kept (it means `maxPending: 1`).
- `DenisCommands` (and so both clients) is an `EventEmitter`; `DenisClient` emits `connect`, `reconnect`, `error` and `close`.
- `DenisError` gains `serverCode`. `client.token` is read-only (use `use(token)`).
- New: `hello`, `whoami`, `projects`, `use`, `deleteProject`, `incr`/`decr`, `expire`/`ttl`/`persist`, `dbsize`, `dump`/`import`, `backup`/`backups`, `pipeline()`, `DenisClient.batch()`, `queryGraph()`.

**From 1.0** (the unreleased rewrite):

- `query(sql, params)` resolves to the **row objects** (it resolved to `{ columns, rows: [[...]], count, affected, lastRowId, message }`). Use `sql(statement, params)` for the whole structured result and `execute()` for the affected count.
- `sql(statement)` resolves to the structured result (it resolved to the legacy text, now in `result.data`).
- `query()`, `sql()` and `execute()` without `params` send `SQL <statement>`, which must be one line; pass `params` (even `[]`) for multi-line SQL.
- Errors use the 0.5 codes: server errors are `ESERVER` (a refused login or token `EAUTH`) with the server's code in `err.serverCode`. Code that checked `err.code === "SQL"` now checks `err.serverCode === "SQL"`.
- `ping()` resolves to `false` on an `ok:false` reply instead of rejecting.
- `info()` resolves to the whole INFO reply; the 1.0 sections are under `info.info`.
- `save()` resolves to `true`; `command("SAVE")` has the details.
- `set(key, value, { persist: true })` sends `-&cache -&save` (was `-&save`); the stored value is the same.
- The pool opens connections on demand instead of all at once (`connect()` still opens them all).
- The `ProjectInfo` type is the ADMIN project (`{ token, usage, quota }`); the `PROJECTS` entry type is `ProjectListEntry`. `QueryResult` is replaced by `SqlResult`.

## Development

```sh
npm test                    # unit tests against in-process fakes (no Denis needed)
npm run test:integration    # against a real server: DENIS_HOST / DENIS_PORT / DENIS_GROUP / DENIS_PASSWORD / DENIS_MAIN_TOKEN
node bench.js               # ops/s of pipelined SET/GET against a running server
```

The integration tests need an **admin** group (they call `SAVE`/`BACKUP`). They create and delete their own projects; the `admin()` tests run when `DENIS_MAIN_TOKEN` is set. To start a server for them:

```sh
docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=ci -e DENIS_BOOTSTRAP_GROUP_PASSWORD=ci-password denis:local
```
