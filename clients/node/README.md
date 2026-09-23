# denis-client (Node.js)

A Node.js client for [Denis Database](https://github.com/hacimertgokhan/denis), a key-value store with a SQL layer.

- **Pipelined and multiplexed.** Commands go to the least busy pooled connection right away, without waiting for earlier replies. Commands issued in the same tick share one socket write.
- **Reconnects** dropped connections with exponential backoff and jitter, and re-runs the login handshake.
- **SQL with bound parameters**, and **dump/import** for backing up or copying a project.
- Written in plain CommonJS with TypeScript definitions. It has **no dependencies** and needs Node 18+. It speaks Denis wire protocol 2 (Denis 0.1+).

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

await denis.connect();                                        // optional; commands connect on demand
await denis.set("greeting", "hello world");                   // cache only
await denis.set("user:1", { id: 1, name: "Ada" }, { persist: true }); // also the durable log
await denis.set("session:9", "abc", { ttl: 60 });             // cache value expires in 60 s
await denis.get("greeting");                                  // "hello world"
await denis.getJSON("user:1");                                // { id: 1, name: "Ada" }
await denis.get("missing");                                   // null
await denis.incr("visits");                                   // 1

await denis.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
await denis.query("INSERT INTO users (id, name) VALUES (?, ?)", [1, "Ada"]);
await denis.queryObjects("SELECT * FROM users WHERE id = ?", [1]); // [{ id: 1, name: "Ada" }]

await denis.close();
```

## Options

| option | default | |
| --- | --- | --- |
| `host`, `port` | `127.0.0.1`, `5142` | |
| `group`, `password` | none | Login with `LIN`. Leave `group` out to skip login; only `PING`/`HELLO` work then. |
| `token` | none | The project to `AUTH` with. |
| `createProject` | `false` | With no `token`, the first connection runs `AUTH CREATE` and the other connections join that project. Read the token from `client.token`. |
| `poolSize` | `4` | Number of pooled TCP connections. |
| `connectTimeout` | `5000` | ms |
| `commandTimeout` | `10000` | ms per command, counted from the moment it is issued. `0` disables it. |
| `reconnect` | `{ retries: 5, minDelay: 100, maxDelay: 5000 }` | Pass `false` to turn off background reconnects. See [Reconnect](#reconnect). |
| `maxPending` | `10000` | How many commands one connection may have in flight. Beyond that, new commands wait in the client. |
| `importChunkBytes` | `1048576` | `import()` splits dumps larger than this. |

## API

Every method returns a promise.

### Key-value

| method | wire command | resolves to |
| --- | --- | --- |
| `ping()` | `PING` | `true` |
| `hello()` | `HELLO` | `{ server, version, protocol, features, loggedIn }` |
| `get(key, { source })` | `GET key [-&from-protobuff]` | string, or `null` if the key is missing. `source: "protobuf"` prefers the durable value. |
| `getJSON(key, opts)` | `GET` | the value passed through `JSON.parse`, or `null` |
| `set(key, value, { persist, ttl })` | `SET key value [-&save] [-&ttl=s]` | `true`. Non-string values are `JSON.stringify`-ed. |
| `update(key, value)` | `UPDATE key value` | `true` (writes the cache only) |
| `del(key, { cache, protobuf })` | `DEL key [-&cache\|-&protobuff]` | whether the key existed. Both layers by default. |
| `exists(key)` | `EXISTS` | boolean |
| `keys(pattern = "*", { layer, limit })` | `KEYS` | `string[]`. Glob syntax: `*`, `?`, `[a-z]`. `layer` is `"any"`, `"cache"` or `"persistent"`. |
| `mget(keys)` | `MGET` | `{ key: value \| null }` |
| `incr(key, delta = 1, { persist })` | `INCR` | the new number. A missing key counts as 0. |
| `decr(key, delta = 1, { persist })` | `DECR` | the new number |
| `expire(key, seconds)` | `EXPIRE` | whether a cache value got the TTL |
| `ttl(key)` | `TTL` | seconds left. `-1` means no TTL, `-2` means no cache value. |
| `persist(key)` | `PERSIST` | whether a TTL was removed |
| `dbsize()` | `DBSIZE` | `{ keys, cache, persistent, tables }` |
| `clear()` | `HEAVEN` | `true`. Drops every **cache** value of the project; durable values stay. |

Every key has two layers. The **cache** value lives in memory only. The **durable** value is written with `persist: true` to the log and survives restarts. Reads prefer the cache value. A `ttl` expires only the cache value, so a key written with both `persist` and `ttl` falls back to its durable value once the TTL passes.

Keys are one word, with no whitespace. Values can contain spaces, quotes and any Unicode, including empty strings and leading or trailing spaces. They cannot contain line breaks, and no word in them may start with `-&`, the flag marker. To store arbitrary text, `JSON.stringify` or base64-encode it first. Invalid input is rejected locally with `EINVAL` and never reaches the server.

### SQL

| method | resolves to |
| --- | --- |
| `query(sql, params = [])` | `{ columns, rows, count, affected, lastRowId, message }` |
| `queryObjects(sql, params = [])` | rows as objects keyed by column name |
| `sql(statement)` | the 0.0.x text result (`reply.data`). Kept for compatibility. |

Use `query()` from applications. It sends `QUERY {"sql": ..., "params": [...]}`, so parameters are bound by the server and cannot inject SQL. The SQL text may span several lines. Parameters can be strings, numbers, booleans, `null`, `bigint` or `Date` (sent as an ISO string).

```js
const { rows, columns } = await denis.query("SELECT id, name FROM users WHERE name LIKE ?", ["A%"]);
const { affected, lastRowId } = await denis.query("UPDATE users SET name = ? WHERE id = ?", ["Ada L.", 1]);
```

A failing statement rejects with `code: "SQL"`. See [docs/SQL.md](../../docs/SQL.md) for the language.

### Projects and server

| method | resolves to |
| --- | --- |
| `client.token` | the current project token (a getter) |
| `whoami()` | `{ group, admin, project }` |
| `projects()` | `[{ token, owner, keys, tables, current }]` |
| `createProject()` | a new token. The client stays on its current project. |
| `use(token)` | `true`. Runs `AUTH` on every pooled connection; later connections use the new token too. |
| `deleteProject(token)` | `true`. After deleting the current project, the client has no project until the next `use()`. |
| `info()` | the `INFO` object: `server`, `clients`, `stats`, `memory`, `persistence`, `keyspace`, `project` |
| `save()` | admin only: `{ message, bytes, records, millis }` (snapshot) |
| `backup()` | admin only: `{ message, name, path, bytes, createdAt }` |
| `backups()` | admin only: `{ backups: [{ name, path, bytes, createdAt }], directory }` |
| `command(line, { timeout })` | the raw parsed reply of any protocol line. Never throws on `ok:false`. |
| `connect()` | the client, once the pool is open |
| `close()` | resolves once every connection has closed |

`dump`, `save` and `backup` accept `{ timeout }` for long-running calls.

### Backup and transfer: `dump()` / `import()`

`dump()` returns the whole current project: cache and durable values, TTLs, and tables with their schemas and rows. `import()` merges such an object into the current project.

```js
const fs = require("node:fs/promises");

// back up one project
const dump = await denis.dump({ timeout: 60000 });
await fs.writeFile("crm-backup.json", JSON.stringify(dump));

// restore it into a new project
const target = await denis.createProject();
await denis.use(target);
const imported = await denis.import(await fs.readFile("crm-backup.json", "utf8"), { replace: true });
// -> { persistent, cache, tables, rows }
```

`import(data, { replace, timeout, chunkBytes })` takes the dump object or its JSON text. With `replace: true`, existing tables of the same name are replaced; without it, importing a table that already exists fails with `SQL`.

Dumps larger than `importChunkBytes` (default 1 MiB) are split into several `IMPORT` lines, sent one after another:

- durable keys go in chunks,
- cache keys go in chunks, each with its TTL,
- each table gets a line of its own.

The server's `max-line-size` is 8 MB by default, so a single table bigger than that cannot be imported this way.

If one `IMPORT` line fails, the error carries `err.imported` with the totals of the lines that did succeed.

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

A pipeline has the same command methods as the client (all but `use`, `import`, `connect` and `close`). `exec()` sends the whole batch in **one write on one connection**. It always resolves to an array with one entry per command, in order: the command's result, or a `DenisError` instance if that command failed. Check the entries with `instanceof DenisError`. After `exec()` the pipeline is empty and can be reused.

Back-pressure: once a connection has `maxPending` commands in flight, new commands wait in the client until a connection has room. A command that waits longer than `commandTimeout` rejects with `ETIMEOUT`.

Numbers from `node bench.js` on one machine (Windows, loopback, pool of 4, 32-byte values): about 16k ops/s sequential (`await` each), about 1M ops/s for concurrent SET/GET, about 850k ops/s with `pipeline()` batches of 1000. The 0.1 client managed about 12k ops/s concurrent.

## Errors

Every failure is a `DenisError` with a `code`, and with `reply` (the server's reply) when there was one:

| code | source |
| --- | --- |
| `NOAUTH`, `NOPROJECT`, `AUTH`, `LOCKED`, `FORBIDDEN`, `USAGE`, `NOTFOUND`, `SQL`, `OOM`, `PERSISTENCE`, `TYPE`, `RESERVED`, `BUSY`, `LIMIT`, `UNKNOWN`, `INTERNAL` | the server's `code` field (see [PROTOCOL.md](../../docs/PROTOCOL.md)) |
| `ECONN` | could not connect, or gave up reconnecting |
| `ETIMEOUT` | no reply within `commandTimeout`, or the connect timed out |
| `ECLOSED` | the connection closed before the reply arrived, or the client is closed |
| `EINVAL` | invalid argument, rejected before sending |
| `EPROTO` | the server does not speak protocol 2 (`MODE json` refused) |
| `ESERVER` | the server said `ok:false` without a code |

```js
try {
  await denis.query("SELECT * FROM nope");
} catch (err) {
  if (err instanceof DenisError && err.code === "SQL") console.error(err.message, err.reply);
}
```

`get()` returns `null` for `NOTFOUND` instead of throwing. `BUSY` means the server's worker queue is full; the command is safe to retry.

Upgrading from 0.1: login failures now reject with the server's code `AUTH` (it was `EAUTH`). Other server errors use their server code (it was `ESERVER`). `del()` resolves to whether the key existed.

## Reconnect

When a pooled connection drops, three things happen:

1. Commands **in flight on it reject with `ECLOSED`**. They are **not** replayed, because the server may already have executed them (for example an `INCR`).
2. The connection is re-opened in the background, with exponential backoff and jitter: `minDelay · 2^(attempt-1)`, capped at `maxDelay`. It then repeats the handshake: `MODE json`, `LIN`, and `AUTH` with the *current* token.
3. New commands go to the other connections, or wait for the reconnect (up to `commandTimeout`).

After `retries` failed attempts the client emits `"error"` and gives up on that connection. If no connection is left, waiting commands reject with the last error (`ECONN`). The next command after that tries to open the pool again.

When a command times out, its connection is destroyed and re-opened the same way. A timeout means the server is stuck or unreachable, so the remaining replies on that connection can't be trusted.

Some handshake refusals won't be fixed by retrying: `AUTH`, `FORBIDDEN`, `USAGE` and `NOAUTH`. After one of those the client stops retrying and emits `"error"` right away.

With `reconnect: false`, nothing reconnects in the background. A dropped connection is simply re-opened the next time a command needs it.

```js
denis.on("reconnect", ({ attempt, delay, error }) => console.warn(`reconnect #${attempt} in ${delay} ms: ${error.message}`));
denis.on("connect", ({ slot }) => console.info(`connection ${slot} ready`));
denis.on("error", (err) => console.error("denis unavailable:", err.code, err.message));
denis.on("close", () => console.info("client closed"));
```

`"error"` is only emitted when a listener is attached, so an unhandled `"error"` event never crashes the process. Failures always reach the rejected command promises as well.

`close()` sends `EXIT` on every connection after the commands already in flight, and resolves once all sockets are closed. Commands issued after `close()` reject with `ECLOSED`.

## Lower level: `DenisConnection`

`DenisConnection` is a single TCP session: framing, the reply FIFO and the handshake. You can use it on its own:

```js
const { DenisConnection } = require("denis-client");
const conn = new DenisConnection({ port: 5142, group: "crm", password: "s3cret", token });
await conn.connect();
await conn.handshake();          // MODE json + LIN + AUTH, in one write
await conn.raw("DBSIZE");        // { ok: true, keys: 3, ... }
await conn.quit();
```

## How it talks to the server

On each connection, the client sends `MODE json`, `LIN <group> <password>` and `AUTH <token>` together. After that, every reply is exactly one JSON object per line: `{"ok":true,...}` or `{"ok":false,"error":"...","code":"..."}`.

Replies are split into lines at the byte level, so a multi-byte UTF-8 character that arrives split across two TCP chunks stays intact.

The server trims each command line. For that reason, `set()` appends the no-op flag `-&cache` to empty values and to values that end in whitespace, which keeps them intact. The full protocol is in [docs/PROTOCOL.md](../../docs/PROTOCOL.md).

## Development

```sh
npm test                    # unit tests against an in-process fake server (no Denis needed)
npm run test:integration    # against a real server: DENIS_HOST / DENIS_PORT / DENIS_GROUP / DENIS_PASSWORD
node bench.js               # ops/s of pipelined SET/GET against a running server
```

The integration tests need an **admin** group (they call `SAVE`/`BACKUP`). They create and delete their own projects. To start a server for them:

```sh
docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=ci -e DENIS_BOOTSTRAP_GROUP_PASSWORD=ci-password denis:local
```
