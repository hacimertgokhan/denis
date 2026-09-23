package github.hacimertgokhan.drivers.exceptions;

/**
 * Transport failure: code {@link #CONNECTION} (connect failed or no
 * connection available) or {@link #CLOSED} (the connection or client was
 * closed while the command was in flight - it may or may not have been
 * executed; the driver never replays it).
 */
public class DenisConnectionException extends DenisException {
    private static final long serialVersionUID = 1L;

    public DenisConnectionException(String code, String message, Throwable cause) {
        super(code, message, null, cause);
    }

    public DenisConnectionException(String code, String message) {
        this(code, message, null);
    }
}
