package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.denis.project.ProjectRegistry;
import github.hacimertgokhan.denis.sql.SqlQueryEngine;
import github.hacimertgokhan.denis.sql.TableCatalog;
import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.proto.ProtoDatabase;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * One project's view of the data: the shared cache (keys prefixed with
 * {@code <token>:}) plus the persisted store (bare keys under the token).
 * Every command handler and the SQL engine go through this class, so the
 * prefixing rules, the usage accounting and the quota check live in exactly
 * one place.
 */
public class ProjectStore {
    private final String token;
    private final String prefix;
    private final ConcurrentHashMap<String, Any> cache;
    private final ProtoDatabase persistence;
    private final TableCatalog tables;
    private final UsageTracker usage;
    private final Supplier<ProjectRegistry.Quota> quota;

    public ProjectStore(String token, ConcurrentHashMap<String, Any> cache, ProtoDatabase persistence) {
        this(token, cache, persistence, new TableCatalog());
    }

    public ProjectStore(String token, ConcurrentHashMap<String, Any> cache, ProtoDatabase persistence, TableCatalog tables) {
        this(token, cache, persistence, tables, new UsageTracker(), () -> ProjectRegistry.Quota.UNLIMITED);
    }

    public ProjectStore(String token, ConcurrentHashMap<String, Any> cache, ProtoDatabase persistence, TableCatalog tables,
                        UsageTracker usage, Supplier<ProjectRegistry.Quota> quota) {
        this.token = token;
        this.prefix = token + ":";
        this.cache = cache;
        this.persistence = persistence;
        this.tables = tables;
        this.usage = usage;
        this.quota = quota;
    }

    /** The in-memory SQL tables shared by every connection of the server. */
    public TableCatalog tables() {
        return tables;
    }

    public UsageTracker.Usage usage() {
        return usage.of(token);
    }

    public ProjectRegistry.Quota quota() {
        return quota.get();
    }

    /** Called when a raw key command touches the SQL namespace, so loaded tables are rebuilt. */
    private void touched(String key) {
        if (key.startsWith(SqlQueryEngine.NAMESPACE)) {
            tables.invalidate(token);
        }
    }

    public static String fullKey(String token, String key) {
        return token + ":" + key;
    }

    public String token() {
        return token;
    }

    // ------------------------------------------------------------------ reads

    /** Cache first, then the persisted store. */
    public String get(String key) {
        Any cached = cache.get(prefix + key);
        if (cached != null) {
            return String.valueOf(cached.getValue());
        }
        return persistence.getData(token, key);
    }

    public String getCached(String key) {
        Any cached = cache.get(prefix + key);
        return cached == null ? null : String.valueOf(cached.getValue());
    }

    public String getPersisted(String key) {
        return persistence.getData(token, key);
    }

    public boolean exists(String key) {
        return cache.containsKey(prefix + key) || persistence.exists(token, key);
    }

    public boolean isPersisted(String key) {
        return persistence.exists(token, key);
    }

    /**
     * Keys of this project matching a glob ({@code *} and {@code ?}); cached and
     * persisted keys are merged, sorted, without duplicates. Internal SQL keys
     * ({@code __sql:...}) are left out unless the pattern asks for them.
     */
    public List<String> keys(String glob) {
        Pattern pattern = globToRegex(glob == null || glob.isBlank() ? "*" : glob);
        boolean internal = glob != null && glob.startsWith("__");
        TreeSet<String> keys = new TreeSet<>();
        for (String full : cache.keySet()) {
            if (full.startsWith(prefix)) {
                keys.add(full.substring(prefix.length()));
            }
        }
        keys.addAll(persistence.findToken(token).keySet());
        List<String> matched = new ArrayList<>();
        for (String key : keys) {
            if (!internal && key.startsWith("__")) {
                continue;
            }
            if (pattern.matcher(key).matches()) {
                matched.add(key);
            }
        }
        return matched;
    }

    /**
     * Entries whose bare key starts with {@code keyPrefix}: the persisted store
     * overlaid with the cache (a cached value wins), so tables keep working
     * after {@code HEAVEN} dropped them from memory.
     */
    public Map<String, String> entriesWithPrefix(String keyPrefix) {
        Map<String, String> out = new java.util.HashMap<>();
        for (Map.Entry<String, String> entry : persistence.findToken(token).entrySet()) {
            if (entry.getKey().startsWith(keyPrefix)) {
                out.put(entry.getKey(), entry.getValue());
            }
        }
        String full = prefix + keyPrefix;
        for (Map.Entry<String, Any> entry : cache.entrySet()) {
            if (entry.getKey().startsWith(full)) {
                out.put(entry.getKey().substring(prefix.length()), String.valueOf(entry.getValue().getValue()));
            }
        }
        return out;
    }

    public long cachedCount() {
        return usage().cacheKeys();
    }

    public long persistedCount() {
        return persistence.keyCount(token);
    }

    // ----------------------------------------------------------------- writes

    /** Write to the cache and, with {@code persist}, to the persisted store as well. */
    public void set(String key, String value, boolean persist) {
        touched(key);
        put(key, value, persist);
    }

