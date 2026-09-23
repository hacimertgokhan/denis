package github.hacimertgokhan.denis.storage;

/**
 * Everything the server knows about one key, in a single small object:
 * the volatile cache value, the durable value, the cache TTL and an LRU clock.
 *
 * <p>Denis has two layers per key ({@code SET} writes the cache, {@code -&save}
 * also the durable layer). Keeping both in one slot instead of two maps halves
 * the per-key map overhead, and when both layers hold the same value they
 * share one {@code String} instance. A slot is replaced, never mutated, on
 * writes; only {@link #access} is updated in place by reads (a benign race).
 *
 * <p>Layout on a 64-bit JVM with compressed oops: 12 byte header + 4 + 4 + 8 + 4
 * = 32 bytes.
 */
public final class Slot {
    final String cache;
    final String persistent;
    /** Epoch millis at which the cache value expires; 0 = never. Only the cache layer expires. */
    final long expireAt;
    /** Engine LRU clock at the last access, in seconds since start. */
    int access;

    Slot(String cache, String persistent, long expireAt, int access) {
        this.cache = cache;
        this.persistent = persistent;
        this.expireAt = cache == null ? 0 : expireAt;
        this.access = access;
    }

    public String cache() {
        return cache;
    }

    public String persistent() {
        return persistent;
    }

    public long expireAt() {
        return expireAt;
    }

    boolean isEmpty() {
        return cache == null && persistent == null;
    }

    boolean cacheExpired(long now) {
        return cache != null && expireAt != 0 && now >= expireAt;
    }

    /** Only the cache layer holds data, so evicting the slot loses nothing durable. */
    boolean evictable() {
        return cache != null && persistent == null;
    }

    /** Approximate heap bytes of the slot including its map node and key. */
    static long cost(String key, Slot slot) {
        if (slot == null) {
            return 0;
        }
        long size = 32 /* map node */ + 32 /* slot */ + 40 + key.length();
        if (slot.cache != null) {
            size += 40 + slot.cache.length();
        }
        if (slot.persistent != null && slot.persistent != slot.cache) {
            size += 40 + slot.persistent.length();
        }
        return size;
    }
}
