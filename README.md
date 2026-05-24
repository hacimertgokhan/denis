# Denis Database

Denis Database is a Java Library that works with Redis logic and has a simple structure. It provides ease of access and manipulation of temporary data by storing operations in the cache. It increases database categorization with action statuses, providing ease of development.

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
```

Runtime files are kept next to the installed app by default: `denis.properties`, `denis.toml`, `ddb.json`, `pawd.dat`, and `logs/`.

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
