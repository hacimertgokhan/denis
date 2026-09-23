package github.hacimertgokhan.drivers.exceptions;

/**
 * No reply arrived within the configured command timeout (code
 * {@link #TIMEOUT}). The command may or may not have been executed.
 */
public class DenisTimeoutException extends DenisException {
    private static final long serialVersionUID = 1L;

    public DenisTimeoutException(String message) {
        super(TIMEOUT, message, null, null);
    }
}
