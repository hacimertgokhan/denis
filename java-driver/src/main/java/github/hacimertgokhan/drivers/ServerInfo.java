package github.hacimertgokhan.drivers;

import java.util.Map;

/**
 * Reply of {@code INFO}.
 *
 * <p>The reply has two parts, and this class exposes both:
 * <ul>
 *   <li>the summary fields at the top level ({@code version},
 *       {@code uptimeSeconds}, {@code connections}, {@code commandsTotal},
 *       {@code cacheKeys}, {@code persistedKeys}, {@code projects},
 *       {@code memory}, {@code project}...), read with the typed accessors,
 *       {@link #get(String)} or {@link #asMap()} (this is what 1.2's
 *       {@code info()} returned as a {@code JSONObject});</li>
 *   <li>the detailed statistics object {@code info} with the sections
 *       {@code server}, {@code clients}, {@code stats}, {@code memory},
 *       {@code persistence}, {@code keyspace}, {@code project} and, for admin
 *       groups, {@code recovery}: {@link #details()} and {@link #section(String)}
 *       (this is what 2.0's {@code info()} returned).</li>
 * </ul>
 * When a server sends only one part, the typed accessors fall back to the
 * matching field of the other where there is one. Numbers the server did not
 * send are {@code -1}.
 */
public final class ServerInfo {
    private static final long MIB = 1024 * 1024;

    private final Map<String, Object> reply;
    private final Map<String, Object> details;

    ServerInfo(Map<String, Object> reply) {
        this.reply = Protocol.frozen(reply);
        Map<String, Object> d = Protocol.optObject(reply.get("info"));
        this.details = d == null ? Map.of() : Protocol.frozen(d);
    }

    static ServerInfo from(Map<String, Object> reply) {
        return new ServerInfo(Protocol.body(reply));
    }

    private long number(String topLevel, String... detailPath) {
        Object v = reply.get(topLevel);
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        return detailPath.length == 0 ? -1 : Protocol.pathNumber(details, -1, detailPath);
    }

    /** Server version, e.g. {@code "0.2.0"}. */
    public String version() {
        Object v = reply.get("version");
        if (v == null) {
            v = Protocol.path(details, "server", "version");
        }
        return v == null ? null : String.valueOf(v);
    }

    /** Seconds since the server started. */
    public long uptimeSeconds() {
        return number("uptimeSeconds", "server", "uptimeSeconds");
    }

    /** Start time as sent by the server (ISO-8601), or {@code null}. */
    public String startedAt() {
        return Protocol.optString(reply, "startedAt");
    }

    /** Open client connections ({@code connections.open}). */
    public long openConnections() {
        long v = Protocol.pathNumber(reply, -1, "connections", "open");
        return v >= 0 ? v : Protocol.pathNumber(details, -1, "clients", "connected");
    }

    /** Connections accepted since the start ({@code connections.total}). */
    public long totalConnections() {
        long v = Protocol.pathNumber(reply, -1, "connections", "total");
        return v >= 0 ? v : Protocol.pathNumber(details, -1, "clients", "accepted");
    }

    /** Commands executed since the start. */
    public long commandsTotal() {
        return number("commandsTotal", "stats", "commands");
    }

    /** Keys with a cache value, over all projects. */
    public long cacheKeys() {
        return number("cacheKeys", "keyspace", "cacheKeys");
    }

    /** Keys in the persisted store, over all projects. */
    public long persistedKeys() {
        return number("persistedKeys", "keyspace", "persistentKeys");
    }

    /** Number of projects on the server. */
    public long projects() {
        Object v = reply.get("projects");
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        return Protocol.pathNumber(details, -1, "keyspace", "projects");
    }

    /** The logged-in group, or {@code null}. */
    public String group() {
        return Protocol.optString(reply, "group");
    }

    /** JVM heap in use, in MiB ({@code memory.usedMb}). */
    public long memoryUsedMb() {
        long v = Protocol.pathNumber(reply, -1, "memory", "usedMb");
        if (v >= 0) {
            return v;
        }
        long bytes = Protocol.pathNumber(details, -1, "memory", "heapUsedBytes");
        return bytes < 0 ? -1 : bytes / MIB;
    }

    /** JVM heap limit, in MiB ({@code memory.maxMb}). */
    public long memoryMaxMb() {
        long v = Protocol.pathNumber(reply, -1, "memory", "maxMb");
        if (v >= 0) {
            return v;
        }
        long bytes = Protocol.pathNumber(details, -1, "memory", "heapMaxBytes");
        return bytes < 0 ? -1 : bytes / MIB;
    }

    /** Usage and quota of the selected project, or {@code null} when none is selected (or the server did not send it). */
    public ProjectUsage project() {
        Map<String, Object> p = Protocol.optObject(reply.get("project"));
        return p == null ? null : ProjectUsage.from(p);
    }

    /**
     * The detailed statistics ({@code info} object): sections {@code server},
     * {@code clients}, {@code stats}, {@code memory}, {@code persistence},
     * {@code keyspace}, {@code project}, {@code recovery}. Empty when the
     * server does not send them.
     */
    public Map<String, Object> details() {
        return details;
    }

    /** One section of {@link #details()}, e.g. {@code section("persistence")}, or {@code null}. */
    public Map<String, Object> section(String name) {
        return Protocol.optObject(details.get(name));
    }

    /** A top-level field of the reply, e.g. {@code get("version")}, or {@code null}. */
    public Object get(String field) {
        return reply.get(field);
    }

    /** Whether the reply has the top-level field. */
    public boolean has(String field) {
        return reply.containsKey(field);
    }

    /** The whole reply without {@code ok} (top-level fields plus the {@code info} object). */
    public Map<String, Object> asMap() {
        return reply;
    }

    @Override
    public String toString() {
        return "ServerInfo{version=" + version() + ", uptimeSeconds=" + uptimeSeconds() + ", connections="
                + openConnections() + ", commandsTotal=" + commandsTotal() + ", projects=" + projects() + "}";
    }
}
