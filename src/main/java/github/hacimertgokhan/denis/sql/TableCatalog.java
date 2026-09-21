package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.server.ProjectStore;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The in-memory {@link Table}s of every project, shared by all connections
 * and built lazily from the {@link ProjectStore} on first use.
 */
public class TableCatalog {
    private final ConcurrentHashMap<String, Table> tables = new ConcurrentHashMap<>();

    private static String id(String token, String table) {
        return token + ":" + table;
    }

    /** The table, loading it from the store when this is its first use; {@code null} when it does not exist. */
    public Table get(ProjectStore store, String table) {
        Table loaded = tables.get(id(store.token(), table));
        if (loaded != null) {
            return loaded;
        }
        String schema = store.get(SqlQueryEngine.NAMESPACE + table + ":schema");
        if (schema == null) {
            return null;
        }
        return tables.computeIfAbsent(id(store.token(), table), k -> load(store, table, new JSONArray(schema)));
    }

    private static Table load(ProjectStore store, String table, JSONArray schema) {
        String prefix = SqlQueryEngine.NAMESPACE + table + ":";
        String seq = store.get(prefix + "seq");
        List<JSONObject> rows = new ArrayList<>();
        for (Map.Entry<String, String> entry : store.entriesWithPrefix(prefix + "row:").entrySet()) {
            rows.add(new JSONObject(entry.getValue()));
        }
        return new Table(table, store, schema, seq == null ? 0 : Long.parseLong(seq), rows);
    }

    /** Create the table in the store and the catalog; {@code null} when it already exists. */
    public Table create(ProjectStore store, String table, JSONArray schema) {
        String key = id(store.token(), table);
        if (tables.containsKey(key) || store.exists(SqlQueryEngine.NAMESPACE + table + ":schema")) {
            return null;
        }
        store.put(SqlQueryEngine.NAMESPACE + table + ":schema", schema.toString(), true);
        store.put(SqlQueryEngine.NAMESPACE + table + ":seq", "0", true);
        Table created = new Table(table, store, schema, 0, List.of());
        return tables.putIfAbsent(key, created) == null ? created : null;
    }

    public boolean drop(ProjectStore store, String table) {
        Table existing = get(store, table);
        if (existing == null) {
            return false;
        }
        existing.drop();
        tables.remove(id(store.token(), table));
        return true;
    }

    /** Names of the project's tables, from the store so unloaded tables are included. */
    public List<String> names(ProjectStore store) {
        List<String> names = new ArrayList<>();
        for (String key : store.entriesWithPrefix(SqlQueryEngine.NAMESPACE).keySet()) {
            if (key.endsWith(":schema")) {
                names.add(key.substring(SqlQueryEngine.NAMESPACE.length(), key.length() - ":schema".length()));
            }
        }
        names.sort(String::compareTo);
        return names;
    }

    /** Forget a project's loaded tables (after its {@code __sql:} keys were changed directly). */
    public void invalidate(String token) {
        tables.keySet().removeIf(key -> key.startsWith(token + ":"));
    }
}
