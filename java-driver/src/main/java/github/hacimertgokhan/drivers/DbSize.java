package github.hacimertgokhan.drivers;

import java.util.Map;

/** Reply of {@code DBSIZE}: key and table counts of the current project. */
public final class DbSize {
    private final long keys;
    private final long cache;
    private final long persistent;
    private final long tables;

    DbSize(long keys, long cache, long persistent, long tables) {
        this.keys = keys;
        this.cache = cache;
        this.persistent = persistent;
        this.tables = tables;
    }

    static DbSize from(Map<String, Object> r) {
        return new DbSize(Protocol.number(r, "keys"), Protocol.optNumber(r, "cache", 0),
                Protocol.optNumber(r, "persistent", 0), Protocol.optNumber(r, "tables", 0));
    }

    /** Distinct keys (with a cache value, a durable value or both). */
    public long keys() {
        return keys;
    }

    /** Keys with a cache value. */
    public long cache() {
        return cache;
    }

    /** Keys with a durable value. */
    public long persistent() {
        return persistent;
    }

    /** SQL tables. */
    public long tables() {
        return tables;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof DbSize)) {
            return false;
        }
        DbSize d = (DbSize) o;
        return d.keys == keys && d.cache == cache && d.persistent == persistent && d.tables == tables;
    }

    @Override
    public int hashCode() {
        return Long.hashCode(keys) * 31 + Long.hashCode(tables);
    }

    @Override
    public String toString() {
        return "DbSize{keys=" + keys + ", cache=" + cache + ", persistent=" + persistent + ", tables=" + tables + "}";
    }
}
