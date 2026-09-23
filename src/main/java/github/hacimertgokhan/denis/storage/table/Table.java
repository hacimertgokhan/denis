package github.hacimertgokhan.denis.storage.table;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.LongConsumer;

/**
 * A SQL table held in memory: rows keyed by a monotonically assigned row id
 * (kept in row-id order, so a full scan is also insertion order), plus
 * secondary indexes. Rows are {@code Object[]} in column order — no per-row
 * map or JSON text — which keeps a row close to the size of its values.
 *
 * <p>Concurrency: one read-write lock per table. Readers (SELECT, snapshots)
 * share it; writers hold it exclusively for the whole statement, which makes
 * each statement atomic with respect to others on the same table while
 * different tables never contend.
 *
 * <p>Mutators do not validate; the SQL engine validates, logs the mutation and
 * then applies it, and recovery applies logged mutations directly.
 */
public final class Table {
    private final String name;
    private TableSchema schema;
    private final TreeMap<Long, Object[]> rows = new TreeMap<>();
    private final Map<String, Index> indexes = new LinkedHashMap<>();
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private final LongConsumer memory;
    private long lastRowId;
    private long bytes;

    public Table(String name, TableSchema schema, LongConsumer memory) {
        this.name = name;
        this.schema = schema;
        this.memory = memory == null ? delta -> { } : memory;
        for (int i = 0; i < schema.size(); i++) {
            Column c = schema.column(i);
            if (c.primaryKey() || c.unique()) {
                String indexName = (c.primaryKey() ? "pk_" : "uq_") + name + "_" + c.name();
                indexes.put(indexName, new Index(indexName, c.name(), i, true));
            }
        }
        account(200);
    }

    public String name() {
        return name;
    }

    public ReentrantReadWriteLock lock() {
        return lock;
    }

    public TableSchema schema() {
        return schema;
    }

    public int rowCount() {
        return rows.size();
    }

    public long lastRowId() {
        return lastRowId;
    }

    public long estimatedBytes() {
        return bytes;
    }

    /** Rows in row-id order. Callers hold the read or write lock. */
    public NavigableMap<Long, Object[]> rows() {
        return Collections.unmodifiableNavigableMap(rows);
    }

    public Object[] row(long rowId) {
        return rows.get(rowId);
    }

    public Collection<Index> indexes() {
        return Collections.unmodifiableCollection(indexes.values());
    }

    public Index index(String indexName) {
        return indexes.get(indexName);
    }

    /** An index on {@code column}, preferring a unique one. */
    public Index indexOn(String column) {
        Index found = null;
        for (Index index : indexes.values()) {
            if (index.column().equals(column)) {
                if (index.unique()) {
                    return index;
                }
                found = found == null ? index : found;
            }
        }
        return found;
    }

    /** User-created indexes (the ones implied by PRIMARY KEY / UNIQUE are rebuilt from the schema). */
    public List<Index> explicitIndexes() {
        List<Index> list = new ArrayList<>();
        for (Index index : indexes.values()) {
            if (!index.name().startsWith("pk_" + name + "_") && !index.name().startsWith("uq_" + name + "_")) {
                list.add(index);
            }
        }
        return list;
    }

    public long nextRowId() {
        return lastRowId + 1;
    }

    /**
     * Name of a unique index that {@code values} would violate, ignoring row
     * {@code exceptRow}; null when the row fits.
     */
    public String uniqueViolation(Object[] values, long exceptRow) {
        for (Index index : indexes.values()) {
            if (index.unique() && index.conflict(values[index.position()], exceptRow) >= 0) {
                return index.column();
            }
        }
        return null;
    }

    /** Insert or replace a row. */
    public void put(long rowId, Object[] values) {
        Object[] stored = values.length == schema.size() ? values : Arrays.copyOf(values, schema.size());
        Object[] previous = rows.put(rowId, stored);
        if (previous != null) {
            for (Index index : indexes.values()) {
                index.remove(previous[index.position()], rowId);
            }
            account(-rowBytes(previous));
        }
        for (Index index : indexes.values()) {
            index.add(stored[index.position()], rowId);
        }
        account(rowBytes(stored));
        if (rowId > lastRowId) {
            lastRowId = rowId;
        }
    }

    public Object[] remove(long rowId) {
        Object[] previous = rows.remove(rowId);
        if (previous != null) {
            for (Index index : indexes.values()) {
                index.remove(previous[index.position()], rowId);
            }
            account(-rowBytes(previous));
        }
        return previous;
    }

    /** Build an index over the existing rows. */
    public Index createIndex(String indexName, String column, boolean unique) {
        int position = schema.position(column);
        if (position < 0) {
            throw new IllegalArgumentException("Column not found: " + column);
        }
        Index index = new Index(indexName, column, position, unique);
        for (Map.Entry<Long, Object[]> e : rows.entrySet()) {
            Object value = e.getValue()[position];
            if (unique && index.conflict(value, e.getKey()) >= 0) {
                throw new IllegalArgumentException("Cannot create unique index " + indexName + ": duplicate value " + value);
            }
            index.add(value, e.getKey());
        }
        indexes.put(indexName, index);
        account(48L * rows.size());
        return index;
    }

    public boolean dropIndex(String indexName) {
        Index removed = indexes.remove(indexName);
        if (removed != null) {
            account(-48L * rows.size());
        }
        return removed != null;
    }

    /** Replace the schema with one that has extra trailing columns; existing rows get the defaults. */
    public void alter(TableSchema next) {
        int oldSize = schema.size();
        if (next.size() < oldSize) {
            throw new IllegalArgumentException("Columns cannot be removed");
        }
        schema = next;
        if (next.size() == oldSize) {
            return;
        }
        for (Map.Entry<Long, Object[]> e : rows.entrySet()) {
            Object[] grown = Arrays.copyOf(e.getValue(), next.size());
            for (int i = oldSize; i < next.size(); i++) {
                grown[i] = next.column(i).defaultValue();
            }
            e.setValue(grown);
        }
        for (int i = oldSize; i < next.size(); i++) {
            Column c = next.column(i);
            if (c.unique() || c.primaryKey()) {
                createIndex("uq_" + name + "_" + c.name(), c.name(), true);
            }
        }
    }

    /** Remove every row (the table itself stays). */
    public void truncate() {
        long freed = 0;
        for (Object[] row : rows.values()) {
            freed += rowBytes(row);
        }
        rows.clear();
        for (Index index : indexes.values()) {
            index.clear();
        }
        lastRowId = 0;
        account(-freed);
    }

    /** Release the memory accounted for this table; call when it is dropped. */
    public void release() {
        account(-bytes);
    }

    private static long rowBytes(Object[] row) {
        long size = 64 + 8L * row.length;
        for (Object v : row) {
            size += Values.sizeOf(v);
        }
        return size;
    }

    private void account(long delta) {
        bytes += delta;
        memory.accept(delta);
    }
}
