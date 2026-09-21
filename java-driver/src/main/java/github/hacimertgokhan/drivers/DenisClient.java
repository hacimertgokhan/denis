package github.hacimertgokhan.drivers;

import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.operations.AuthOperation;
import github.hacimertgokhan.drivers.operations.DataOperation;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Java client for Denis Database.
 *
 * <pre>{@code
 * try (DenisClient client = new DenisClient("localhost", 5142)) {
 *     client.connect();
 *     client.login("crm", "s3cret");          // LIN
 *     String token = client.createProject();  // or client.authenticate(existingToken)
 *     client.set("greeting", "hello world");
 *     client.get("greeting");                 // "hello world"
 * }
 * }</pre>
 *
 * A client is one connection and is not thread-safe; use one per thread.
 */
public class DenisClient implements AutoCloseable {
    public static final int DEFAULT_PORT = 5142;

    private final ConnectionManager connectionManager;
    private final AuthOperation authOperation;
    private final DataOperation dataOperation;

    public DenisClient(String host) {
        this(host, DEFAULT_PORT);
    }

    public DenisClient(String host, int port) {
        this.connectionManager = new ConnectionManager(host, port);
        this.authOperation = new AuthOperation(connectionManager);
        this.dataOperation = new DataOperation(connectionManager);
    }

    public void connect() throws IOException {
        connectionManager.connect();
    }

    /** Log in with a group and password ({@code LIN}). */
    public void login(String group, String password) throws IOException {
        authOperation.login(group, password);
    }

    /** Select an existing project token ({@code AUTH <token>}). */
    public void authenticate(String token) throws IOException {
        authOperation.authenticate(token);
    }

    /** Create and select a new project; returns its token for later {@link #authenticate}. */
    public String createProject() throws IOException {
        return authOperation.createProject();
    }

    public String getToken() {
        return connectionManager.getAuthToken();
    }

    public boolean ping() throws IOException {
        return dataOperation.ping();
    }

    public String get(String key) throws IOException {
        return dataOperation.get(key);
    }

    public void set(String key, String value) throws IOException {
        dataOperation.set(key, value);
    }

    public void set(String key, String value, boolean persist) throws IOException {
        dataOperation.set(key, value, persist);
    }

    public void delete(String key) throws IOException {
        dataOperation.delete(key);
    }

    public void update(String key, String value) throws IOException {
        dataOperation.update(key, value);
    }

    public void clear() throws IOException {
        dataOperation.clear();
    }

    /** Structured SQL result; see {@link DataOperation#sql}. */
    public JSONObject sql(String query) throws IOException {
        return dataOperation.sql(query);
    }

    /** Rows of a SELECT. */
    public JSONArray query(String select) throws IOException {
        return dataOperation.query(select);
    }

    /** Affected row count of INSERT/UPDATE/DELETE/DDL. */
    public int execute(String statement) throws IOException {
        return dataOperation.execute(statement);
    }

    public JSONArray tables() throws IOException {
        return dataOperation.tables();
    }

    public boolean exists(String key) throws IOException {
        return dataOperation.exists(key);
    }

    public List<String> keys(String pattern) throws IOException {
        return dataOperation.keys(pattern);
    }

    public Map<String, String> mget(List<String> keys) throws IOException {
        return dataOperation.mget(keys);
    }

    public JSONObject info() throws IOException {
        return dataOperation.info();
    }

    public void save() throws IOException {
        dataOperation.save();
    }

    @Override
    public void close() throws IOException {
        connectionManager.disconnect();
    }
}
