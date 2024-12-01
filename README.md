# Denis Database

Denis Database is a Java Library that works with Redis logic and has a simple structure. It provides ease of access and manipulation of temporary data by storing operations in the cache. It increases database categorization with action statuses, providing ease of development.

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
