package github.hacimertgokhan.denis.storage;

/**
 * A write the engine refused. {@link #code()} is a short, stable identifier
 * that the wire protocol passes on to clients:
 * <ul>
 *   <li>{@code OOM}: the write would exceed {@code max-memory} and nothing could be evicted,</li>
 *   <li>{@code PERSISTENCE}: the write-ahead log is failing (disk full, ...), durable writes are refused,</li>
 *   <li>{@code TYPE}: the value has the wrong type for the operation (INCR on text),</li>
 *   <li>{@code RESERVED}: the key is reserved for internal use.</li>
 * </ul>
 */
public class StorageException extends RuntimeException {
    private final String code;

    public StorageException(String code, String message) {
        super(message);
        this.code = code;
    }

    public StorageException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
