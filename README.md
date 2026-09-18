# Denis Database

Denis Database is a small Java key-value server in the spirit of Redis: keys live in an in-memory cache, can be persisted to a protobuf file, and are grouped into projects (tokens) behind a group login. It speaks a line protocol over TCP and ships with Node.js and Java clients, a management CLI and a Docker image.

[![CI](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml/badge.svg)](https://github.com/hacimertgokhan/denis/actions/workflows/ci.yml)

## Quick Start

Requirements: Java 17 or newer.

Build locally:

```sh
mvn package
```

Run from the generated jar:

```sh
java -jar target/denis-0.0.2.9-alpha.jar --help
java -jar target/denis-0.0.2.9-alpha.jar server
java -jar target/denis-0.0.2.9-alpha.jar cli
```

## Install From Release

Download `denis-<version>-project-bundle.zip` or `denis-<version>-project-bundle.tar.gz` from GitHub Releases, extract it, then run:

```sh
sh install.sh
denis --help
denis server
denis cli
```

Windows:

```bat
install.bat
denis.bat --help
denis.bat server
denis.bat cli
```

## CLI Tools

The release bundle includes `bin/denis` and `bin/denis.bat` wrappers.

```sh
denis --version
denis server
denis cli
denis cli --help
denis cli token -l
denis cli token -c
denis cli group create crm            # non-interactive; prints the generated password
denis cli group create crm -p s3cret  # with a chosen password (stored hashed)
denis cli group create crm --json     # {"group":"crm","password":"...","generated":true}
denis cli group list
denis cli group test crm s3cret       # exit code 0 when LIN would succeed
```

Runtime files are kept next to the installed app by default: `denis.properties`, `denis.toml`, `ddb.json`, `pawd.dat`, `database.bin`, `storage/`, `logs/` and the per-run activity log in `denis/`. None of them belong in version control.

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
docker compose exec denis /app/entrypoint.sh cli group list
```

The image is a multi-stage build (Maven → `eclipse-temurin:17-jre`), runs as a
non-root user, keeps all runtime state in the `/data` volume and has a
`HEALTHCHECK` that sends `PING`. Any CLI command can be run against the same data
with `docker exec <container> /app/entrypoint.sh cli ...`.

## Configuration

Every key of `denis.properties` can be set from the environment: upper-case it,
replace `-` with `_` and prefix `DENIS_`. The `ddb-*` keys are also read without
the prefix. Environment beats the external `denis.properties`, which beats the
defaults bundled in the jar. `DENIS_CONFIG` (or `-Ddenis.config=`) points to a
different properties file.

| Property | Environment | Default | Meaning |
| --- | --- | --- | --- |
| `ddb-port` | `DDB_PORT` / `DENIS_DDB_PORT` | `5142` | TCP port |
| `ddb-address` | `DDB_ADDRESS` | `localhost` | address shown at start-up |
| `ddb-main-token` | `DDB_MAIN_TOKEN` | generated | 128-character main token; generated and written to `denis.properties` on first start when empty |
| `bootstrap-group` | `DENIS_BOOTSTRAP_GROUP` | — | create this login group on start-up if it does not exist |
| `bootstrap-group-password` | `DENIS_BOOTSTRAP_GROUP_PASSWORD` | — | its password (required with the above) |
| `language` | `DENIS_LANGUAGE` | `auto` | `auto` or one of `en tr de fr es da fi el`; unsupported locales fall back to `en` |
| `max-connections-per-ip` | `DENIS_MAX_CONNECTIONS_PER_IP` | `12` | concurrent connections per client address |
| `send-client-actions` | `DENIS_SEND_CLIENT_ACTIONS` | `true` | log every client command (credentials are masked) |
| `use-delogg` | `DENIS_USE_DELOGG` | `false` | also write client actions to the activity log |
| `open-log-terminal` | `DENIS_OPEN_LOG_TERMINAL` | `false` | open a desktop terminal that tails the activity log |

## Wire protocol

Denis speaks a line protocol over TCP (`telnet localhost 5142` works). One line
in, one line out.

```
MODE json | MODE text        response format for this connection (default: text)
PING                         -> PONG (no login needed)
LIN <group> <password>       log in with a group from denis.toml
AUTH CREATE                  create a project (key namespace) and print its token
AUTH <token>                 select a project
SET <key> <value> [-&save] [-&cache] [-&protobuff]
GET <key> [-&from-cache | -&from-protobuff] [-&asa-json]
DEL <key> [-&cache] [-&protobuff]
UPDATE <key> <value>         cache-only overwrite
HEAVEN                       drop the project's cached keys
SQL <statement>              see "SQL Queries" below
EXIT
```

Keys are one word; values may contain spaces but not line breaks, and no word of
a value may start with `-&`. In `text` mode replies are the human readable lines
Denis always had (`[Info - <date>]: Ok (Cache)`, raw values for `GET`). In
`json` mode every reply is exactly one JSON object per line, which is what the
client libraries use:

```json
{"ok":true,"message":"Logged in to group: crm"}
{"ok":true,"message":"Project created","token":"..."}
{"ok":true,"key":"greeting","data":"hello world"}
{"ok":false,"key":"missing","error":"not found"}
{"ok":false,"error":"Please login first using LIN command"}
```

## Client libraries

- **Node.js** — [`clients/node`](clients/node): promise based, connection pool, no dependencies.
- **Java** — [`java-driver`](java-driver): single-connection client (`DenisClient`), built with Maven.

Both talk `MODE json` and are exercised against the Docker image in CI.

## SQL Queries

After logging in and authenticating to a project token, Denis accepts standard SQL-style queries over the TCP protocol. You can send them directly or prefix them with `SQL`.

Supported query subset:

- `CREATE TABLE <table> (<column> <type>, ...)`
- `INSERT INTO <table> (<columns>) VALUES (<values>)`
- `SELECT <columns|*> FROM <table> [WHERE <column> = <value>]`
- `UPDATE <table> SET <column> = <value> [, ...] [WHERE <column> = <value>]`
- `DELETE FROM <table> [WHERE <column> = <value>]`
- `DROP TABLE <table>`

Example:

```sql
CREATE TABLE users (id INT, name TEXT);
INSERT INTO users (id, name) VALUES (1, 'Ada');
SELECT * FROM users WHERE id = 1;
UPDATE users SET name = 'Grace' WHERE id = 1;
DELETE FROM users WHERE id = 1;
DROP TABLE users;
```

## DAPI

---
Detailed library information about DDB.

# Actions

---

## actString Class

**`actString`** is a class designed to manage data with a `String key` and `String value` pair. This class is used for basic CRUD operations and checking data existence.

---

### **Methods**
| Method                   | Return Type | Description |
|-------------------------|-------------|-------------|
| `set(String key, String value)` | `Void`      | Saves or updates the specified key and value. |
| `get(String key)`     | `String`    | Returns the value corresponding to the given key. Returns `null` if no value exists. |
| `del(String key)`     | `Void`      | Deletes the specified key and its value. |
| `exists(String key)`  | `Boolean`   | Checks whether the given key exists. |

---

### **Usage Example**
```java
actString actstr = new actString();

// Adding data
actstr.set("key1", "value1");

// Retrieving data
String value = actstr.get("key1"); // "value1"

// Data check
boolean exists = actstr.exists("key1"); // true

// Deleting data
actstr.del("key1");
```

---

## actListrig Class

**`actListrig`** is a structure that associates a `List<String>` key with a `String` value. It is created using `ConcurrentHashMap`, which is suitable for parallel operations.

---

### **Methods**
| Method                     | Return Type         | Description |
|----------------------------|---------------------|-------------|
| `set(List<String> key, String value)` | `Void`            | Saves or updates the specified list key and value pair. |
| `get(List<String> key)`   | `String`          | Returns the value corresponding to the given list key. Returns `"null"` if no value exists. |
| `del(List<String> key)`   | `Void`            | Deletes the specified list key and its value. |
| `exists(String key)`      | `Boolean`         | Checks whether the given list key exists. |
| `getStore()`              | `ConcurrentHashMap` | Returns all data. |

---

### **Usage Example**
```java
import java.util.Arrays;
import java.util.List;

actListrig actlist = new actListrig();

// Create key
List<String> key = Arrays.asList("item1", "item2");

// Add data
actlist.set(key, "value1");

// Retrieve data
String value = actlist.get(key); // "value1"

// Data check
boolean exists = actlist.getStore().containsKey(key); // true

// Delete data
actlist.del(key);
```

---

## Class Differences and Usage Scenarios

| Feature         | actString                        | actListrig                           |
|-----------------|----------------------------------|--------------------------------------|
| **Key Type**    | `String`                        | `List<String>`                      |
| **Data Management**| Single key-value pair    | Managing multiple keys together     |
| **Use Case**    | Managing simple structures       | Managing complex, hierarchical structures |

**Example Scenarios:**
- **`actString`** can be used to store username-password pairs in a database.
- **`actListrig`** can be used to associate product categories and subcategories on an e-commerce site.

---

## actStrist Class

`actStrist` is a class that associates a `String` key with a `List<String>` value. It uses the `ConcurrentHashMap` infrastructure suitable for parallel operations. This class is designed to bind multiple values to a single key.

### Methods

| Method                             | Return Type             | Description                                                |
|------------------------------------|-------------------------|-------------------------------------------------------------|
| `set(String key, List<String> value)` | `Void`               | Saves or updates the specified key and value list. |
| `get(String key)`                 | `List<String>`         | Returns the value list corresponding to the given key. Returns `["null"]` if no value exists. |
| `del(String key)`                 | `Void`                | Deletes the specified key and its value list.          |
| `exists(String key)`              | `Boolean`             | Checks whether the given key exists. |
| `getStore()`                      | `ConcurrentHashMap`   | Returns all data.                                   |

### Usage Example

```java
actStrist actstrist = new actStrist();

// Create key and value list
String key = "group1";
List<String> values = Arrays.asList("item1", "item2", "item3");

// Add data
actstrist.set(key, values);

// Retrieve data
List<String> retrievedValues = actstrist.get(key);
System.out.println(retrievedValues); // [item1, item2, item3]

// Data check
boolean exists = actstrist.exists(key);
System.out.println(exists); // true

// Delete data
actstrist.del(key);

// Check again
exists = actstrist.exists(key);
System.out.println(exists); // false
```
