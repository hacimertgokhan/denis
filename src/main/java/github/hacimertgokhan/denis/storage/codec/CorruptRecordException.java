package github.hacimertgokhan.denis.storage.codec;

/** A log or snapshot record failed its length or checksum check. */
public class CorruptRecordException extends RuntimeException {
    public CorruptRecordException(String message) {
        super(message);
    }
}
