package github.hacimertgokhan.denis.storage;

/** A write that would take a project past its key or byte limit ({@code ADMIN ... QUOTA}). */
public class QuotaException extends StorageException {
    private final String resource;
    private final long limit;

    public QuotaException(String resource, long limit) {
        super("QUOTA", "quota exceeded: " + resource + " (limit " + limit + ")");
        this.resource = resource;
        this.limit = limit;
    }

    /** {@code keys} or {@code bytes}. */
    public String resource() {
        return resource;
    }

    public long limit() {
        return limit;
    }
}
