package github.hacimertgokhan.drivers;

import java.util.Map;

/** Reply of {@code SAVE}: the snapshot that was written. */
public final class SaveInfo {
    private final long bytes;
    private final long records;
    private final long millis;

    SaveInfo(long bytes, long records, long millis) {
        this.bytes = bytes;
        this.records = records;
        this.millis = millis;
    }

    static SaveInfo from(Map<String, Object> r) {
        return new SaveInfo(Protocol.optNumber(r, "bytes", 0), Protocol.optNumber(r, "records", 0),
                Protocol.optNumber(r, "millis", 0));
    }

    /** Snapshot size in bytes. */
    public long bytes() {
        return bytes;
    }

    /** Records written. */
    public long records() {
        return records;
    }

    /** Time the snapshot took, in milliseconds. */
    public long millis() {
        return millis;
    }

    @Override
    public String toString() {
        return "SaveInfo{bytes=" + bytes + ", records=" + records + ", millis=" + millis + "}";
    }
}
