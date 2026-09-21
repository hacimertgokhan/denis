package github.hacimertgokhan.drivers.operations;

import github.hacimertgokhan.drivers.connection.ConnectionManager;
import github.hacimertgokhan.drivers.exceptions.DenisException;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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

    /**
     * Run one Denis SQL statement and return the structured result:
     * {@code {"type":"rows","columns":[..],"rows":[..],"count":n}},
     * {@code {"type":"affected","affected":n,"message":".."}} or
     * {@code {"type":"tables","tables":[..]}}.
     */
    public JSONObject sql(String query) throws IOException {
        validateAuth();
        validateValue(query);
        JSONObject reply = connectionManager.send("SQL " + query);
        if (!reply.optBoolean("ok")) {
            throw new DenisException("SQL failed: " + reply.optString("error", reply.toString()));
        }
        reply.remove("ok");
        return reply;
    }

    /** {@link #sql} for SELECT: the row objects. */
    public JSONArray query(String select) throws IOException {
        JSONObject result = sql(select);
        if (!"rows".equals(result.optString("type"))) {
            throw new DenisException("Expected rows, got " + result.optString("type") + ": " + result);
        }
        return result.getJSONArray("rows");
    }

    /** {@link #sql} for INSERT/UPDATE/DELETE/DDL: the affected row count. */
    public int execute(String statement) throws IOException {
        JSONObject result = sql(statement);
        if (!"affected".equals(result.optString("type"))) {
            throw new DenisException("Expected an affected count, got " + result.optString("type") + ": " + result);
        }
        return result.getInt("affected");
    }

    /** SHOW TABLES: {@code [{"name":..,"columns":[{"name":..,"type":..}],"rows":n}]}. */
    public JSONArray tables() throws IOException {
        return sql("SHOW TABLES").getJSONArray("tables");
    }

    public boolean exists(String key) throws IOException {
        validateAuth();
        validateKey(key);
        JSONObject reply = connectionManager.send("EXISTS " + key);
        expectOk("Exists", reply);
        return reply.optBoolean("exists");
    }

    /** KEYS [pattern]: key names matching a glob ({@code *}, {@code ?}). */
    public List<String> keys(String pattern) throws IOException {
        validateAuth();
        String glob = pattern == null || pattern.isEmpty() ? "*" : pattern;
        validateKey(glob);
        JSONObject reply = connectionManager.send("KEYS " + glob);
        expectOk("Keys", reply);
        List<String> keys = new ArrayList<>();
        JSONArray array = reply.getJSONArray("keys");
        for (int i = 0; i < array.length(); i++) {
            keys.add(array.getString(i));
        }
        return keys;
    }

    /** MGET: missing keys map to {@code null}. */
    public Map<String, String> mget(List<String> keys) throws IOException {
        validateAuth();
        if (keys == null || keys.isEmpty()) {
            throw new DenisException("keys must not be empty");
        }
        keys.forEach(DataOperation::validateKey);
        JSONObject reply = connectionManager.send("MGET " + String.join(" ", keys));
        expectOk("Mget", reply);
        Map<String, String> values = new LinkedHashMap<>();
        JSONObject object = reply.getJSONObject("values");
        for (String key : keys) {
            values.put(key, object.isNull(key) ? null : object.getString(key));
        }
        return values;
    }

    /** INFO: server statistics (needs a login, not a project). */
    public JSONObject info() throws IOException {
        JSONObject reply = connectionManager.send("INFO");
        expectOk("Info", reply);
        reply.remove("ok");
        return reply;
    }

    /** SAVE: flush the persisted store to disk now. */
    public void save() throws IOException {
        validateAuth();
        expectOk("Save", connectionManager.send("SAVE"));
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
