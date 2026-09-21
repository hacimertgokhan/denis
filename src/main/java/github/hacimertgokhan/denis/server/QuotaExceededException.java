package github.hacimertgokhan.denis.server;

/** A write was refused because the project would exceed its {@link ProjectRegistry.Quota}. */
public class QuotaExceededException extends RuntimeException {
    private final String resource;
    private final long limit;

    public QuotaExceededException(String resource, long limit) {
        super("quota exceeded: " + resource + " (limit " + limit + ")");
        this.resource = resource;
        this.limit = limit;
    }

    public String resource() {
        return resource;
    }

    public long limit() {
        return limit;
    }
}
