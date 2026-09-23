# Denis Java Driver

Java client for [Denis Database](https://github.com/hacimertgokhan/denis), for Denis 0.7 (wire protocol 2) and, with the 0.3-0.6 subset of commands, earlier servers. `admin`, quotas and
`queryGraph` need a server with `ADMIN` and `QUERY` documents.

- **No runtime dependencies.** A small built-in JSON codec replaces org.json.
- **Java 11+** (compiled with `--release 11`).
- **Thread-safe with pipelining.** One `DenisClient` serves your whole application. It uses a small pool of pipelined connections, so many threads share a few sockets without waiting on each other's round trips.
- **Three calling styles:** blocking, `CompletableFuture` (`client.async()`) and explicit batches (`client.pipeline()`).
- **Recovers from dropped connections.** It reconnects with backoff and replays the login and project selection. It never silently re-sends a command that may already have run.
- **Typed results and errors:** `QueryResult`, `TableInfo`, `ServerInfo`, `ProjectUsage`, `DbSize`..., plus `DenisException` with machine-readable codes (`DenisQuotaException` when a project is full).
- **Everything the 1.2 driver had** (`sql`, `query`, `execute`, `tables`, `exists`, `keys`, `mget`, `info`, `save`), plus
  project administration with the main token (`client.admin(mainToken)`), quotas and `QUERY` documents
  (`queryGraph`). See [Migrating](#migrating) for the few renamed methods.

## Installation

Maven:

```xml
<dependency>
    <groupId>github.hacimertgokhan.java-driver</groupId>
    <artifactId>denis-driver</artifactId>
    <version>2.1.0</version>
</dependency>
```

Gradle:

```kotlin
implementation("github.hacimertgokhan.java-driver:denis-driver:2.1.0")
```

The artifact is published to GitHub Packages
(`https://maven.pkg.github.com/hacimertgokhan/denis`, see the `distributionManagement` of the pom). To use a
local build instead:

```sh
cd java-driver && mvn install        # installs denis-driver-2.1.0.jar into ~/.m2
```

The jar declares the automatic module name `github.hacimertgokhan.drivers`.

## Quick start

```java
import github.hacimertgokhan.drivers.*;
import java.time.Duration;

try (DenisClient client = DenisClient.builder()
        .host("127.0.0.1").port(5142)
        .credentials("crm", "s3cret with spaces")   // LIN <group> <password>
        .createProject(true)                        // or .token(existingToken)
        .build()) {                                 // connects now; fails fast on bad credentials

    client.set("greeting", "hello world");
    client.get("greeting");                          // "hello world"
    client.get("missing");                           // null
    client.set("session:42", "{\"user\":1}", SetOptions.persist().ttl(Duration.ofMinutes(30)));
    long visits = client.incr("visits");

    client.sql("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)");
    client.query("INSERT INTO users (id, name, age) VALUES (?, ?, ?)", 1, "Ada", 36);
    QueryResult r = client.query("SELECT name FROM users WHERE age > ?", 30);
    String name = r.getString(0, "name");            // "Ada"

    String token = client.token();                   // keep it to reopen the project later
}
```

## Configuration

| builder method | default | meaning |
| --- | --- | --- |
| `host(String)`, `port(int)` | `127.0.0.1`, `5142` | server address |
| `credentials(group, password)` | none | group login (`LIN`); the password may contain spaces |
| `token(String)` | none | project to select after login (`AUTH <token>`) |
| `createProject(boolean)` | `false` | create a project on connect when no token is set; read it with `client.token()` |
| `poolSize(int)` | `2` | pipelined connections (1..64) |
| `connectTimeout(Duration)` | 5 s | TCP connect timeout |
| `commandTimeout(Duration)` | 10 s | how long a command may wait for its reply; `Duration.ZERO` disables timeouts |
| `reconnect(boolean)` | `true` | re-open dropped connections in the background and replay the handshake |
| `reconnectBackoff(min, max)` | 100 ms, 5 s | first retry delay, doubled up to `max` |
| `importChunkBytes(int)` | 4 MiB | target size of one `IMPORT` line when `importDump` splits a dump |
| `maxReplyBytes(long)` | 256 MiB | largest reply line accepted |
| `shutdownTimeout(Duration)` | 2 s | how long `close()` lets in-flight commands finish |

`build()` connects every connection and runs the handshake: `MODE json`, `LIN group password`, then
`AUTH token` or `AUTH CREATE`. `buildLazy()` returns an unconnected client that connects on first use.

The 1.x style still works:

```java
DenisClient client = new DenisClient("localhost", 5142);   // one connection, connects on connect()/first use
client.connect();
client.login("crm", "s3cret");
String token = client.createProject();                     // creates and selects; or client.authenticate(token)
client.set("user:1", "{\"id\":1}", true);                  // true = also durable (-&save)
client.close();
```

## API

All methods below block until the reply arrives. The same methods, returning `CompletableFuture`s, are
on `client.async()`, and on `Pipeline` (except the session commands, `importDump` and `admin`).

### Session and projects

| method | command | returns |
| --- | --- | --- |
| `login(group, password)` | `LIN` | applied to every connection; a different group drops the selected project |
| `use(token)` / `authenticate(token)` | `AUTH <token>` | applied to every connection |
| `createProject()` | `AUTH CREATE` + `AUTH` | the new token (128 chars), also selected |
| `createProject(false)` | `AUTH CREATE` | the new token, not selected |
| `deleteProject(token)` | `AUTH DELETE` | deletes all its keys and tables; deleting the selected one leaves the client without a project |
| `projects()` | `PROJECTS` | `List<Project>`: `token()`, `owner()`, `keys()`, `tables()`, `current()` |
| `token()` / `getToken()` | | the selected project's token, or `null` |
| `whoami()` | `WHOAMI` | `Map`: `group`, `admin`, `project` |
| `ping()` | `PING` | `true` |
| `hello()` | `HELLO` | `ServerHello`: `version()`, `protocol()`, `features()`, `hasFeature(...)` |
| `info()` | `INFO` | `ServerInfo`: `version()`, `uptimeSeconds()`, `openConnections()`, `commandsTotal()`, `cacheKeys()`, `persistedKeys()`, `projects()`, `memoryUsedMb()`, `project()` (usage and quota); `details()` / `section("persistence")` for the detailed sections `server`, `clients`, `stats`, `memory`, `persistence`, `keyspace`, `project`; `asMap()` for the whole reply |
| `help()` | `HELP` | the server's command list |

### Keys

Each key has a **cache** value (memory only) and a **durable** value (written to the log, survives
restarts). Reads prefer the cache value.

| method | command | returns |
| --- | --- | --- |
| `get(key)` | `GET` | the value, or `null` when missing |
| `find(key)` | `GET` | `Optional<String>` |
| `getPersistent(key)` | `GET -&from-protobuff` | the durable value (falls back to the cache value) or `null` |
| `set(key, value)` | `SET` | cache value only |
| `set(key, value, SetOptions.persist())` | `SET -&save` | cache and durable value |
| `set(key, value, SetOptions.cache().ttl(d))`, `set(key, value, Duration)` | `SET -&ttl=<s>` | cache value expires (ms precision) |
| `set(key, value, boolean persist)` | | 1.x signature |
| `update(key, value)` | `UPDATE` | overwrite the cache value |
| `del(key)` / `delete(key)` | `DEL` | `true` if the key existed; both layers |
| `del(key, DelOptions.cacheOnly())`, `DelOptions.persistentOnly()` | `DEL -&cache` / `-&protobuff` | one layer |
| `exists(key)` | `EXISTS` | `boolean` |
| `keys()`, `keys("user:*")`, `keys(p, KeysOptions.cacheOnly().limit(100))` | `KEYS` | `List<String>`; glob `*`, `?`, `[a-z]`; capped by the server's `keys-limit` |
| `mget("a", "b")`, `mget(collection)` | `MGET` | `Map<String,String>` in request order, `null` for missing keys |
| `incr(key)`, `incrBy(key, n)`, `incrBy(key, n, persist)`, `decr(key)`, `decrBy(key, n)` | `INCR` / `DECR` | the new value; a missing key counts as 0 |
| `expire(key, Duration)` | `EXPIRE` | `true` if the key had a cache value |
| `ttl(key)` / `pttl(key)` | `TTL` | seconds (rounded up) / milliseconds; `-1` no TTL, `-2` no cache value |
| `persist(key)` | `PERSIST` | removes the TTL |
| `dbsize()` | `DBSIZE` | `DbSize`: `keys()`, `cache()`, `persistent()`, `tables()` |
| `clear()` | `HEAVEN` | drops every cache value of the project (durable values stay); returns how many (`-1` if the server does not say) |

**Keys** are one word: no whitespace or control characters, and they must not start with `-&`.
**Values** may be empty and may contain spaces, quotes and any Unicode. They cannot contain line breaks or
a space-separated word that starts with `-&` (the protocol uses those as flags). Encode such data first,
for example as JSON or base64. The driver checks these rules before sending and throws `DenisException`
with code `INVALID`, so nothing reaches the server.

### SQL

```java
client.sql("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)");

// parameters are bound by the server: immune to SQL injection, and the parsed statement is cached
client.query("INSERT INTO users (id, name, age) VALUES (?, ?, ?)", 2, "Bob'); DROP TABLE users; --", 25);
QueryResult r = client.query("SELECT * FROM users WHERE age > ? ORDER BY id", 20);

r.columns();                 // ["id", "name", "age"]
r.rows();                    // List<List<Object>>: String, Long, Double, Boolean or null
r.size();
r.getLong(0, "id");          // 2   (also getString / getDouble / getBoolean / get)
r.toMaps();                  // [{id=2, name=..., age=25}]

QueryResult change = client.query("UPDATE users SET age = age + 1 WHERE id = ?", 2);
change.affected();           // 1
change.lastRowId();          // for inserts, else null
change.message();            // the server message, e.g. "1 row inserted"

int n = client.execute("DELETE FROM users WHERE age < ?", 18);   // affected rows; a SELECT here throws

QueryResult any = client.sql("SHOW TABLES");       // structured result of any statement, no parameters
any.type();                  // "rows", "affected" or "tables"
any.asMap();                 // the reply object: {"type":"tables","tables":[...],"count":1}

List<TableInfo> tables = client.tables();          // SHOW TABLES
TableInfo users = client.describe("users");         // DESCRIBE users
users.columnNames();         // ["id", "name", "age"]
users.column("age").type();  // "INTEGER"
users.rows();                // row count

String text = client.sqlText("SELECT * FROM users");   // the text form: "OK: ..." or a JSON array of rows
```

| method | returns |
| --- | --- |
| `query(sql, params...)`, `query(sql, List)` | `QueryResult` of any statement, parameters bound by the server |
| `sql(statement)` | the same without parameters (1.2 name) |
| `execute(sql, params...)`, `execute(sql, List)` | `int` affected rows; fails if the statement returns rows |
| `tables()` / `describe(table)` | `List<TableInfo>` / `TableInfo`: `name()`, `columns()` (`name()`, `type()`, `get(attr)`), `rows()` |
| `sqlText(statement)` | the text form (2.0's `sql`) |

`QueryResult.type()` is `rows` (a query: `columns()`, `rows()`, `toMaps()`), `affected` (a change:
`affected()`, `message()`, `lastRowId()`) or `tables` (`SHOW TABLES` / `DESCRIBE`: `tables()`, also readable
as rows with the columns `name`, `columns`, `rows`). The server sends each row as a JSON object; `rows()` and
`toMaps()` keep the column order of the reply's `columns` (the `SELECT` list).

Parameters can be `null`, `String`, any `Number`, `Boolean`, `UUID`, enums (sent by name) or `java.time`
values (sent as ISO text). A failed statement throws `DenisSqlException` (code `SQL`, `data()` = `"ERROR: ..."`).
Statements may span several lines: every SQL method sends them as `QUERY {"sql":...,"params":[...]}`.
JSON does not distinguish `2.0` from `2`, so a whole `REAL` value comes back as a `Long`. Use
`getDouble` for `REAL` columns.

### QUERY documents: many reads in one round trip

```java
GraphResult r = client.queryGraph("{"
        + " user: get(\"user:1\") { name address { city } }"
        + " orders: table(\"orders\", where: \"user_id = 1\", order: \"total desc\", limit: 5) { id total }"
        + " n: count(\"orders\")"
        + "}");
Map<String, Object> user = (Map<String, Object>) r.get("user");   // only the selected fields
List<Object> orders = (List<Object>) r.get("orders");
r.errors();                  // fields that failed: path() and error(); they are null in data()
```

The document is resolved on the server (`get`, `mget`, `prefix`, `keys`, `exists`, `count`, `table`, `sql`,
`tables`, `describe`; all read-only, see `docs/PROTOCOL.md`). Objects come back as `Map`, arrays as `List`.
`graph(document)` is the same method under the Node.js driver's name. Line breaks between tokens are sent as
spaces; a syntax error throws `DenisException` whose `reply()` has
the `offset`.

### Asynchronous API

```java
DenisAsync async = client.async();
CompletableFuture<String> name = async.get("user:1:name");
async.incr("visits").thenAccept(n -> log.info("visit #" + n));
CompletableFuture.allOf(async.set("a", "1"), async.set("b", "2")).join();
```

Every command is available. Commands are written immediately, and one thread's commands are coalesced
into few system calls. Futures complete on the connection's reader thread. Keep callbacks short, or attach
them with `thenApplyAsync(..., yourExecutor)`. A blocking `DenisClient` call inside such a callback is
rejected with `INVALID`, because it would wait for a reply that only that thread can read.
`async.use/login/createProject/deleteProject` run on a driver worker thread.

### Pipelining

```java
Pipeline p = client.pipeline();
for (int i = 0; i < 10_000; i++) {
    p.set("item:" + i, "value " + i);
}
CompletableFuture<String> first = p.get("item:0");   // each command also returns its own future
List<Object> results = p.execute();                  // one write, replies in order
```

The result list has one entry per command, in order. Each entry is the command's value (`null` for commands
without one, such as `set`) or the `DenisException` it failed with. One failure does not stop the others.
A pipeline is not a transaction: other clients' commands may interleave on the server. It is also not
thread-safe. After `execute()` / `executeAsync()` the pipeline is empty and can be reused.

### Dump and import

```java
String dump = source.dump();                         // keys, TTLs and tables of the current project, as JSON
ImportResult r = target.importDump(dump, false);     // merge into the target's current project
r.persistent(); r.cache(); r.tables(); r.rows();
target.importDump(dump, true);                       // replace tables that already exist
```

Dumps larger than `importChunkBytes` are split into several `IMPORT` lines: keys in batches, each table on
its own line. A table larger than one line is created by the first line and filled by `"append":true`
lines (this needs a server with `IMPORT` append support). The lines are sent one after another, and the
import stops at the first failure.

### Administration (admin groups)

```java
SaveInfo s = client.save();              // SAVE: bytes(), records(), millis()
BackupInfo b = client.backup();          // BACKUP: name(), path(), bytes(), createdAt()
List<BackupInfo> all = client.backups(); // BACKUPS
```

Other groups get `DenisAuthException` with code `FORBIDDEN`.

### Project administration and quotas (main token)

`ADMIN <main-token> ...` manages every project with the server's `ddb-main-token` (`DDB_MAIN_TOKEN`). It
needs no group login, so the client can be built without credentials:

```java
try (DenisClient client = DenisClient.builder().host("db.internal").build()) {
    DenisAdmin admin = client.admin(System.getenv("DENIS_MAIN_TOKEN"));
    String token = admin.create(10_000, 64L * 1024 * 1024);   // ADMIN CREATE: max keys, max bytes (0 = unlimited)
    List<ProjectUsage> all = admin.list();                    // ADMIN LIST
    ProjectUsage u = admin.usage(token);                      // ADMIN USAGE: cachedKeys(), cachedBytes(),
                                                              //   persistedKeys(), persistedBytes(), maxKeys(), maxBytes()
    admin.quota(token, 0, 0);                                 // ADMIN QUOTA: change or lift the limits
    admin.importProject(knownToken);                          // ADMIN IMPORT: re-register a token (idempotent)
    admin.flush(token);                                       // ADMIN FLUSH: delete its keys and tables
    admin.drop(token);                                        // ADMIN DROP: delete the project
    admin.async().list();                                     // the same as CompletableFutures
}
```

Limits apply to the cache and the persisted store separately. A write over the limit throws
`DenisQuotaException` (code `QUOTA`) with `resource()` (`"keys"` or `"bytes"`) and `limit()`. A multi-row
`INSERT` may have stored the rows before the one that hit the limit. A wrong main token fails with
`DenisAuthException` (code `AUTH`); the driver never puts the main token in its error messages.

### Raw commands

```java
Map<String, Object> reply = client.command("DBSIZE");   // the reply object without "ok"
```

An `"ok":false` reply throws a `DenisException` whose `reply()` holds the whole reply. `MODE`, `EXIT`/`QUIT`,
`LIN` and `AUTH <token>` are rejected, because they would desynchronise the pooled connections. Use
`login` and `use` instead.

## Errors

Every error is an unchecked `DenisException`. `code()` is machine readable, and `reply()` returns the
server's reply object (or `null` for errors raised by the driver).

| code | class | meaning |
| --- | --- | --- |
| `AUTH`, `NOAUTH`, `NOPROJECT`, `LOCKED`, `FORBIDDEN` | `DenisAuthException` | wrong credentials, login or project missing, too many failed logins, admin required |
| `SQL` | `DenisSqlException` | the statement failed; `data()` is the 0.0.x `ERROR: ...` text |
| `QUOTA` | `DenisQuotaException` | the project reached its quota; `resource()`, `limit()` |
| `CONNECTION` | `DenisConnectionException` | cannot connect, or no connection available within the command timeout |
| `CLOSED` | `DenisConnectionException` | the connection or client closed while the command was in flight: **outcome unknown** |
| `TIMEOUT` | `DenisTimeoutException` | no reply within the command timeout: **outcome unknown** |
| `INVALID` | `DenisException` | the arguments cannot be expressed in the protocol; nothing was sent |
| `PROTOCOL` | `DenisException` | the server sent something unexpected (the connection is closed) |
| `BUSY` | `DenisException` | the server's worker queue is full; `isRetryable()` is `true` |
| `OOM`, `PERSISTENCE`, `TYPE`, `RESERVED`, `USAGE`, `LIMIT`, `UNKNOWN`, `INTERNAL`, `IO` | `DenisException` | as reported by the server (see `docs/PROTOCOL.md`) |

`GET` of a missing key is not an error: it returns `null`.

Servers of the master line up to 0.6 send errors without a `code`. The driver then derives it from the documented
messages (`not found`, `Please login first...` → `NOAUTH`, `Login failed`/`ADMIN refused` → `AUTH`,
`quota exceeded` → `QUOTA`, `Unknown command` → `UNKNOWN`...) and treats other failures of SQL methods as `SQL`.

## Connections, thread safety and failure handling

- `DenisClient` is thread-safe; create one per application (per server and project) and share it.
- Each pooled connection has a buffered writer, protected by a lock, and one daemon reader thread. The
  reader completes the oldest pending request whenever a reply line arrives, because the server answers
  in order. Writers only flush when needed: a burst from many threads, or from one async producer, goes
  out in a few system calls.
- Routing: a blocking call or a pipeline goes to the connection with the fewest requests in flight, so a
  slow `SAVE` or big `SELECT` on one connection does not delay it. Async calls stay on their thread's
  connection so they batch well, and move elsewhere when that connection has been waiting on a command
  for over 1 ms.
- **Timeouts:** a command whose reply has not arrived within `commandTimeout` fails with `TIMEOUT`. The
  clock starts when the command is sent, or when the previous reply on its connection arrived if that is
  later. The connection is then closed, because it is stuck or too slow, and its other in-flight commands
  fail with `CLOSED`. A single blocking call never waits longer than `commandTimeout`; `Pipeline.execute()`
  and `importDump` wait until each of their commands has completed or timed out.
- **Reconnect:** with `reconnect(true)`, a dropped connection is re-opened in the background with
  exponential backoff and replays `MODE json`, `LIN` and `AUTH` with the current session. Commands issued
  while no connection is open wait for one, up to `commandTimeout`, then fail with `CONNECTION`. Commands
  that were already written are **never re-sent**: the driver cannot know whether the server executed
  them, so they fail with `CLOSED` and you decide whether retrying is safe.
- `login`, `use` and `createProject` change the session of every pooled connection. Call them during
  setup rather than concurrently with other commands, or use one client per project.
- `close()` stops accepting commands, gives in-flight ones up to `shutdownTimeout` to finish, then closes
  the sockets. All driver threads are daemon threads (`denis-reader-*`, `denis-timer-*`, `denis-worker-*`).
- Logging uses `System.Logger` (`java.util.logging` by default): a warning when a connection is lost,
  info when it is re-established.

## Performance

`PipelineBenchmark` (test scope) runs against a local server (Denis 0.7.0, Windows 11, 32 cores,
loopback, 32-byte values, pool of 4 connections):

| scenario | ops/s |
| --- | --- |
| blocking `set`, 1 thread (one round trip each) | ~28,000 |
| blocking `set`, 16 threads sharing one client | ~160,000 |
| `Pipeline` `set`, batches of 1000 | ~1,200,000 |
| `Pipeline` `get`, batches of 1000 | ~840,000 |
| `async().set`, 1 thread, max 4096 in flight | ~1,100,000 |
| `async().set`, 1 thread, unbounded | ~1,650,000 |
| `async().incr` on one hot key, 4096 in flight | ~1,200,000 |

```sh
mvn -q test-compile
DENIS_PORT=5142 DENIS_GROUP=ci DENIS_PASSWORD=ci-password \
  java -cp "target/classes:target/test-classes" github.hacimertgokhan.drivers.PipelineBenchmark 200000
```

(On Windows, separate the class path with `;`.)

## Migrating

2.1 merges the two driver lines: the released 1.2 (master) and 2.0. Where both had a method with the same name
but different behaviour, 2.1 keeps the 1.2 behaviour under the released name and gives the 2.0 behaviour a new
name.

### From 1.2 (and 1.1)

The method names are the same; results are typed instead of `org.json` objects:

| 1.2 | 2.1 |
| --- | --- |
| `JSONObject sql(stmt)` | `QueryResult sql(stmt)`: `type()`, `columns()`, `rows()`, `toMaps()`, `affected()`, `tables()`; `asMap()` is the former `JSONObject` as a `Map` |
| `JSONArray query(select)` | `QueryResult query(sql, params...)`: `toMaps()` is the former row array; a statement without rows returns its `affected()` instead of throwing |
| `int execute(stmt)` | `int execute(sql, params...)` (unchanged, now with optional parameters) |
| `JSONArray tables()` | `List<TableInfo> tables()`, plus `describe(table)` |
| `JSONObject info()` | `ServerInfo info()`: typed accessors, `get("version")`, `has(...)`, `asMap()` |
| `Map mget(List)`, `List keys(pattern)`, `boolean exists(key)` | unchanged |
| `void save()`, `void delete(key)`, `void clear()` | return `SaveInfo`, `boolean` (existed), `long` (removed); ignoring the result still compiles |
| `throws IOException` | unchecked `DenisException` everywhere; remove the `catch (IOException e)` blocks |
| `new DenisException(String)` on any failure | subclasses and `code()`: `DenisAuthException`, `DenisSqlException`, `DenisQuotaException`... |

- `ConnectionManager`, `AuthOperation` and `DataOperation` were removed. Use `DenisClient` (or
  `client.command(...)` for raw lines).
- `org.json` is no longer a dependency. If your code used it through the driver, add it yourself.
- Clients are thread-safe now; the one-client-per-thread workaround is no longer needed.
- `new DenisClient(host, port)`, `connect()`, `login`, `authenticate`, `createProject`, `getToken`, `get`,
  `set(key, value[, persist])`, `update` and `ping` work as before.

### From 2.0

| 2.0 | 2.1 |
| --- | --- |
| `String sql(stmt)` (text form) | `String sqlText(stmt)`; `sql(stmt)` now returns the structured `QueryResult` (1.2 semantics) |
| `Map info()` (the detailed sections) | `info().details()`, or `info().section("stats")`; `info()` now returns `ServerInfo` (1.2 semantics: the top-level summary) |
| `void clear()` / `CompletableFuture<Void> clear()` | returns the number of removed cache values (`long` / `CompletableFuture<Long>`) |
| `QueryResult.isResultSet()` | unchanged; `type()` tells `rows`, `affected` and `tables` apart |

Code that ignored the results of `sql` or `clear` compiles unchanged, but must be recompiled (the return types
changed). On `Pipeline`, `execute()` without arguments still sends the batch; `execute(sql, params...)` queues a
statement.

## Tests

```sh
mvn test                                    # JSON codec + client tests against an in-process fake server
DENIS_INTEGRATION=1 DENIS_PORT=5142 DENIS_GROUP=ci DENIS_PASSWORD=ci-password mvn test   # + a live server
```

The integration tests need an admin group (for `SAVE`/`BACKUP`). They create and delete their own
projects. Set `DENIS_MAIN_TOKEN` to the server's main token to also run the `ADMIN`/quota test. `DENIS_HOST` defaults to `127.0.0.1`, `DENIS_PORT` to `5142`, `DENIS_GROUP` to `ci` and
`DENIS_PASSWORD` to `ci-password`.
