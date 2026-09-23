package github.hacimertgokhan.drivers;

/**
 * Which layer {@code DEL} removes: both (default), only the cache value
 * ({@code -&cache}) or only the durable value ({@code -&protobuff}).
 */
public final class DelOptions {
    private static final DelOptions ALL = new DelOptions("");
    private static final DelOptions CACHE = new DelOptions(" -&cache");
    private static final DelOptions PERSISTENT = new DelOptions(" -&protobuff");

    private final String flag;

    private DelOptions(String flag) {
        this.flag = flag;
    }

    /** Delete the cache and the durable value (default). */
    public static DelOptions all() {
        return ALL;
    }

    /** Delete only the cache value. */
    public static DelOptions cacheOnly() {
        return CACHE;
    }

    /** Delete only the durable value. */
    public static DelOptions persistentOnly() {
        return PERSISTENT;
    }

    String flag() {
        return flag;
    }

    @Override
    public String toString() {
        return this == ALL ? "DelOptions.all()" : this == CACHE ? "DelOptions.cacheOnly()" : "DelOptions.persistentOnly()";
    }
}
