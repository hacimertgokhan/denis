package github.hacimertgokhan.drivers.exceptions;

public class DenisException extends RuntimeException {
    public DenisException(String message) {
        super(message);
    }

    public DenisException(String message, Throwable cause) {
        super(message, cause);
    }
}