package github.hacimertgokhan.denis.storage.table;

import java.util.Arrays;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;
import java.util.function.LongPredicate;

/**
 * Ordered secondary index over one column: value → row ids. A sorted map
 * serves equality, IN and range predicates as well as ORDER BY on the column.
 * NULLs are not indexed (they never match {@code =} or a range).
 *
 * <p>To keep the per-entry footprint small, an entry holds a single boxed
 * {@code Long} for the common unique case and switches to a {@code long[]}
 * only when a value repeats. Guarded by the owning table's lock.
 */
public final class Index {
    private final String name;
    private final String column;
    private final int position;
    private final boolean unique;
    private final TreeMap<Object, Object> entries = new TreeMap<>(Values.ORDER);

    public Index(String name, String column, int position, boolean unique) {
        this.name = name;
        this.column = column;
        this.position = position;
        this.unique = unique;
    }

    public String name() {
        return name;
    }

    public String column() {
        return column;
    }

    public int position() {
        return position;
    }

    public boolean unique() {
        return unique;
    }

    public int distinctValues() {
        return entries.size();
    }

    /** Row id already holding {@code value} (other than {@code exceptRow}), or -1. */
    public long conflict(Object value, long exceptRow) {
        if (value == null) {
            return -1;
        }
        Object existing = entries.get(Values.indexKey(value));
        if (existing == null) {
            return -1;
        }
        if (existing instanceof Long id) {
            return id == exceptRow ? -1 : id;
        }
        for (long id : (long[]) existing) {
            if (id != exceptRow) {
                return id;
            }
        }
        return -1;
    }

    public void add(Object value, long rowId) {
        if (value == null) {
            return;
        }
        Object key = Values.indexKey(value);
        Object existing = entries.get(key);
        if (existing == null) {
            entries.put(key, rowId);
        } else if (existing instanceof Long id) {
            if (id != rowId) {
                entries.put(key, id < rowId ? new long[]{id, rowId} : new long[]{rowId, id});
            }
        } else {
            long[] ids = (long[]) existing;
            int at = Arrays.binarySearch(ids, rowId);
            if (at < 0) {
                int insert = -at - 1;
                long[] next = new long[ids.length + 1];
                System.arraycopy(ids, 0, next, 0, insert);
                next[insert] = rowId;
                System.arraycopy(ids, insert, next, insert + 1, ids.length - insert);
                entries.put(key, next);
            }
        }
    }

    public void remove(Object value, long rowId) {
        if (value == null) {
            return;
        }
        Object key = Values.indexKey(value);
        Object existing = entries.get(key);
        if (existing == null) {
            return;
        }
        if (existing instanceof Long id) {
            if (id == rowId) {
                entries.remove(key);
            }
            return;
        }
        long[] ids = (long[]) existing;
        int at = Arrays.binarySearch(ids, rowId);
        if (at < 0) {
            return;
        }
        if (ids.length == 2) {
            entries.put(key, ids[at == 0 ? 1 : 0]);
        } else {
            long[] next = new long[ids.length - 1];
            System.arraycopy(ids, 0, next, 0, at);
            System.arraycopy(ids, at + 1, next, at, ids.length - at - 1);
            entries.put(key, next);
        }
    }

    public void clear() {
        entries.clear();
    }

    /** Row ids whose column equals {@code value}. @return false when {@code rows} asked to stop */
    public boolean lookup(Object value, LongPredicate rows) {
        if (value == null) {
            return true;
        }
        return emit(entries.get(Values.indexKey(value)), rows);
    }

    /** Largest indexed value, or null when empty. */
    public Object lastValue() {
        return entries.isEmpty() ? null : entries.lastKey();
    }

    /**
     * Row ids in a value range; a null bound is open. Iterates in value order
     * ({@code descending} reverses it), which is what ORDER BY uses.
     */
    public boolean range(Object from, boolean fromInclusive, Object to, boolean toInclusive, boolean descending, LongPredicate rows) {
        NavigableMap<Object, Object> view = entries;
        if (from != null && to != null) {
            if (Values.compare(from, to) > 0) {
                return true;
            }
            view = entries.subMap(Values.indexKey(from), fromInclusive, Values.indexKey(to), toInclusive);
        } else if (from != null) {
            view = entries.tailMap(Values.indexKey(from), fromInclusive);
        } else if (to != null) {
            view = entries.headMap(Values.indexKey(to), toInclusive);
        }
        if (descending) {
            view = view.descendingMap();
        }
        for (Map.Entry<Object, Object> e : view.entrySet()) {
            if (!emit(e.getValue(), rows)) {
                return false;
            }
        }
        return true;
    }

    private static boolean emit(Object entry, LongPredicate rows) {
        if (entry == null) {
            return true;
        }
        if (entry instanceof Long id) {
            return rows.test(id);
        }
        for (long id : (long[]) entry) {
            if (!rows.test(id)) {
                return false;
            }
        }
        return true;
    }
}
