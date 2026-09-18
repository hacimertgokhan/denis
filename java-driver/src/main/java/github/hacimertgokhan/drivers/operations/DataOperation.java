package github.hacimertgokhan.drivers.operations;

import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import org.json.JSONObject;

import java.io.IOException;

/** Key-value and SQL commands; the connection must be logged in and authenticated. */
public class DataOperation {
    private final ConnectionManager connectionManager;

    public DataOperation(ConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
    }

    /** @return the value, or {@code null} when the key does not exist */
    public String get(String key) throws IOException {
        validateAuth();
        validateKey(key);
        JSONObject reply = connectionManager.send("GET " + key);
        if (reply.optBoolean("ok")) {
            return reply.isNull("data") ? null : reply.getString("data");
        }
        if ("not found".equals(reply.optString("error"))) {
            return null;
        }
        throw new DenisException("Get failed: " + reply.optString("error", reply.toString()));
    }

    /** Cache-only write. */
    public void set(String key, String value) throws IOException {
        set(key, value, false);
    }

    /** @param persist also write the value to the protobuf file ({@code -&save}) */
    public void set(String key, String value, boolean persist) throws IOException {
        validateAuth();
        validateKey(key);
        validateValue(value);
        String flags = persist ? " -&cache -&save" : "";
        expectOk("Set", connectionManager.send(String.format("SET %s %s%s", key, value, flags)));
    }

    /** Remove the key from the cache and the protobuf file. */
    public void delete(String key) throws IOException {
        validateAuth();
        validateKey(key);
        expectOk("Delete", connectionManager.send("DEL " + key));
    }

    /** Cache-only overwrite. */
    public void update(String key, String value) throws IOException {
        validateAuth();
        validateKey(key);
        validateValue(value);
        expectOk("Update", connectionManager.send(String.format("UPDATE %s %s", key, value)));
    }

    /** Drop every cached key of the current project. */
    public void clear() throws IOException {
        validateAuth();
        expectOk("Clear", connectionManager.send("HEAVEN"));
    }

    /** Run one Denis SQL statement; returns the engine's result text. */
    public String sql(String query) throws IOException {
        validateAuth();
        JSONObject reply = connectionManager.send("SQL " + query);
        if (!reply.optBoolean("ok")) {
            throw new DenisException("SQL failed: " + reply.optString("data", reply.optString("error", reply.toString())));
        }
        return reply.optString("data");
    }

    public boolean ping() throws IOException {
        return connectionManager.send("PING").optBoolean("ok");
    }

    private void validateAuth() {
        if (connectionManager.getAuthToken() == null) {
            throw new DenisException("Not authenticated. Call authenticate(token) or createProject() first.");
        }
    }

    private static void validateKey(String key) {
        if (key == null || key.isEmpty() || key.chars().anyMatch(Character::isWhitespace)) {
            throw new DenisException("Key must be a non-empty string without whitespace: " + key);
        }
    }

    private static void validateValue(String value) {
        if (value == null) {
            throw new DenisException("Value must not be null");
        }
        if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            throw new DenisException("Value must not contain line breaks");
        }
        if (value.startsWith("-&") || value.contains(" -&")) {
            throw new DenisException("Value must not contain a word starting with -&");
        }
    }

    private static void expectOk(String operation, JSONObject reply) {
        if (!reply.optBoolean("ok")) {
            throw new DenisException(operation + " operation failed: " + reply.optString("error", reply.toString()));
        }
    }
}
