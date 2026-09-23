package github.hacimertgokhan.drivers;

import java.util.Map;

/** What an {@code IMPORT} added (summed over all lines when a dump was split). */
public final class ImportResult {
    static final ImportResult EMPTY = new ImportResult(0, 0, 0, 0);

    private final long persistent;
    private final long cache;
    private final long tables;
    private final long rows;

    ImportResult(long persistent, long cache, long tables, long rows) {
        this.persistent = persistent;
        this.cache = cache;
        this.tables = tables;
        this.rows = rows;
    }

    static ImportResult from(Map<String, Object> r) {
        Map<String, Object> i = Protocol.object(Protocol.field(r, "imported"), "imported");
        return new ImportResult(Protocol.optNumber(i, "persistent", 0), Protocol.optNumber(i, "cache", 0),
                Protocol.optNumber(i, "tables", 0), Protocol.optNumber(i, "rows", 0));
    }

    ImportResult plus(ImportResult o) {
        return new ImportResult(persistent + o.persistent, cache + o.cache, tables + o.tables, rows + o.rows);
    }

    /** Durable values imported. */
    public long persistent() {
        return persistent;
    }

    /** Cache values imported. */
    public long cache() {
        return cache;
    }

    /** Tables imported. */
    public long tables() {
        return tables;
    }

    /** Table rows imported. */
    public long rows() {
        return rows;
    }

    @Override
    public String toString() {
        return "ImportResult{persistent=" + persistent + ", cache=" + cache + ", tables=" + tables + ", rows=" + rows + "}";
    }
}
