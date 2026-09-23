package github.hacimertgokhan.drivers.exceptions;

import java.util.Map;

/**
 * The project reached a limit set with {@code ADMIN <main-token> QUOTA}
 * (code {@code QUOTA}). The write was refused; a multi-row {@code INSERT} may
 * have stored the rows before the one that hit the limit.
 *
 * <pre>{@code
 * try {
 *     client.set("k", value);
 * } catch (DenisQuotaException e) {
 *     log.warn("project full: " + e.resource() + " limit " + e.limit());
 * }
 * }</pre>
 */
public class DenisQuotaException extends DenisException {
    private static final long serialVersionUID = 1L;

    /** The error code of quota failures. */
    public static final String QUOTA = "QUOTA";

    private final String resource;
    private final long limit;

    /**
     * @param message  human readable message
     * @param reply    the server reply ({@code {"ok":false,"code":"QUOTA","resource":..,"limit":..}})
     * @param resource the exhausted resource ({@code "keys"} or {@code "bytes"}), or {@code null} if unknown
     * @param limit    the configured limit, or {@code -1} if unknown
     */
    public DenisQuotaException(String message, Map<String, Object> reply, String resource, long limit) {
        super(QUOTA, message, reply, null);
        this.resource = resource;
        this.limit = limit;
    }

    /** The exhausted resource: {@code "keys"} or {@code "bytes"} ({@code null} when the server did not say). */
    public String resource() {
        return resource;
    }

    /** The limit that was reached ({@code -1} when the server did not say). */
    public long limit() {
        return limit;
    }
}
