package github.hacimertgokhan.denis.server;

import github.hacimertgokhan.pointers.Any;
import github.hacimertgokhan.proto.ProtoDatabase;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * One project's view of the data: the shared cache (keys prefixed with
 * {@code <token>:}) plus the persisted store (bare keys under the token).
 * Every command handler and the SQL engine go through this class, so the
 * prefixing rules live in exactly one place.
 */
public class ProjectStore {
    private final String token;
    private final String prefix;
    private final ConcurrentHashMap<String, Any> cache;
    private final ProtoDatabase persistence;

    public ProjectStore(String token, ConcurrentHashMap<String, Any> cache, ProtoDatabase persistence) {
        this.token = token;
        this.prefix = token + ":";
        this.cache = cache;
        this.persistence = persistence;
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
        java.util.TreeSet<String> keys = new java.util.TreeSet<>();
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
        long n = 0;
        for (String full : cache.keySet()) {
            if (full.startsWith(prefix)) {
                n++;
            }
        }
        return n;
    }

    public long persistedCount() {
        return persistence.keyCount(token);
    }

    // ----------------------------------------------------------------- writes

    /** Write to the cache and, with {@code persist}, to the persisted store as well. */
    public void set(String key, String value, boolean persist) {
        cache.put(prefix + key, new Any(value));
        if (persist) {
            persistence.setData(token, key, value);
        }
    }

    public void setCached(String key, String value) {
        cache.put(prefix + key, new Any(value));
    }

    /** @return true when the key existed in any of the selected stores */
    public boolean delete(String key, boolean fromCache, boolean fromPersistence) {
        boolean removed = false;
        if (fromCache) {
            removed |= cache.remove(prefix + key) != null;
        }
        if (fromPersistence) {
            removed |= persistence.deleteData(token, key);
        }
        return removed;
    }

    /** Drop every cached key of the project ({@code HEAVEN}); the persisted store is untouched. */
    public int clearCache() {
        int[] removed = {0};
        cache.entrySet().removeIf(entry -> {
            if (entry.getKey().startsWith(prefix)) {
                removed[0]++;
                return true;
            }
            return false;
        });
        return removed[0];
    }

    /** Remove every cached and persisted key whose bare key starts with {@code keyPrefix}. */
    public int deleteWithPrefix(String keyPrefix) {
        int removed = 0;
        String full = prefix + keyPrefix;
        for (String key : new ArrayList<>(cache.keySet())) {
            if (key.startsWith(full) && cache.remove(key) != null) {
                removed++;
            }
        }
        for (String key : persistence.findToken(token).keySet()) {
            if (key.startsWith(keyPrefix)) {
                persistence.deleteData(token, key);
            }
        }
        return removed;
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
