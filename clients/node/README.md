# denis-client (Node.js)

Promise based, pooled TCP client for [Denis Database](https://github.com/hacimertgokhan/denis).
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
await denis.sql("CREATE TABLE users (id INT, name TEXT)");
await denis.clear();                                  // HEAVEN: drop the project's cached keys
await denis.close();
```

## API

| Method | Wire command | Notes |
| --- | --- | --- |
| `ping()` | `PING` | works before login |
| `get(key, {source})` | `GET key [-&from-cache\|-&from-protobuff]` | `null` when missing |
| `getJSON(key)` | | `JSON.parse` of `get()` |
| `set(key, value, {persist})` | `SET key value [-&cache -&save]` | objects are `JSON.stringify`-ed |
| `update(key, value)` | `UPDATE key value` | cache only |
| `del(key, {cache, protobuf})` | `DEL key [-&cache\|-&protobuff]` | default: both |
| `clear()` | `HEAVEN` | current project only |
| `sql(query)` | `SQL ...` | returns the engine's text |
| `createProject()` | `AUTH CREATE` | returns a new token |
| `command(line)` | any | raw reply object |
| `close()` | `EXIT` | closes the pool |

Keys are one word (no whitespace). Values may contain spaces, quotes and unicode
but not line breaks, and no word may start with `-&` (that is the flag marker).

Errors are `DenisError` with a `code`: `ECONN`, `ETIMEOUT`, `EAUTH`, `EPROTO`,
`ESERVER` (the server said `ok:false`; the reply is in `err.reply`), `ECLOSED`, `EINVAL`.

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
