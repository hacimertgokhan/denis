package github.hacimertgokhan.denis.storage;

import github.hacimertgokhan.denis.storage.table.Table;

import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * The data of one project (token): its key slots and SQL tables. Keyspaces
 * never share maps, so projects do not contend with each other, and dropping
 * a project is dropping one object.
 */
public final class Keyspace {
    private final int id;
    private final String name;
    final ConcurrentHashMap<String, Slot> slots = new ConcurrentHashMap<>(64);
    final ConcurrentHashMap<String, Table> tables = new ConcurrentHashMap<>(4);
    /** Keys that currently carry a TTL, so the expiry sweep does not scan everything. */
    final Set<String> ttlKeys = ConcurrentHashMap.newKeySet();
    final LongAdder cacheKeys = new LongAdder();
    final LongAdder persistentKeys = new LongAdder();
    /** Key + value characters per layer, the unit quotas are expressed in (as since 0.4). */
    final LongAdder cacheBytes = new LongAdder();
    final LongAdder persistentBytes = new LongAdder();
    /** Per-project limits (0 = unlimited), applied to the cache and the durable layer separately. */
    volatile long maxKeys;
    volatile long maxBytes;
    /** Set once a DefineKeyspace record is in the log; before that nothing durable references the id. */
    volatile boolean defined;
    /** Set when the project is deleted; sessions still holding it must stop using it. */
    volatile boolean dropped;

    private Iterator<Map.Entry<String, Slot>> evictionCursor;
    private Iterator<String> expiryCursor;

    Keyspace(int id, String name) {
        this.id = id;
        this.name = name;
    }

    public int id() {
        return id;
    }

    public String name() {
        return name;
    }

    public long cacheKeyCount() {
        return cacheKeys.sum();
    }

    public long persistentKeyCount() {
        return persistentKeys.sum();
    }

    public void setQuota(long maxKeys, long maxBytes) {
        this.maxKeys = Math.max(0, maxKeys);
        this.maxBytes = Math.max(0, maxBytes);
    }

    public long maxKeys() {
        return maxKeys;
    }

    public long maxBytes() {
        return maxBytes;
    }

    public long cacheBytes() {
        return cacheBytes.sum();
    }

    /** Durable keys plus table rows. */
    public long persistedKeys() {
        long rows = 0;
        for (Table t : tables.values()) {
            rows += t.rowCount();
        }
        return persistentKeys.sum() + rows;
    }

    /** Durable key-value bytes plus the estimated size of the tables. */
    public long persistedBytes() {
        long bytes = 0;
        for (Table t : tables.values()) {
            bytes += t.estimatedBytes();
        }
        return persistentBytes.sum() + bytes;
    }

    public boolean dropped() {
        return dropped;
    }

    public int keyCount() {
        return slots.size();
    }

    public Table table(String table) {
        return tables.get(table);
    }

    public Map<String, Table> tables() {
        return tables;
    }

    /**
     * Up to {@code samples} evictable entries starting where the previous call
     * stopped; returns the least recently used one (approximate LRU, as Redis
     * does, without an access-ordered list that every read would have to lock).
     */
    synchronized Map.Entry<String, Slot> evictionCandidate(int samples, long now) {
        Map.Entry<String, Slot> best = null;
        int seen = 0;
        int scanned = 0;
        int limit = Math.max(samples * 8, 64);
        while (seen < samples && scanned < limit) {
            if (evictionCursor == null || !evictionCursor.hasNext()) {
                evictionCursor = slots.entrySet().iterator();
                if (!evictionCursor.hasNext()) {
                    break;
                }
            }
            Map.Entry<String, Slot> entry = evictionCursor.next();
            scanned++;
            Slot slot = entry.getValue();
            if (!slot.evictable()) {
                continue;
            }
            if (slot.cacheExpired(now)) {
                return entry;
            }
            seen++;
            if (best == null || slot.access < best.getValue().access) {
                best = entry;
            }
        }
        return best;
    }

    /** Next batch of keys with a TTL for the expiry sweep. */
    synchronized void forEachTtlKey(int max, java.util.function.Consumer<String> action) {
        for (int i = 0; i < max; i++) {
            if (expiryCursor == null || !expiryCursor.hasNext()) {
                expiryCursor = ttlKeys.iterator();
                if (!expiryCursor.hasNext()) {
                    return;
                }
                if (i > 0) {
                    return;
                }
            }
            action.accept(expiryCursor.next());
        }
    }
}
