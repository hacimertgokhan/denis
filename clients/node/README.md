# denis-client (Node.js)

Promise based client for [Denis Database](https://github.com/hacimertgokhan/denis)
with two transports and one API: `DenisClient` talks TCP to a server you run,
`DenisCloud` talks HTTPS to a database on Denis Cloud with an API key.
No dependencies, Node 18+.

```sh
npm install denis-client        # or: npm install github:hacimertgokhan/denis#master:clients/node
```

```js
const { DenisClient } = require("denis-client");

const denis = new DenisClient({
  host: "127.0.0.1",
  port: 5142,
  group: "crm",            // LIN <group> <password>
  password: "s3cret",
  token: process.env.DENIS_TOKEN,  // AUTH <token> — or createProject: true
  poolSize: 4,
});

await denis.set("greeting", "hello world");          // cache only
await denis.set("user:1", { id: 1, name: "Ada" }, { persist: true }); // also protobuf (-&save)
await denis.get("greeting");                          // "hello world"
await denis.getJSON("user:1");                        // { id: 1, name: "Ada" }
await denis.get("missing");                           // null
await denis.update("greeting", "hi");                 // cache-only overwrite
await denis.del("greeting");
await denis.exists("user:1");                         // true
await denis.keys("user:*");                           // ["user:1"]
await denis.mget(["user:1", "nope"]);                 // { "user:1": "...", nope: null }
await denis.execute("CREATE TABLE users (id INT, name TEXT)");   // 0 (affected rows)
await denis.execute("INSERT INTO users (id, name) VALUES (1, 'Ada')"); // 1
await denis.query("SELECT * FROM users WHERE id = 1");            // [{ id: 1, name: "Ada" }]
await denis.tables();                                 // [{ name: "users", columns: [...], rows: 1 }]
await denis.info();                                   // { version, uptimeSeconds, connections, ... }
await denis.clear();                                  // HEAVEN: drop the project's cached keys
await denis.close();
```

## Denis Cloud

A hosted database (denis.hacimertgokhan.com) is reached through its REST
gateway, never over TCP. Create an API key in the database’s **Connect** tab
and use it with `DenisCloud`; every method below works the same way:

```js
const { DenisCloud } = require("denis-client");

const denis = new DenisCloud({ apiKey: process.env.DENIS_API_KEY });
await denis.set("greeting", "hello world", { persist: true });
await denis.get("greeting");                                   // "hello world"
await denis.execute("CREATE TABLE products (id INT, name TEXT, price REAL)");
await denis.query("SELECT name FROM products WHERE price > 10"); // [{ name: "Book" }]
await denis.batch(["GET greeting", "EXISTS nope"]);              // up to 50 commands in one request
await denis.usage();   // { usage: {persistedKeys, persistedBytes, opsToday, ...}, limits: {maxKeys, maxBytes, opsPerDay} }
```

Options: `apiKey` (or `accessToken`), `url` (default the public platform;
use `http://localhost:3000` for a local one), `useJwt: true` to exchange the
key for short-lived access tokens that are refreshed automatically, `timeout`
(ms per request) and `fetch`. A read-scoped key can only run read commands:
writes fail with `DenisError` code `ESERVER` and `err.reply.code === "READ_ONLY"`;
a spent daily budget answers `ELIMIT`. `whoami()` returns the database and
scope behind the credential. `createProject()`, `admin()` and `info()`
are TCP-only: the platform manages projects itself.

## API

| Method | Wire command | Notes |
| --- | --- | --- |
| `ping()` | `PING` | works before login |
| `get(key, {source})` | `GET key [-&from-cache\|-&from-protobuff]` | `null` when missing |
| `getJSON(key)` | | `JSON.parse` of `get()` |
| `set(key, value, {persist})` | `SET key value [-&cache -&save]` | objects are `JSON.stringify`-ed |
| `update(key, value)` | `UPDATE key value` | cache only |
| `del(key, {cache, protobuf})` | `DEL key [-&cache\|-&protobuff]` | default: both |
| `exists(key)` | `EXISTS key` | boolean |
| `keys(pattern)` | `KEYS pattern` | glob with `*` and `?`, default `*` |
| `mget(keys)` | `MGET k1 k2` | object, missing keys are `null` |
| `clear()` | `HEAVEN` | current project only |
| `save()` | `SAVE` | flush the persisted store now |
| `info()` | `INFO` | server statistics object |
| `help()` | `HELP` | command reference `[{name, usage, description}]` |
| `sql(query)` | `SQL ...` | structured result: `{type:"rows",columns,rows,count}` | `{type:"affected",affected,message}` | `{type:"tables",tables}` |
| `query(select)` | `SQL SELECT ...` | the row objects |
| `execute(statement)` | `SQL INSERT/UPDATE/...` | the affected row count |
| `tables()` / `describe(table)` | `SHOW TABLES` / `DESCRIBE` | `[{name, columns: [{name, type}], rows}]` |
| `createProject()` | `AUTH CREATE` | returns a new token |
| `command(line)` | any | raw reply object |
| `close()` | `EXIT` | closes the pool |

Commands are **pipelined**: a connection can have several commands in flight and
replies are matched in order, so `Promise.all` of many operations uses the pool
efficiently. Pass `pipeline: false` for one command per connection at a time.

Keys are one word (no whitespace). Values may contain spaces, quotes and unicode
but not line breaks, and no word may start with `-&` (that is the flag marker).

Errors are `DenisError` with a `code`: `ECONN`, `ETIMEOUT`, `EAUTH`, `EPROTO`,
`ESERVER` (the server said `ok:false`; the reply is in `err.reply`), `ECLOSED`, `EINVAL`,
`ELIMIT` (Denis Cloud: rate limit or daily budget).

## How it talks to the server

Each pooled connection sends `MODE json` first, so every reply is one JSON
object per line (`{"ok":true,...}` / `{"ok":false,"error":...}`), then `LIN`
and `AUTH`. Commands on a connection are answered in order, which is what makes
the FIFO of pending promises safe. The pool grows on demand up to `poolSize`.

## Tests

```sh
docker run -d -p 5142:5142 -e DENIS_BOOTSTRAP_GROUP=crm -e DENIS_BOOTSTRAP_GROUP_PASSWORD=s3cret denis:local
DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret npm test
```

Without `DENIS_INTEGRATION=1` the suite is skipped.
