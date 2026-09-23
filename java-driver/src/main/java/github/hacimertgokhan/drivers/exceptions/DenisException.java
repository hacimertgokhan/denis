package github.hacimertgokhan.drivers.exceptions;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Base class of every error raised by the Denis driver. Unchecked.
 *
 * <p>{@link #code()} is machine readable. Server errors carry the server's
 * {@code code} field ({@code NOTFOUND}, {@code AUTH}, {@code NOAUTH},
 * {@code NOPROJECT}, {@code LOCKED}, {@code FORBIDDEN}, {@code USAGE},
 * {@code SQL}, {@code OOM}, {@code PERSISTENCE}, {@code TYPE},
 * {@code RESERVED}, {@code BUSY}, {@code LIMIT}, {@code UNKNOWN},
 * {@code INTERNAL}, ...) and {@link #reply()} returns the full reply object.
 * Errors detected by the driver use the codes defined as constants here
 * ({@link #CONNECTION}, {@link #TIMEOUT}, {@link #CLOSED}, {@link #PROTOCOL},
 * {@link #INVALID}, {@link #INTERRUPTED}) and have no reply.
 *
 * <p>Subclasses group the codes an application usually handles differently:
 * {@link DenisAuthException}, {@link DenisSqlException},
 * {@link DenisConnectionException} and {@link DenisTimeoutException}.
 */
public class DenisException extends RuntimeException {
    private static final long serialVersionUID = 2L;

    /** The server could not be reached, or no connection is currently available. */
    public static final String CONNECTION = "CONNECTION";
    /** No reply arrived within the command timeout; the command's outcome is unknown. */
    public static final String TIMEOUT = "TIMEOUT";
    /** The connection (or the client) was closed while the command was in flight; its outcome is unknown. */
    public static final String CLOSED = "CLOSED";
    /** The server sent something the driver did not understand. */
    public static final String PROTOCOL = "PROTOCOL";
    /** The arguments cannot be expressed in the Denis protocol (e.g. a key with whitespace); nothing was sent. */
    public static final String INVALID = "INVALID";
    /** The calling thread was interrupted while waiting for a reply. */
    public static final String INTERRUPTED = "INTERRUPTED";
    /** Code used when neither the server nor the driver supplied one. */
    public static final String ERROR = "ERROR";

    private final String code;
    private final transient Map<String, Object> reply;

    /** An error with code {@link #ERROR}. */
    public DenisException(String message) {
        this(ERROR, message, null, null);
    }

    /** An error with code {@link #ERROR} and a cause. */
    public DenisException(String message, Throwable cause) {
        this(ERROR, message, null, cause);
    }

    /** An error with the given code. */
    public DenisException(String code, String message) {
        this(code, message, null, null);
    }

    /**
     * @param code    machine readable code; {@link #ERROR} when {@code null}
     * @param message human readable message
     * @param reply   the server reply that caused this error, or {@code null}
     * @param cause   the underlying cause, or {@code null}
     */
    public DenisException(String code, String message, Map<String, Object> reply, Throwable cause) {
        super(message, cause);
        this.code = code == null || code.isEmpty() ? ERROR : code;
        this.reply = reply == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(reply));
    }

    /** The machine readable error code (never {@code null}). */
    public String code() {
        return code;
    }

    /** The server's reply object ({@code {"ok":false,...}}), or {@code null} for driver-side errors. */
    public Map<String, Object> reply() {
        return reply;
    }

    /** {@code true} when this error came from a server reply. */
    public boolean isServerError() {
        return reply != null;
    }

    /**
     * {@code true} when simply retrying the same command later is reasonable:
     * the server was busy ({@code BUSY}) and did not execute it.
     */
    public boolean isRetryable() {
        return "BUSY".equals(code);
    }
}
