# Denis TCP Client Library

A Java client library for communicating with a TCP server on port 5142. This library provides functionality for basic operations including GET, SET, AUTH, DELETE, and UPDATE.

## Features

- TCP connection management
- Authentication support
- Basic operations: GET, SET, DELETE, UPDATE
- Exception handling
- Thread-safe implementation
- Modular design with separation of concerns

## Project Structure

```
src/
├── main/java/com/tcpclient/
│   ├── DenisClient.java           # Main client interface
│   ├── connection/
│   │   └── ConnectionManager.java # TCP connection handling
│   ├── operations/
│   │   ├── AuthOperation.java    # Authentication operations
│   │   └── DataOperation.java    # Data operations (GET, SET, etc.)
│   └── exceptions/
│       └── DenisException.java   # Custom exceptions
└── test/java/com/tcpclient/
    ├── DenisClientTest.java      # Integration tests
    └── operations/
        └── AuthOperationTest.java # Unit tests
```

## Usage Example

```java
try (DenisClient client = new DenisClient("localhost")) {
    // Connect to the server
    client.connect();
    
    // Authenticate
    String token = client.authenticate("username", "password");
    
    // Perform operations
    client.set("key1", "value1");
    String value = client.get("key1");
    client.update("key1", "newValue");
    client.delete("key1");
    
} catch (Exception e) {
    e.printStackTrace();
}
```

## Building the Project

```bash
mvn clean install
```

## Running Tests

```bash
mvn test
```

## Dependencies

- Java 11 or higher

## License

MIT License