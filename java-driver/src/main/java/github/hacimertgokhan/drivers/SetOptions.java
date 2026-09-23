package github.hacimertgokhan.drivers;

import java.time.Duration;
import java.util.Objects;

/**
 * Options of {@code SET}. Immutable; every method returns a new instance.
 *
 * <pre>{@code
 * client.set("session:1", json, SetOptions.cache().ttl(Duration.ofMinutes(30)));
 * client.set("user:1", json, SetOptions.persist());           // cache + durable log
 * }</pre>
 *
 * The cache value is always written. {@link #persist()} also writes the
 * durable value ({@code -&save}); a TTL ({@code -&ttl=<s>}) expires only the
 * cache value, with millisecond precision.
 */
public final class SetOptions {
    private static final SetOptions CACHE = new SetOptions(false, null);
    private static final SetOptions PERSIST = new SetOptions(true, null);

    private final boolean persistent;
    private final Duration ttl;

    private SetOptions(boolean persistent, Duration ttl) {
        this.persistent = persistent;
        this.ttl = ttl;
    }

    /** Cache value only (the default of {@code SET}). */
    public static SetOptions cache() {
        return CACHE;
    }

    /** Cache value and durable value ({@code -&save}); survives restarts. */
    public static SetOptions persist() {
        return PERSIST;
    }

    /** Same options with the durable flag set or cleared. */
    public SetOptions persistent(boolean persistent) {
        return new SetOptions(persistent, ttl);
    }

    /** Same options with a time to live for the cache value (at least 1 ms); {@code null} for none. */
    public SetOptions ttl(Duration ttl) {
        if (ttl != null && (ttl.isNegative() || ttl.isZero())) {
            throw Protocol.invalid("ttl must be positive");
        }
        return new SetOptions(persistent, ttl);
    }

    public boolean isPersistent() {
        return persistent;
    }

    /** The TTL, or {@code null}. */
    public Duration ttl() {
        return ttl;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof SetOptions && ((SetOptions) o).persistent == persistent && Objects.equals(((SetOptions) o).ttl, ttl);
    }

    @Override
    public int hashCode() {
        return Objects.hash(persistent, ttl);
    }

    @Override
    public String toString() {
        return "SetOptions{persistent=" + persistent + ", ttl=" + ttl + "}";
    }
}
