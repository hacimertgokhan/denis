package github.hacimertgokhan.denis.server;

import org.json.JSONObject;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * Per-project resource accounting: how many keys and how many characters of
 * key + value each project holds in the cache and in the persisted store.
 * Updated on every write by {@link ProjectStore}, rebuilt at start-up, read by
 * {@code INFO}, {@code ADMIN USAGE} and the quota check. "Bytes" are UTF-16
 * code units — exact for ASCII, an approximation otherwise — which is cheap to
 * keep and good enough for quotas.
 */
public class UsageTracker {
    /** Counters of one project. */
    public static final class Usage {
        final LongAdder cacheKeys = new LongAdder();
        final LongAdder cacheBytes = new LongAdder();
        final LongAdder persistedKeys = new LongAdder();
        final LongAdder persistedBytes = new LongAdder();

        public long cacheKeys() {
            return cacheKeys.sum();
        }

        public long cacheBytes() {
            return cacheBytes.sum();
        }

        public long persistedKeys() {
            return persistedKeys.sum();
        }

        public long persistedBytes() {
            return persistedBytes.sum();
        }

        public JSONObject toJson() {
            return new JSONObject()
                    .put("cachedKeys", cacheKeys())
                    .put("cachedBytes", cacheBytes())
                    .put("persistedKeys", persistedKeys())
                    .put("persistedBytes", persistedBytes());
        }
    }

    private final ConcurrentHashMap<String, Usage> usage = new ConcurrentHashMap<>();

    public Usage of(String token) {
        return usage.computeIfAbsent(token, t -> new Usage());
    }

    public static long size(String key, String value) {
        return key.length() + (value == null ? 0 : value.length());
    }

    /** A cache entry was added ({@code oldValue == null}) or replaced. */
    public void cachePut(String token, String key, String oldValue, String newValue) {
        Usage u = of(token);
        if (oldValue == null) {
            u.cacheKeys.increment();
            u.cacheBytes.add(size(key, newValue));
        } else {
            u.cacheBytes.add(newValue.length() - (long) oldValue.length());
        }
    }

    public void cacheRemove(String token, String key, String oldValue) {
        if (oldValue == null) {
            return;
        }
        Usage u = of(token);
        u.cacheKeys.decrement();
        u.cacheBytes.add(-size(key, oldValue));
    }

    public void persistedPut(String token, String key, String oldValue, String newValue) {
        Usage u = of(token);
        if (oldValue == null) {
            u.persistedKeys.increment();
            u.persistedBytes.add(size(key, newValue));
        } else {
            u.persistedBytes.add(newValue.length() - (long) oldValue.length());
        }
    }

    public void persistedRemove(String token, String key, String oldValue) {
        if (oldValue == null) {
            return;
        }
        Usage u = of(token);
        u.persistedKeys.decrement();
        u.persistedBytes.add(-size(key, oldValue));
    }

    public void forget(String token) {
        usage.remove(token);
    }
}
