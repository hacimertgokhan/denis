package github.hacimertgokhan.drivers;

import java.util.Map;

/** One entry of {@code PROJECTS}. */
public final class Project {
    private final String token;
    private final String owner;
    private final long keys;
    private final long tables;
    private final boolean current;

    Project(String token, String owner, long keys, long tables, boolean current) {
        this.token = token;
        this.owner = owner;
        this.keys = keys;
        this.tables = tables;
        this.current = current;
    }

    static Project from(Map<String, Object> r) {
        return new Project(Protocol.string(r, "token"), Protocol.optString(r, "owner"),
                Protocol.optNumber(r, "keys", 0), Protocol.optNumber(r, "tables", 0), Boolean.TRUE.equals(r.get("current")));
    }

    /** The project token (select it with {@link DenisClient#use(String)}). */
    public String token() {
        return token;
    }

    /** Owning group, or {@code null} for legacy projects open to every group. */
    public String owner() {
        return owner;
    }

    /** Number of keys. */
    public long keys() {
        return keys;
    }

    /** Number of SQL tables. */
    public long tables() {
        return tables;
    }

    /** Whether the connection that answered has this project selected. */
    public boolean current() {
        return current;
    }

    @Override
    public String toString() {
        String shortToken = token.length() > 12 ? token.substring(0, 12) + "..." : token;
        return "Project{token=" + shortToken + ", owner=" + owner + ", keys=" + keys + ", tables=" + tables
                + ", current=" + current + "}";
    }
}
