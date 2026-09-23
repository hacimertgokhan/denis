package github.hacimertgokhan.drivers;

import java.util.Map;

/**
 * Usage and quota of one project: an entry of {@code ADMIN <main-token> LIST},
 * the reply of {@code ADMIN ... USAGE} / {@code ADMIN ... QUOTA}, and the
 * {@code project} section of {@code INFO} ({@link ServerInfo#project()}).
 *
 * <p>Quota limits apply to the cache and the persisted store separately;
 * {@code 0} means unlimited. Counters the server did not send are {@code -1}.
 */
public final class ProjectUsage {
    private final String token;
    private final long cachedKeys;
    private final long cachedBytes;
    private final long persistedKeys;
    private final long persistedBytes;
    private final long maxKeys;
    private final long maxBytes;

    ProjectUsage(String token, long cachedKeys, long cachedBytes, long persistedKeys, long persistedBytes,
                 long maxKeys, long maxBytes) {
        this.token = token;
        this.cachedKeys = cachedKeys;
        this.cachedBytes = cachedBytes;
        this.persistedKeys = persistedKeys;
        this.persistedBytes = persistedBytes;
        this.maxKeys = maxKeys;
        this.maxBytes = maxBytes;
    }

    /**
     * Reads {@code {token, usage:{...}, quota:{...}}}; the usage counters may
     * also sit directly on the object (the {@code INFO} form
     * {@code {cachedKeys, ..., quota:{...}}}).
     */
    static ProjectUsage from(Map<String, Object> r) {
        Map<String, Object> usage = Protocol.optObject(r.get("usage"));
        if (usage == null) {
            usage = r;
        }
        Map<String, Object> quota = Protocol.optObject(r.get("quota"));
        if (quota == null) {
            quota = Map.of();
        }
        return new ProjectUsage(Protocol.optString(r, "token"),
                Protocol.optNumber(usage, "cachedKeys", -1), Protocol.optNumber(usage, "cachedBytes", -1),
                Protocol.optNumber(usage, "persistedKeys", -1), Protocol.optNumber(usage, "persistedBytes", -1),
                Protocol.optNumber(quota, "maxKeys", 0), Protocol.optNumber(quota, "maxBytes", 0));
    }

    /** The project token, or {@code null} (the {@code INFO} form carries none). */
    public String token() {
        return token;
    }

    /** Keys with a cache value. */
    public long cachedKeys() {
        return cachedKeys;
    }

    /** Bytes of the cache values. */
    public long cachedBytes() {
        return cachedBytes;
    }

    /** Keys in the persisted store. */
    public long persistedKeys() {
        return persistedKeys;
    }

    /** Bytes in the persisted store. */
    public long persistedBytes() {
        return persistedBytes;
    }

    /** Key limit per store; {@code 0} = unlimited. */
    public long maxKeys() {
        return maxKeys;
    }

    /** Byte limit per store; {@code 0} = unlimited. */
    public long maxBytes() {
        return maxBytes;
    }

    /** Whether any limit is set. */
    public boolean hasQuota() {
        return maxKeys > 0 || maxBytes > 0;
    }

    @Override
    public String toString() {
        String t = token == null ? "" : "token=" + (token.length() > 12 ? token.substring(0, 12) + "..." : token) + ", ";
        return "ProjectUsage{" + t + "cachedKeys=" + cachedKeys + ", cachedBytes=" + cachedBytes + ", persistedKeys="
                + persistedKeys + ", persistedBytes=" + persistedBytes + ", maxKeys=" + maxKeys + ", maxBytes=" + maxBytes + "}";
    }
}
