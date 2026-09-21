package github.hacimertgokhan.denis.sql;

import github.hacimertgokhan.denis.server.ProjectStore;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * One SQL table held in memory: parsed rows in row-id order plus a hash index
 * on every column for {@code WHERE col = value}. The {@link ProjectStore} keeps
 * the durable copy ({@code __sql:<table>:schema|seq|row:<id>} as JSON text);
 * every write goes there too, so a table survives restarts and is rebuilt
 * from the store on first use ({@link TableCatalog}).
 *
 * <p>Before 0.4.0 every statement re-read and re-parsed every row from the
 * store, which made a point query on 10k rows cost ~19 ms; with parsed rows
 * and the index it is a hash lookup.</p>
 */
public final class Table {
    public static final String ROW_ID = "_rowid";

    private final String name;
    private final String prefix;
    private final ProjectStore store;
    private final List<String> columns;
    private final JSONArray schema;
    private final TreeMap<Long, JSONObject> rows = new TreeMap<>();
    private final Map<String, Map<String, Set<Long>>> index = new HashMap<>();
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private long seq;

    Table(String name, ProjectStore store, JSONArray schema, long seq, Collection<JSONObject> loadedRows) {
        this.name = name;
        this.prefix = SqlQueryEngine.NAMESPACE + name + ":";
        this.store = store;
        this.schema = schema;
        this.columns = new ArrayList<>();
        for (int i = 0; i < schema.length(); i++) {
            String column = schema.getJSONObject(i).getString("name");
            columns.add(column);
            index.put(column, new HashMap<>());
        }
        this.seq = seq;
        for (JSONObject row : loadedRows) {
            rows.put(row.getLong(ROW_ID), row);
            addToIndex(row);
        }
    }

    public String name() {
        return name;
    }

    public List<String> columns() {
        return columns;
    }

    public JSONArray schema() {
        return schema;
    }

    public int size() {
        lock.readLock().lock();
        try {
            return rows.size();
        } finally {
            lock.readLock().unlock();
        }
    }

    /** Run {@code reader} with a consistent view of the rows; rows must not be modified. */
    public <T> T read(java.util.function.Function<Collection<JSONObject>, T> reader) {
        lock.readLock().lock();
        try {
            return reader.apply(rows.values());
        } finally {
            lock.readLock().unlock();
        }
    }

    /** Rows whose {@code column} equals {@code value} (index lookup), in row-id order. */
    public <T> T readEqual(String column, Object value, java.util.function.Function<Collection<JSONObject>, T> reader) {
        lock.readLock().lock();
        try {
            Set<Long> ids = index.get(column).get(indexKey(value));
            if (ids == null) {
                return reader.apply(List.of());
            }
            TreeMap<Long, JSONObject> matched = new TreeMap<>();
            for (Long id : ids) {
                matched.put(id, rows.get(id));
            }
            return reader.apply(matched.values());
        } finally {
            lock.readLock().unlock();
        }
    }

    public boolean hasIndex(String column) {
        return index.containsKey(column);
    }

    // ----------------------------------------------------------------- writes

    public int insert(List<JSONObject> newRows) {
        lock.writeLock().lock();
        try {
            for (JSONObject row : newRows) {
                long id = ++seq;
                row.put(ROW_ID, id);
                rows.put(id, row);
                addToIndex(row);
                store.put(prefix + "row:" + id, row.toString(), true);
            }
            store.put(prefix + "seq", String.valueOf(seq), true);
            return newRows.size();
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * @param indexColumn with {@code indexValue}, restricts the candidates to an
     *                    index lookup (the condition is still applied); {@code null} scans
     */
    public int update(java.util.function.Predicate<JSONObject> condition, Map<String, Object> assignments,
                      String indexColumn, Object indexValue) {
        lock.writeLock().lock();
        try {
            int updated = 0;
            for (JSONObject row : candidates(indexColumn, indexValue)) {
                if (!condition.test(row)) {
                    continue;
                }
                removeFromIndex(row);
                assignments.forEach(row::put);
                addToIndex(row);
                store.put(prefix + "row:" + row.getLong(ROW_ID), row.toString(), true);
                updated++;
            }
            return updated;
        } finally {
            lock.writeLock().unlock();
        }
    }

    public int delete(java.util.function.Predicate<JSONObject> condition, String indexColumn, Object indexValue) {
        lock.writeLock().lock();
        try {
            List<Long> doomed = new ArrayList<>();
            for (JSONObject row : candidates(indexColumn, indexValue)) {
                if (condition.test(row)) {
                    doomed.add(row.getLong(ROW_ID));
                }
            }
            for (Long id : doomed) {
                JSONObject row = rows.remove(id);
                removeFromIndex(row);
                store.remove(prefix + "row:" + id, true, true);
            }
            return doomed.size();
        } finally {
            lock.writeLock().unlock();
        }
    }

    /** Rows to consider for a write: an index bucket (copied, since the write changes it) or all rows. Caller holds the write lock. */
    private Collection<JSONObject> candidates(String indexColumn, Object indexValue) {
        if (indexColumn == null) {
            return new ArrayList<>(rows.values());
        }
        Set<Long> ids = index.get(indexColumn).get(indexKey(indexValue));
        if (ids == null) {
            return List.of();
        }
        TreeMap<Long, JSONObject> matched = new TreeMap<>();
        for (Long id : ids) {
            matched.put(id, rows.get(id));
        }
        return new ArrayList<>(matched.values());
    }

    /** Remove every key of the table from the store; the catalog drops the object. */
    void drop() {
        lock.writeLock().lock();
        try {
            store.deleteWithPrefix(prefix);
            rows.clear();
            index.values().forEach(Map::clear);
        } finally {
            lock.writeLock().unlock();
        }
    }

    // ------------------------------------------------------------------ index

    private void addToIndex(JSONObject row) {
        long id = row.getLong(ROW_ID);
        for (String column : columns) {
            String key = indexKey(row.opt(column));
            if (key != null) {
                index.get(column).computeIfAbsent(key, k -> new HashSet<>()).add(id);
            }
        }
    }

    private void removeFromIndex(JSONObject row) {
        long id = row.getLong(ROW_ID);
        for (String column : columns) {
            String key = indexKey(row.opt(column));
            if (key == null) {
                continue;
            }
            Set<Long> ids = index.get(column).get(key);
            if (ids != null && ids.remove(id) && ids.isEmpty()) {
                index.get(column).remove(key);
            }
        }
    }

    /**
     * Index key with the same equality semantics as {@code compareValues}:
     * anything numeric (a number, or text that parses as one) is keyed by its
     * numeric value, everything else by its text. NULL is not indexed.
     */
    static String indexKey(Object value) {
        if (value == null || JSONObject.NULL.equals(value)) {
            return null;
        }
        Double number = SqlQueryEngine.asNumber(value);
        return number != null ? "n:" + number : "s:" + value;
    }
}
