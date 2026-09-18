# Denis Java Driver

Single-connection Java client for [Denis Database](https://github.com/hacimertgokhan/denis).
Java 11+, one dependency (`org.json`).

```sh
cd java-driver && mvn package      # target/denis-driver-<version>.jar (shaded)
```

```java
import github.hacimertgokhan.drivers.DenisClient;

try (DenisClient client = new DenisClient("localhost", 5142)) {
    client.connect();                       // switches the connection to MODE json
    client.login("crm", "s3cret");          // LIN <group> <password>
    String token = client.createProject();  // AUTH CREATE — or client.authenticate(token)

    client.set("greeting", "hello world");           // cache
    client.set("user:1", "{\"id\":1}", true);        // cache + protobuf (-&save)
    client.get("greeting");                          // "hello world"
    client.get("missing");                           // null
    client.update("greeting", "hi");
    client.delete("greeting");
    client.sql("CREATE TABLE users (id INT, name TEXT)");
    client.clear();                                  // HEAVEN
}
```

Keys are one word; values may contain spaces, quotes and unicode but no line
breaks, and no word may start with `-&`. Failures throw `DenisException`
(unchecked) with the server's error text; transport problems throw `IOException`.

A `DenisClient` is one TCP connection and is not thread-safe — use one per thread.

## Tests

The integration test needs a running server (see the Dockerfile at the repo root):

```sh
DENIS_INTEGRATION=1 DENIS_GROUP=crm DENIS_PASSWORD=s3cret mvn test
```