    /**
     * {@link #set} without the table-catalog check; used by the SQL engine for
     * its own keys. Refuses the write with {@link QuotaExceededException} when
     * the project would exceed its key or byte limit in either store.
     */
    public void put(String key, String value, boolean persist) {
        String full = prefix + key;
        Any previous = cache.get(full);
        String oldCached = previous == null ? null : String.valueOf(previous.getValue());
        String oldPersisted = persist ? persistence.getData(token, key) : null;
        checkQuota(key, value, oldCached, persist, oldPersisted);

        Any replaced = cache.put(full, new Any(value));
        usage.cachePut(token, key, replaced == null ? null : String.valueOf(replaced.getValue()), value);
        if (persist) {
            persistence.setData(token, key, value);
            usage.persistedPut(token, key, oldPersisted, value);
        }
    }

    private void checkQuota(String key, String value, String oldCached, boolean persist, String oldPersisted) {
        ProjectRegistry.Quota q = quota.get();
        if (q.maxKeys() <= 0 && q.maxBytes() <= 0) {
            return;
        }
        UsageTracker.Usage u = usage();
        long newSize = UsageTracker.size(key, value);
        long cacheKeys = u.cacheKeys() + (oldCached == null ? 1 : 0);
        long cacheBytes = u.cacheBytes() + newSize - (oldCached == null ? 0 : UsageTracker.size(key, oldCached));
        long persistedKeys = u.persistedKeys() + (persist && oldPersisted == null ? 1 : 0);
        long persistedBytes = u.persistedBytes() + (persist ? newSize - (oldPersisted == null ? 0 : UsageTracker.size(key, oldPersisted)) : 0);
        if (q.maxKeys() > 0 && (cacheKeys > q.maxKeys() || persistedKeys > q.maxKeys())) {
            throw new QuotaExceededException("keys", q.maxKeys());
        }
        if (q.maxBytes() > 0 && (cacheBytes > q.maxBytes() || persistedBytes > q.maxBytes())) {
            throw new QuotaExceededException("bytes", q.maxBytes());
        }
    }

    public void setCached(String key, String value) {
        touched(key);
        String old = getCached(key);
        checkQuota(key, value, old, false, null);
        Any replaced = cache.put(prefix + key, new Any(value));
        usage.cachePut(token, key, replaced == null ? null : String.valueOf(replaced.getValue()), value);
    }

    /** @return true when the key existed in any of the selected stores */
    public boolean delete(String key, boolean fromCache, boolean fromPersistence) {
        touched(key);
        return remove(key, fromCache, fromPersistence);
    }

    /** {@link #delete} without the table-catalog check; used by the SQL engine for its own keys. */
    public boolean remove(String key, boolean fromCache, boolean fromPersistence) {
        boolean removed = false;
        if (fromCache) {
            Any old = cache.remove(prefix + key);
            if (old != null) {
                usage.cacheRemove(token, key, String.valueOf(old.getValue()));
                removed = true;
            }
        }
        if (fromPersistence) {
            String old = persistence.getData(token, key);
            if (persistence.deleteData(token, key)) {
                usage.persistedRemove(token, key, old);
                removed = true;
            }
        }
        return removed;
    }

    /** Drop every cached key of the project ({@code HEAVEN}); the persisted store is untouched. */
    public int clearCache() {
        int removed = 0;
        for (String full : new ArrayList<>(cache.keySet())) {
            if (!full.startsWith(prefix)) {
                continue;
            }
            Any old = cache.remove(full);
            if (old != null) {
                usage.cacheRemove(token, full.substring(prefix.length()), String.valueOf(old.getValue()));
                removed++;
            }
        }
        return removed;
    }

    /** Remove every cached and persisted key whose bare key starts with {@code keyPrefix}. */
    public int deleteWithPrefix(String keyPrefix) {
        int removed = 0;
        String full = prefix + keyPrefix;
        for (String key : new ArrayList<>(cache.keySet())) {
            if (key.startsWith(full)) {
                Any old = cache.remove(key);
                if (old != null) {
                    usage.cacheRemove(token, key.substring(prefix.length()), String.valueOf(old.getValue()));
                    removed++;
                }
            }
        }
        for (Map.Entry<String, String> entry : persistence.findToken(token).entrySet()) {
            if (entry.getKey().startsWith(keyPrefix) && persistence.deleteData(token, entry.getKey())) {
                usage.persistedRemove(token, entry.getKey(), entry.getValue());
            }
        }
        return removed;
    }

    /** Remove everything the project holds: cache, persisted keys, loaded tables. */
    public void purge() {
        clearCache();
        for (Map.Entry<String, String> entry : persistence.findToken(token).entrySet()) {
            if (persistence.deleteData(token, entry.getKey())) {
                usage.persistedRemove(token, entry.getKey(), entry.getValue());
            }
        }
        persistence.deleteToken(token);
        tables.invalidate(token);
    }

    static Pattern globToRegex(String glob) {
        StringBuilder regex = new StringBuilder("^");
        for (char c : glob.toCharArray()) {
            switch (c) {
                case '*' -> regex.append(".*");
                case '?' -> regex.append('.');
                default -> regex.append(Pattern.quote(String.valueOf(c)));
            }
        }
        return Pattern.compile(regex.append('$').toString());
    }
}
